$ErrorActionPreference = 'Stop'
$patchRoot = 'C:\Users\zulut\.t3\caches\t3-customizations\olympus-images-20261116'
$manifest = Get-Content -LiteralPath (Join-Path $patchRoot 'patch-manifest.json') -Raw | ConvertFrom-Json
$appPath = 'C:\Users\zulut\AppData\Local\Programs\t3code\T3 Code (Nightly).exe'
if ((Get-FileHash -LiteralPath $manifest.backup -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.originalSha256) { throw 'Backup verification failed.' }
if ((Get-FileHash -LiteralPath $manifest.originalArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.patchedSha256) { throw 'Installed package was updated or changed; refusing to overwrite it.' }
foreach ($process in @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $appPath })) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
Copy-Item -LiteralPath $manifest.backup -Destination $manifest.originalArchive -Force
Start-Process -FilePath $appPath -WindowStyle Hidden
Write-Output 'Original T3 package restored. Themes larger than 50000 CSS characters require the local patch.'
