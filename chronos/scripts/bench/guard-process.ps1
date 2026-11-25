param([Parameter(Mandatory)][int]$RootPid, [int]$ServerPid, [string]$AgentExe)
$ErrorActionPreference = 'Stop'
if ($env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Use a disposable Windows CI runner' }
function Sample {
  $rows = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate,CommandLine,ExecutablePath,KernelModeTime,UserModeTime,PrivatePageCount,WorkingSetSize)
  $children = $rows | Group-Object ParentProcessId -AsHashTable -AsString
  $root = $rows | Where-Object ProcessId -eq $RootPid
  if (!$root) { throw 'Benchmark root exited' }
  $tree = [Collections.Generic.List[object]]::new()
  function Visit($p, $inAgent) {
    $inAgent = $inAgent -or ($AgentExe -and $p.ExecutablePath -eq $AgentExe)
    $role = if ($AgentExe) {'agent'} elseif ($p.ProcessId -eq $RootPid) {'main'} elseif ($p.ProcessId -eq $ServerPid) {'server'} elseif ($p.CommandLine -match '--type=renderer\b') {'renderer'} elseif ($p.CommandLine -match '[\\/]chronos-services[\\/]host\.mjs') {'olympus'} else {'other'}
    if (!$AgentExe -or $inAgent) {
      $tree.Add([pscustomobject]@{role=$role; id=$p.ProcessId; start=$p.CreationDate; ticks=([double]$p.KernelModeTime+[double]$p.UserModeTime); priv=[double]$p.PrivatePageCount/1MB; ws=[double]$p.WorkingSetSize/1MB; image=[IO.Path]::GetFileName($p.ExecutablePath)})
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
$groups = if ($AgentExe) { @('agent') } else { @('main','server','renderer','olympus','total') }
foreach ($role in $groups) {
  $members = @($last | Where-Object { $role -eq 'total' -or $_.role -eq $role })
  if (!$members.Count) {throw "Missing $role in isolated process tree: $($last.image -join ',')"}
  $ticks = 0
  foreach ($p in $members) {
    $old = $first | Where-Object { $_.id -eq $p.id -and $_.start -eq $p.start }
    if (!$old) {throw "Process set changed during idle sample: $($p.image)"}
    $ticks += $p.ticks - $old.ticks
  }
  $result[$role] = @{count=$members.Count; privateMiB=($members | Measure-Object priv -Sum).Sum; wsMiB=($members | Measure-Object ws -Sum).Sum; cpuPct=$ticks/1e5/$seconds}
}
$result['images'] = @($last | ForEach-Object { $_.role + '/' + $_.image } | Sort-Object)
$result | ConvertTo-Json -Depth 4
