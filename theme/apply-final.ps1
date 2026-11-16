$ErrorActionPreference = 'Stop'
$patchRoot = 'C:\Users\zulut\.t3\caches\t3-customizations\olympus-v2'
$manifest = Get-Content -LiteralPath (Join-Path $patchRoot 'patch-manifest.json') -Raw | ConvertFrom-Json
$appPath = 'C:\Users\zulut\AppData\Local\Programs\t3code\T3 Code (Nightly).exe'
$logPath = Join-Path $patchRoot 'apply.log'
$replaced = $false
Start-Transcript -LiteralPath $logPath -Force
try {
    # User asked to update now: give the agent 45 s to finish its reply, then close T3 gracefully.
    Start-Sleep -Seconds 45
    foreach ($process in @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $appPath -and $_.CommandLine -notmatch "--type=" })) { $n = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue; if ($n) { $null = $n.CloseMainWindow() } }
    Start-Sleep -Seconds 8
    foreach ($process in @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $appPath })) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
    $deadline = (Get-Date).AddMinutes(2)
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
    # Merge the OpenRouter provider instance (OpenCode driver) into T3 settings while T3 is closed.
    $settingsPath = Join-Path $env:USERPROFILE '.t3\userdata\settings.json'
    $instPath = 'C:\Users\zulut\.t3\caches\t3-customizations\openrouter-service\provider-instance.json'
    if ((Test-Path $settingsPath) -and (Test-Path $instPath)) {
        Copy-Item $settingsPath ($settingsPath + '.before-openrouter-20261116') -Force
        $py = "import json,sys;s=json.load(open(sys.argv[1],encoding='utf8'));p=json.load(open(sys.argv[2],encoding='utf8'));s.setdefault('providerInstances',{}).update(p['providerInstances']);open(sys.argv[1],'w',encoding='utf8').write(json.dumps(s,ensure_ascii=False,indent=2))"
        python -I -c $py $settingsPath $instPath
        Write-Output 'OpenRouter provider instance merged into settings.json'
    }
    # Fresh user environment (OPENROUTER_API_KEY and API keys set after T3 started).
    $userEnv = Get-Item 'HKCU:\Environment'
    foreach ($name in $userEnv.GetValueNames()) { if ($name -and $name -ne 'Path' -and $name -ne 'TEMP' -and $name -ne 'TMP') { Set-Item -Path ('Env:' + $name) -Value $userEnv.GetValue($name) } }
    Start-Process -FilePath $appPath
    Write-Output 'COMPLETE: Olympus bundle installed; T3 restarted.'
} catch {
    Write-Output "FAILED: $_"
    if ($replaced) { Copy-Item -LiteralPath $manifest.imageLimitArchive -Destination $manifest.originalArchive -Force; Write-Output 'Previous (image-limit) archive restored.' }
    Start-Process -FilePath $appPath
    throw
} finally {
    Stop-Transcript
}
