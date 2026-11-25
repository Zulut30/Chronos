param([Parameter(Mandatory)][string]$Run, [Parameter(Mandatory)][string]$Destination)
$ErrorActionPreference = 'Stop'
if ($Run -notmatch '^\d+$') { throw 'Expected a desktop run ID' }
# A comparison can start with the reference build while the candidate is still packaging.
$deadline = [DateTime]::UtcNow.AddMinutes(20)
do {
  $artifacts = gh api "repos/$env:GITHUB_REPOSITORY/actions/runs/$Run/artifacts" | ConvertFrom-Json
  if ($LASTEXITCODE) { throw "Cannot list desktop artifacts for $Run" }
  if ($artifacts.artifacts | Where-Object { $_.name -eq 'chronos-win-x64' -and -not $_.expired }) { break }
  $state = gh api "repos/$env:GITHUB_REPOSITORY/actions/runs/$Run" | ConvertFrom-Json
  if ($LASTEXITCODE -or $state.status -eq 'completed' -or [DateTime]::UtcNow -ge $deadline) {
    throw "Windows artifact unavailable for run $Run ($($state.status) $($state.conclusion))"
  }
  Start-Sleep -Seconds 20
} while ($true)
gh run download $Run -R $env:GITHUB_REPOSITORY -n chronos-win-x64 -D $Destination
if ($LASTEXITCODE) { throw 'Desktop artifact download failed' }
$sevenZip = Join-Path $env:ProgramFiles '7-Zip/7z.exe'
$installer = @(Get-ChildItem -LiteralPath $Destination -File -Filter '*.exe')
if ($installer.Count -ne 1) { throw 'Expected one Windows installer' }
& $sevenZip e -y -bd "-o$Destination" $installer[0].FullName '-ir!app-64.7z'
if ($LASTEXITCODE) { throw 'NSIS extraction failed' }
& $sevenZip x -y -bd "-o$Destination/pkg" (Join-Path $Destination 'app-64.7z')
if ($LASTEXITCODE) { throw 'Payload extraction failed' }
