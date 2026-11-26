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
  & "$PSScriptRoot/unpack.ps1" -Run $build -Destination (Join-Path $env:RUNNER_TEMP "ui-package-$build")
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
      'ram' {
        node "$PSScriptRoot/ram-audit.mjs" $pkg "$out/ram-audit.json"
        if ($LASTEXITCODE) { $errors += "Ram $build pass $pass" }
      }
      default { throw "Unknown benchmark suite $env:SUITE" }
    }
  }
}
if ($errors.Count) { throw ($errors -join ', ') }
