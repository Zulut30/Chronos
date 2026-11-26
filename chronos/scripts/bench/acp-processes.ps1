param([int]$Agent, [int]$Bridge, [string]$AgentBorn, [string]$BridgeBorn)
$ErrorActionPreference = 'Stop'
if ($env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'CI only' }
function Member([int]$id, [string]$born) {
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if (!$p) { return }
  $identity = [string]$p.StartTime.ToUniversalTime().Ticks
  if ($born -and $born -ne $identity) { return }
  return @{ born=$identity; privateMiB=$p.PrivateMemorySize64/1MB; wsMiB=$p.WorkingSet64/1MB }
}
$rows = @{ agent=(Member $Agent $AgentBorn); bridge=(Member $Bridge $BridgeBorn) }
$alive = @($rows.Values | Where-Object { $_ })
$rows.count = $alive.Count
$rows.privateMiB = [double](($alive | ForEach-Object { $_.privateMiB }) | Measure-Object -Sum).Sum
ConvertTo-Json $rows
