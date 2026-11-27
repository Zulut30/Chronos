param([Parameter(Mandatory)][string]$Executable, [Parameter(Mandatory)][string]$ArtifactId)
$ErrorActionPreference = 'Stop'
if ($env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Expected a disposable hosted Windows runner' }
$title = 'Chronos upgrade fixture'
$shell = New-Object -ComObject WScript.Shell
$links = @(
  (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) "$title.lnk"),
  (Join-Path ([Environment]::GetFolderPath('Programs')) "Chronos\$title.lnk")
)
$shortcuts = foreach ($path in $links) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing shortcut $path" }
  $shortcut = $shell.CreateShortcut($path)
  if ($shortcut.Arguments -ne "--chronos-artifact=$ArtifactId") { throw 'Wrong shortcut arguments' }
  $icon = ($shortcut.IconLocation -replace ',\s*-?\d+$','').Trim('"')
  if (-not (Test-Path -LiteralPath $icon -PathType Leaf)) { throw 'Missing artifact icon' }
  [pscustomobject]@{target=$shortcut.TargetPath; arguments=$shortcut.Arguments; iconHash=(Get-FileHash -LiteralPath $icon).Hash}
}
$key = [Microsoft.Win32.Registry]::ClassesRoot.OpenSubKey('chronos')
if (-not $key -or 'URL Protocol' -notin $key.GetValueNames()) { throw 'Missing chronos URL Protocol' }
$command = $key.OpenSubKey('shell\open\command').GetValue('')
if ($command -notmatch '^"([^"]+)"\s+.*"?%1"?') { throw "Invalid protocol registration $command" }
[pscustomobject]@{protocolTarget=$Matches[1]; command=$command; shortcuts=@($shortcuts)} | ConvertTo-Json -Depth 4
