param([Parameter(Mandatory)][int]$RootPid, [int]$ServerPid, [string]$AgentExe, [switch]$ListAgents, [switch]$MemoryMap)
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
      $tree.Add([pscustomobject]@{role=$role; cli=($AgentExe -and $p.ExecutablePath -eq $AgentExe); id=$p.ProcessId; start=$p.CreationDate; ticks=([double]$p.KernelModeTime+[double]$p.UserModeTime); priv=[double]$p.PrivatePageCount/1MB; ws=[double]$p.WorkingSetSize/1MB; image=[IO.Path]::GetFileName($p.ExecutablePath)})
    }
    foreach ($child in $children[[string]$p.ProcessId]) { if ($child -and $child.CreationDate -ge $p.CreationDate) { Visit $child $inAgent } }
  }
  Visit $root $false
  return $tree.ToArray()
}
$first = @(Sample)
if ($ListAgents) {
  ConvertTo-Json -Compress -InputObject @($first | Where-Object cli | ForEach-Object { "$($_.id)/$($_.start.Ticks)" })
  return
}
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
if ($AgentExe) {
  $cli = @($last | Where-Object cli)
  if ($cli.Count -ne 1) { throw "Expected one pinned CLI, found $($cli.Count)" }
  $result.cli = @{ privateMiB=$cli[0].priv; wsMiB=$cli[0].ws; cpuSeconds=$cli[0].ticks/1e7 }
  if ($MemoryMap) {
    $result.cli.committedRegionsMiB = & "$PSScriptRoot/committed-regions.ps1" -ProcessId $cli[0].id
  }
}
$result['images'] = @($last | ForEach-Object { $_.role + '/' + $_.image } | Sort-Object)
$result | ConvertTo-Json -Depth 4
