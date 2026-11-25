param([Parameter(Mandatory)][string]$Results)
$ErrorActionPreference = 'Stop'
if ($env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Requires a disposable CI VM' }
$budget = Get-Content -Raw chronos/perf-budget.json | ConvertFrom-Json
$pair = $env:PAIR | ConvertFrom-Json
New-Item -ItemType Directory -Force $Results | Out-Null
$env:PAIR | Set-Content -Encoding utf8 (Join-Path $Results 'pair.json')
$packages = @{}
foreach ($side in 'base','head') {
  $build = $pair.$side.run
  if (!$packages.ContainsKey($build)) {
    $dest = Join-Path $env:RUNNER_TEMP "package-$build"
    ./chronos/scripts/bench/unpack.ps1 -Run $build -Destination $dest
    $packages[$build] = Join-Path $dest 'pkg'
  }
}
$vendor = Join-Path $env:RUNNER_TEMP 'native-providers'
$claude = $budget.providers.'@anthropic-ai/claude-code'
$codex = $budget.providers.'@openai/codex'
npm.cmd install --prefix $vendor --ignore-scripts --no-audit --no-fund "@anthropic-ai/claude-code-win32-x64@$claude" "@openai/codex@$codex-win32-x64"
if ($LASTEXITCODE) { throw 'Pinned provider download failed' }
$env:BENCH_CLAUDE = (Get-Item "$vendor/node_modules/@anthropic-ai/claude-code-win32-x64/claude.exe").FullName
$env:BENCH_CODEX = (Get-ChildItem "$vendor/node_modules/@openai/codex/vendor" -Recurse -Filter codex.exe | Select-Object -First 1).FullName
$failed = @{}
for ($round=1; $round -le $budget.rounds; $round++) {
  $order = if ($round % 2) { 'base','head' } else { 'head','base' }
  foreach ($side in $order) {
    $pkg = $packages[$pair.$side.run]
    foreach ($scenario in 'unused','disabled','claudeAgent','codex','storage','ui0','ui8','ui16') {
      if ($failed["$side-$scenario"]) { continue }
      $file = Join-Path $Results "$side-$round-$scenario.json"
      Write-Host "Measuring $side round $round $scenario"
      if ($scenario -like 'ui*') {
        node chronos/scripts/bench/ui.mjs desktop $pkg $scenario.Substring(2) $file
      } elseif ($scenario -eq 'storage') {
        node chronos/scripts/bench/run.mjs $pkg 8 $file
      } else {
        node chronos/scripts/bench/guard-runtime.mjs $pkg $scenario $file
      }
      if ($LASTEXITCODE) {
        $failed["$side-$scenario"] = $true
        "Benchmark exit $LASTEXITCODE" | Set-Content "$file.failed"
        Write-Host "::error::$side round $round $scenario failed"
      }
    }
  }
}
if ($failed.Count) { throw "Incomplete scenarios: $($failed.Keys -join ', ')" }
