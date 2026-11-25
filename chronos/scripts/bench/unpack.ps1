param([Parameter(Mandatory)][string]$Run, [Parameter(Mandatory)][string]$Destination)
$ErrorActionPreference = 'Stop'
if ($Run -notmatch '^\d+$') { throw 'Expected a desktop run ID' }
gh run download $Run -R $env:GITHUB_REPOSITORY -n chronos-win-x64 -p '*.exe' -D $Destination
if ($LASTEXITCODE) { throw 'Desktop artifact download failed' }
$sevenZip = Join-Path $env:ProgramFiles '7-Zip/7z.exe'
$installer = @(Get-ChildItem -LiteralPath $Destination -File -Filter '*.exe')
if ($installer.Count -ne 1) { throw 'Expected one Windows installer' }
& $sevenZip e -y -bd "-o$Destination" $installer[0].FullName '-ir!app-64.7z'
if ($LASTEXITCODE) { throw 'NSIS extraction failed' }
& $sevenZip x -y -bd "-o$Destination/pkg" (Join-Path $Destination 'app-64.7z')
if ($LASTEXITCODE) { throw 'Payload extraction failed' }
