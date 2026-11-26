$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'ChronosSwitchTools'
if (-not (Test-Path -LiteralPath "$root\pyvenv.cfg")) {
    if (Test-Path -LiteralPath $root) { throw 'Target already exists without a Python venv.' }
    & uv venv $root --python (Get-Command python.exe).Source
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
& uv pip install --python "$root\Scripts\python.exe" psutil==7.1.3 tomlkit==0.13.3
exit $LASTEXITCODE
