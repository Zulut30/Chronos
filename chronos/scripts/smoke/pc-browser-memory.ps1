param([Parameter(Mandatory)][int]$DaemonId, [Parameter(Mandatory)][string]$Binary)
$ErrorActionPreference = 'Stop'
$daemon = Get-Process -Id $DaemonId
if ($daemon.Path -ne $Binary) { throw 'Unexpected browser daemon identity' }
$rows = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" -Property ProcessId,ParentProcessId,WorkingSetSize)
$parents = @($DaemonId)
$bytes = [long]0
$count = 0
while ($parents.Count) {
  $children = @($rows | Where-Object { $parents -contains $_.ParentProcessId })
  foreach ($child in $children) { $bytes += $child.WorkingSetSize; $count++ }
  $parents = @($children | ForEach-Object { $_.ProcessId })
}
if (-not $count) { throw 'The headless browser has no observed child processes' }
"Web form, daemon working set $($daemon.WorkingSet64) bytes; $count Chromium processes, sum of working sets $bytes bytes"
