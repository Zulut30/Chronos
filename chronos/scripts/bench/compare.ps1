$ErrorActionPreference = 'Stop'
$builds = $env:BUILDS.Split(',')
if ($builds.Count -lt 2 -or ($builds | Where-Object { $_ -notmatch '^\d+$' })) {
  throw 'Expected at least two desktop build IDs'
}
$results = Join-Path $env:RUNNER_TEMP 'ui-results'
if ($env:SUITE -eq 'server') {
  $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $env:RUNNER_TEMP 'bench-browser'
  npx.cmd --yes playwright@1.64.1 install chromium-headless-shell
  if ($LASTEXITCODE) { throw 'Cannot install the pinned benchmark browser' }
  $shell = @(Get-ChildItem -LiteralPath $env:PLAYWRIGHT_BROWSERS_PATH -Recurse -File |
    Where-Object Name -in 'chrome-headless-shell.exe','headless_shell.exe')
  if ($shell.Count -ne 1) { throw "Expected one headless shell, found $($shell.Count)" }
  $env:BENCH_CHROME = $shell[0].FullName
}
foreach ($build in ($builds | Select-Object -Unique)) {
  $destination = Join-Path $env:RUNNER_TEMP "ui-package-$build"
  & "$PSScriptRoot/unpack.ps1" -Run $build -Destination $destination
  if ($env:SUITE -eq 'idle') {
    $marker = Join-Path $destination 'perf-source.txt'
    $sha = if (Test-Path -LiteralPath $marker) { (Get-Content -Raw -LiteralPath $marker).Trim() } else {
      gh api "repos/$env:GITHUB_REPOSITORY/actions/runs/$build" --jq '.head_sha'
    }
    if ($sha -notmatch '^[a-f0-9]{40}$') { throw "Missing package SHA for $build" }
    $file = 'apps/web/src/chronos/olympus/featureFlags.ts'
    $source = gh api "repos/$env:GITHUB_REPOSITORY/contents/${file}?ref=$sha" --jq '.content'
    if ($LASTEXITCODE) { throw "Cannot read feature switches at $sha" }
    [IO.File]::WriteAllBytes((Join-Path $destination 'featureFlags.mts'), [Convert]::FromBase64String(($source -join '')))
  }
}
$env:BENCH_FIXED_SCROLL = if ($env:SUITE -eq 'wheel') { 'wheel' } else { '1' }
$errors = @()
foreach ($pass in 1..3) {
  $order = $builds.Clone()
  if ($pass % 2 -eq 0) { [array]::Reverse($order) }
  foreach ($build in $order) {
    $pkg = Join-Path $env:RUNNER_TEMP "ui-package-$build/pkg"
    $out = Join-Path $results "$build/pass-$pass"
    New-Item -ItemType Directory -Force $out | Out-Null
    switch ($env:SUITE) {
      'idle' {
        $env:BENCH_IDLE_MODULES = '1'
        foreach ($scenario in 'unused','disabled') {
          node "$PSScriptRoot/guard-runtime.mjs" $pkg $scenario "$out/$scenario.json"
          if ($LASTEXITCODE) { $errors += "Idle $build $scenario pass $pass" }
        }
      }
      'startup' {
        node "$PSScriptRoot/ui.mjs" desktop $pkg 0 "$out/startup.json" startup
        if ($LASTEXITCODE) { $errors += "Startup $build pass $pass" }
      }
      { $_ -in 'scroll','wheel' } {
        foreach ($n in 8,16) {
          node "$PSScriptRoot/ui.mjs" desktop $pkg $n "$out/$n.json"
          if ($LASTEXITCODE) { $errors += "Scroll $build N=$n pass $pass" }
        }
      }
      'renderer' {
        $env:BENCH_UI_ROWS = '1000'
        node "$PSScriptRoot/ui.mjs" desktop $pkg 16 "$out/1000-16.json"
        if ($LASTEXITCODE) { $errors += "Renderer $build pass $pass" }
      }
      'server' {
        foreach ($n in 8,16) {
          node "$PSScriptRoot/run.mjs" $pkg $n "$out/server-$n.json"
          if ($LASTEXITCODE) { $errors += "Server $build N=$n pass $pass" }
        }
      }
      default { throw "Unknown benchmark suite $env:SUITE" }
    }
  }
}
if ($errors.Count) { throw ($errors -join ', ') }
