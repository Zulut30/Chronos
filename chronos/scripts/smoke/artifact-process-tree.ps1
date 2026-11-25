param([Parameter(Mandatory)][int]$RootId)
$all = Get-CimInstance Win32_Process
$queue = [Collections.Generic.Queue[int]]::new()
$queue.Enqueue($RootId)
$private = 0L
$working = 0L
$count = 0
while ($queue.Count) {
  $current = $queue.Dequeue()
  $p = Get-Process -Id $current -ErrorAction SilentlyContinue
  if ($p) { $private += $p.PrivateMemorySize64; $working += $p.WorkingSet64; $count++ }
  foreach ($child in $all.Where({$_.ParentProcessId -eq $current})) { $queue.Enqueue($child.ProcessId) }
}
@{privateBytes=$private;workingSet=$working;processes=$count} | ConvertTo-Json -Compress
