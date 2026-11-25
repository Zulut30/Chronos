param([Parameter(Mandatory)][string]$Results, [ValidateSet('prepare','first','remaining')][string]$Stage)
$ErrorActionPreference = 'Stop'
if ($env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Requires a disposable CI VM' }
$budget = Get-Content -Raw chronos/perf-budget.json | ConvertFrom-Json
if ($Stage -eq 'prepare') {
  $pair = $env:PAIR | ConvertFrom-Json
  New-Item -ItemType Directory -Force $Results | Out-Null
  $pair | Add-Member NoteProperty harnessSha $env:GITHUB_SHA
  $pair | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $Results 'pair.json')
  foreach ($target in (@($pair.base, $pair.head) | Sort-Object sha -Unique)) {
    $build = $target.run
    $dest = Join-Path $env:RUNNER_TEMP "package-$build"
    ./chronos/scripts/bench/unpack.ps1 -Run $build -Destination $dest
    $marker = Join-Path $dest 'perf-source.txt'
    if ($target.pinned -or (Test-Path -LiteralPath $marker)) {
      if ((Get-Content -Raw -LiteralPath $marker).Trim() -cne $target.sha) { throw 'Packaged source does not match the planned SHA' }
    }
    # An older baseline can have fewer feature switches than its candidate.
    $path = 'apps/web/src/chronos/olympus/featureFlags.ts'
    $uri = "$env:GITHUB_API_URL/repos/$env:GITHUB_REPOSITORY/contents/${path}?ref=$($target.sha)"
    $source = Invoke-RestMethod -Uri $uri -Headers @{Authorization="Bearer $env:GH_TOKEN"}
    [IO.File]::WriteAllBytes((Join-Path $dest 'featureFlags.mts'), [Convert]::FromBase64String($source.content))
  }
  $vendor = Join-Path $env:RUNNER_TEMP 'native-providers'
  $claude = $budget.providers.'@anthropic-ai/claude-code'
  $codex = $budget.providers.'@openai/codex'
  npm.cmd install --prefix $vendor --ignore-scripts --no-audit --no-fund "@anthropic-ai/claude-code-win32-x64@$claude" "@openai/codex@${codex}-win32-x64"
  if ($LASTEXITCODE) { throw 'Pinned provider download failed' }
  $claudeExe = Get-Item "$vendor/node_modules/@anthropic-ai/claude-code-win32-x64/claude.exe"
  $codexExe = @(Get-ChildItem "$vendor/node_modules/@openai/codex/vendor" -Recurse -Filter codex.exe)
  if ($codexExe.Count -ne 1) {throw 'Expected one native Codex executable'}
  # Stable Chrome on some hosted images does not expose the private CDP endpoint.
  $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $env:RUNNER_TEMP 'guard-browser'
  npx.cmd --yes playwright@1.64.1 install chromium-headless-shell
  if ($LASTEXITCODE) { throw 'Pinned headless Chromium download failed' }
  $shell = @(Get-ChildItem -LiteralPath $env:PLAYWRIGHT_BROWSERS_PATH -Recurse -File |
    Where-Object Name -in 'chrome-headless-shell.exe','headless_shell.exe')
  if ($shell.Count -ne 1) { throw "Expected one headless browser, found $($shell.Count)" }
  @("BENCH_CLAUDE=$($claudeExe.FullName)", "BENCH_CODEX=$($codexExe[0].FullName)", "BENCH_CHROME=$($shell[0].FullName)") |
    Out-File -Append -Encoding utf8 $env:GITHUB_ENV
  return
}

$pair = Get-Content -Raw (Join-Path $Results 'pair.json') | ConvertFrom-Json
$rounds = if ($Stage -eq 'first') {1} else {2..$budget.rounds}
foreach ($round in $rounds) {
  $order = if ($round % 2) { 'base','head' } else { 'head','base' }
  foreach ($side in $order) {
    $pkg = Join-Path $env:RUNNER_TEMP "package-$($pair.$side.run)/pkg"
    foreach ($scenario in 'unused','disabled','claudeAgent','codex','storage','ui0','ui8','ui16') {
      if (Get-ChildItem -LiteralPath $Results -Filter "$side-*-$scenario.json.failed") { continue }
      $file = Join-Path $Results "$side-$round-$scenario.json"
      Write-Host "Measuring $side round $round $scenario"
      if ($scenario -like 'ui*') {
        $env:BENCH_FIXED_SCROLL = if ($scenario -in 'ui8','ui16') { 'wheel' } else { $null }
        $benchArgs = @('chronos/scripts/bench/ui.mjs','desktop',$pkg,$scenario.Substring(2),$file)
      } elseif ($scenario -eq 'storage') {
        $benchArgs = @('chronos/scripts/bench/run.mjs',$pkg,8,$file)
      } else {
        $benchArgs = @('chronos/scripts/bench/guard-runtime.mjs',$pkg,$scenario,$file)
      }
      $log = & node @benchArgs 2>&1
      $exit = $LASTEXITCODE
      $log | Write-Host
      if ($exit) {
        $log | Select-Object -Last 35 | Out-File "$file.failed" -Encoding utf8
        Write-Host "::error::$side round $round $scenario failed (exit $exit)"
      }
    }
  }
}
# The comparator enforces completeness even when other scenarios still have useful evidence.
