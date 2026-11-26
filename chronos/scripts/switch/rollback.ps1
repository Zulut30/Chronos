param([string]$ChronosExe = "$env:LOCALAPPDATA\Programs\chronos\Chronos.exe")
& (Join-Path $PSScriptRoot 'invoke-switch.ps1') -Action rollback -ChronosExe $ChronosExe
exit $LASTEXITCODE
