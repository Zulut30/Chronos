param([Parameter(Mandatory)][int]$RootPid, [int]$ServerPid, [string]$AgentExe)
$ErrorActionPreference = 'Stop'
if ($env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Use a disposable Windows CI runner' }
function Sample {
  $rows = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate,CommandLine,ExecutablePath,KernelModeTime,UserModeTime,PrivatePageCount,WorkingSetSize,ThreadCount)
  $children = $rows | Group-Object ParentProcessId -AsHashTable -AsString
  $root = $rows | Where-Object ProcessId -eq $RootPid
  if (!$root) { throw 'Benchmark root exited' }
  $tree = [Collections.Generic.List[object]]::new()
  function Visit($p, $inAgent) {
    $inAgent = $inAgent -or ($AgentExe -and $p.ExecutablePath -eq $AgentExe)
    $role = if ($AgentExe) {'agent'} elseif ($p.ProcessId -eq $RootPid) {'main'} elseif ($p.ProcessId -eq $ServerPid) {'server'} elseif ($p.CommandLine -match '--type=renderer\b') {'renderer'} elseif ($p.CommandLine -match '--type=gpu-process\b') {'gpu'} elseif ($p.CommandLine -match '--type=utility\b') {'utility'} elseif ($p.CommandLine -match '[\\/]chronos-services[\\/]host\.mjs') {'olympus'} else {'other'}
    if (!$AgentExe -or $inAgent) {
      $tree.Add([pscustomobject]@{role=$role; id=$p.ProcessId; start=$p.CreationDate; ticks=([double]$p.KernelModeTime+[double]$p.UserModeTime); priv=[double]$p.PrivatePageCount/1MB; ws=[double]$p.WorkingSetSize/1MB; threads=[int]$p.ThreadCount; image=[IO.Path]::GetFileName($p.ExecutablePath)})
    }
    foreach ($child in $children[[string]$p.ProcessId]) { if ($child -and $child.CreationDate -ge $p.CreationDate) { Visit $child $inAgent } }
  }
  Visit $root $false
  return $tree.ToArray()
}
$first = @(Sample)
$clock = [Diagnostics.Stopwatch]::StartNew()
# The desktop server has periodic work. Capture a full interval on both sides
# instead of letting a single short initialization burst dominate CPU.
Start-Sleep -Seconds $(if ($AgentExe) { 12 } else { 45 })
$last = @(Sample)
$seconds = $clock.Elapsed.TotalSeconds
$result = @{}
$required = if ($AgentExe) { @('agent') } else { @('main','server','renderer','olympus','total') }
$optional = if ($AgentExe) { @() } else { @('gpu','utility','other') }
foreach ($role in ($required + $optional)) {
  $members = @($last | Where-Object { $role -eq 'total' -or $_.role -eq $role })
  if (!$members.Count) {
    if ($role -in $required) { throw "Missing $role in isolated process tree: $($last.image -join ',')" }
    $result[$role] = @{count=0; privateMiB=0; wsMiB=0; cpuPct=0; threads=0}
    continue
  }
  $ticks = 0
  foreach ($p in $members) {
    $old = $first | Where-Object { $_.id -eq $p.id -and $_.start -eq $p.start }
    if (!$old) {throw "Process set changed during idle sample: $($p.image)"}
    $ticks += $p.ticks - $old.ticks
  }
  $result[$role] = @{count=$members.Count; privateMiB=($members | Measure-Object priv -Sum).Sum; wsMiB=($members | Measure-Object ws -Sum).Sum; cpuPct=$ticks/1e5/$seconds; threads=[int]($members | Measure-Object threads -Sum).Sum}
}
$result['images'] = @($last | ForEach-Object { $_.role + '/' + $_.image } | Sort-Object)
$result['processes'] = @($last | ForEach-Object { @{ role=$_.role; image=$_.image; privateMiB=[math]::Round($_.priv, 3); wsMiB=[math]::Round($_.ws, 3); threads=$_.threads } } | Sort-Object { $_.role + '/' + $_.image })
$result | ConvertTo-Json -Depth 4
