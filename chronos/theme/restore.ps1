# Usage: restore.ps1            -> remove the Day / night button, keep the 4 MiB image limit
#        restore.ps1 -Pristine  -> return the untouched T3 package (themes over 50000 CSS chars stop loading)
param([switch]$Pristine)
$ErrorActionPreference = 'Stop'
$manifest = Get-Content -LiteralPath 'C:\Users\zulut\.t3\caches\t3-customizations\olympus-v2\patch-manifest.json' -Raw | ConvertFrom-Json
$appPath = 'C:\Users\zulut\AppData\Local\Programs\t3code\T3 Code (Nightly).exe'
$source = if ($Pristine) { $manifest.pristineBackup } else { $manifest.imageLimitArchive }
$expected = if ($Pristine) { $manifest.pristineSha256 } else { $manifest.imageLimitSha256 }
if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Backup verification failed.' }
if ((Get-FileHash -LiteralPath $manifest.originalArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.patchedSha256) { throw 'Installed package was updated or changed; refusing to overwrite it.' }
foreach ($process in @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $appPath })) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3
Copy-Item -LiteralPath $source -Destination $manifest.originalArchive -Force
Start-Process -FilePath $appPath
Write-Output 'Restored.'
