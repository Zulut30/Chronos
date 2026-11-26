$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'ChronosSwitchTools'
$uv = (Get-Command uv.exe).Source
$systemPython = (Get-Command python.exe).Source
# Windows PowerShell 5.1 turns redirected native stderr into terminating errors under 'Stop'; uv logs progress there.
$ErrorActionPreference = 'Continue'
if (-not (Test-Path -LiteralPath "$root\pyvenv.cfg")) {
    if (Test-Path -LiteralPath $root) {
        $leftovers = @(Get-ChildItem -LiteralPath $root -Force | Where-Object { $_.Name -notin @('CACHEDIR.TAG', '.gitignore') })
        if ($leftovers.Count -gt 0) { throw 'Target already exists without a Python venv.' }
        Remove-Item -LiteralPath $root -Recurse -Force
    }
    & $uv venv $root --python $systemPython 2>&1 | ForEach-Object { "$_" }
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
& $uv pip install --python "$root\Scripts\python.exe" psutil==7.1.3 tomlkit==0.13.3 2>&1 | ForEach-Object { "$_" }
exit $LASTEXITCODE
