$ErrorActionPreference = 'Stop'
$patchRoot = 'C:\Users\zulut\.t3\caches\t3-customizations\olympus-v2'
$manifest = Get-Content -LiteralPath (Join-Path $patchRoot 'patch-manifest.json') -Raw | ConvertFrom-Json
$appPath = 'C:\Users\zulut\AppData\Local\Programs\t3code\T3 Code (Nightly).exe'
$logPath = Join-Path $patchRoot 'apply.log'
$replaced = $false
Start-Transcript -LiteralPath $logPath -Force
try {
    # Wait (up to 24 h) for the user to quit T3 so running threads are never interrupted.
    $deadline = (Get-Date).AddHours(24)
    while (@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $appPath }).Count -gt 0) {
        if ((Get-Date) -gt $deadline) { throw 'T3 was not closed within 24 hours; nothing changed.' }
        Start-Sleep -Seconds 5
    }
    Start-Sleep -Seconds 3
    if ((Get-Item -LiteralPath $appPath).VersionInfo.FileVersion -ne $manifest.version) { throw 'T3 version changed after preparation.' }
    if ((Get-FileHash -LiteralPath $manifest.originalArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.installedBeforeSha256) { throw 'Installed archive differs from the verified image-limit build.' }
    if ((Get-FileHash -LiteralPath $manifest.stagedArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.patchedSha256) { throw 'Staged archive differs from the verified build.' }
    Copy-Item -LiteralPath $manifest.stagedArchive -Destination ($manifest.originalArchive + '.olympus-pending') -Force
    Move-Item -LiteralPath ($manifest.originalArchive + '.olympus-pending') -Destination $manifest.originalArchive -Force
    $replaced = $true
    if ((Get-FileHash -LiteralPath $manifest.originalArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.patchedSha256) { throw 'Installed copy failed verification.' }
    Start-Process -FilePath $appPath
    Write-Output 'COMPLETE: Day / night button installed; T3 restarted.'
} catch {
    Write-Output "FAILED: $_"
    if ($replaced) { Copy-Item -LiteralPath $manifest.imageLimitArchive -Destination $manifest.originalArchive -Force; Write-Output 'Previous (image-limit) archive restored.' }
    Start-Process -FilePath $appPath
    throw
} finally {
    Stop-Transcript
}
