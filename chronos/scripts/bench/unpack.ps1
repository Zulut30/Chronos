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
foreach ($attempt in 1..4) {
  $download = gh run download $Run -R $env:GITHUB_REPOSITORY -n chronos-win-x64 -D $Destination 2>&1
  if ($LASTEXITCODE -eq 0) { break }
  # Azure can throttle a large artifact temporarily. gh errors can contain a signed blob URL.
  $reason = ($download -join ' ') -replace 'https?://\S+', '[URL]'
  if ($attempt -eq 4 -or $reason -notmatch 'HTTP (429|5\d\d)|timeout|connection reset|unexpected EOF') {
    throw "Desktop artifact $Run download failed: $reason"
  }
  Write-Warning "Temporary download failure for $Run (attempt $attempt): $reason"
  Start-Sleep -Seconds (15 * $attempt)
}
$sevenZip = Join-Path $env:ProgramFiles '7-Zip/7z.exe'
$installer = @(Get-ChildItem -LiteralPath $Destination -File -Filter '*.exe')
if ($installer.Count -ne 1) { throw 'Expected one Windows installer' }
& $sevenZip e -y -bd "-o$Destination" $installer[0].FullName '-ir!app-64.7z'
if ($LASTEXITCODE) { throw 'NSIS extraction failed' }
& $sevenZip x -y -bd "-o$Destination/pkg" (Join-Path $Destination 'app-64.7z')
if ($LASTEXITCODE) { throw 'Payload extraction failed' }
