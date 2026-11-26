param(
    [Parameter(Mandatory)][ValidateSet('preflight','switch','rollback')][string]$Action,
    [string]$ChronosExe = "$env:LOCALAPPDATA\Programs\chronos\Chronos.exe"
)
$ErrorActionPreference = 'Stop'
$python = $env:CHRONOS_SWITCH_PYTHON
if (-not $python) {
    $python = Join-Path $env:LOCALAPPDATA 'ChronosSwitchTools\Scripts\python.exe'
}
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    throw 'Install the switch tools with prepare-tools.ps1 first.'
}
$python = (Resolve-Path -LiteralPath $python).Path
$script = Join-Path $PSScriptRoot 'migrate.py'
if ($Action -eq 'preflight') {
    & $python -B -X utf8 $script $Action --chronos $ChronosExe
    exit $LASTEXITCODE
}
# Win32_Process.Create uses the WMI provider as the parent, outside the Olympus agent job.
$startup = New-CimInstance -ClientOnly -ClassName Win32_ProcessStartup -Property @{ ShowWindow = [uint16]0 }
foreach ($arg in @($python, $script, $ChronosExe)) {
    if ($arg.Contains('"')) { throw 'Invalid Windows path.' }
}
$command = '"{0}" -B -X utf8 "{1}" {2} --chronos "{3}"' -f $python,$script,$Action,$ChronosExe
$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $command
    CurrentDirectory = $PSScriptRoot
    ProcessStartupInformation = $startup
}
if ($result.ReturnValue -ne 0) { throw "Could not start detached worker ($($result.ReturnValue))." }
Write-Output "PID $($result.ProcessId). Logs: %USERPROFILE%\.chronos\logs"
