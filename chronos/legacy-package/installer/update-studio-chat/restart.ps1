# Board-to-chat update: wait -> close T3 -> update.py --apply (auto-restores v3 on failure) -> relaunch T3 visibly -> post-verify.
# Control while waiting: file 'restart-now' starts immediately, 'restart-cancel' aborts without changes. Status: restart-check.json.
param([int]$DelaySeconds = 120)
$ErrorActionPreference = 'Stop'
$root = 'C:\Users\zulut\.t3\caches\t3-customizations\olympus-v3\update-studio-chat'
$appPath = 'C:\Users\zulut\AppData\Local\Programs\t3code\T3 Code (Nightly).exe'
$nodePath = 'C:\Program Files\nodejs\node.exe'
$pythonPath = 'C:\Users\zulut\AppData\Local\Programs\Python\Python313\python.exe'
$runtimePath = 'C:\Users\zulut\.t3\userdata\server-runtime.json'
$statusPath = Join-Path $root 'restart-check.json'
$state = [ordered]@{ phase = 'waiting'; helperPid = $PID; helperStartedAt = (Get-Date).ToUniversalTime().ToString('o'); installed = $false; restarted = $false }
function Save-Status { $state.updatedAt = (Get-Date).ToUniversalTime().ToString('o'); $state | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 -LiteralPath $statusPath }
function Log($m) { Write-Output ('[' + (Get-Date).ToString('HH:mm:ss') + '] ' + $m) }
function Get-T3 { @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $appPath }) }
function Start-ViaShell($path) { Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $path + '"') }

Start-Transcript -LiteralPath (Join-Path $root 'restart.log') -Force | Out-Null
try {
    Remove-Item -LiteralPath (Join-Path $root 'restart-now'), (Join-Path $root 'restart-cancel') -ErrorAction SilentlyContinue
    $before = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json
    $before | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $root 'restart-before.json')
    Save-Status
    Log "Waiting up to $DelaySeconds s (restart-now / restart-cancel files control this)."
    $deadline = (Get-Date).AddSeconds($DelaySeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Path -LiteralPath (Join-Path $root 'restart-cancel')) { $state.phase = 'cancelled'; Save-Status; Log 'Cancelled; nothing changed.'; return }
        if (Test-Path -LiteralPath (Join-Path $root 'restart-now')) { break }
        Start-Sleep -Seconds 2
    }
    $state.phase = 'closing-t3'; Save-Status
    foreach ($p in @(Get-T3 | Where-Object { $_.CommandLine -notmatch '--type=' })) { $gp = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue; if ($gp) { $null = $gp.CloseMainWindow() } }
    Start-Sleep -Seconds 6
    foreach ($p in Get-T3) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    for ($i = 0; $i -lt 30 -and (Get-T3).Count; $i++) { Start-Sleep -Seconds 1 }
    if ((Get-T3).Count) { throw 'T3 did not exit; nothing installed.' }
    Start-Sleep -Seconds 2
    Log 'T3 closed.'

    $state.phase = 'installing'; Save-Status
    $out = & $pythonPath -I (Join-Path $root 'update.py') --apply 2>&1
    $out | ForEach-Object { Log $_ }
    if ($LASTEXITCODE -ne 0) { throw 'update.py --apply failed (v3 kept/restored).' }
    $state.installed = $true; Save-Status

    $profileRoot = [IO.Path]::GetFullPath('C:\Users\zulut\AppData\Roaming\t3code-v2')
    foreach ($name in @('Cache', 'Code Cache')) {
        $source = [IO.Path]::GetFullPath((Join-Path $profileRoot $name))
        $destination = $source + '.before-studio-chat-' + (Get-Date).ToString('yyyyMMddHHmmss')
        if (-not $source.StartsWith($profileRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Cache path escaped the T3 profile.' }
        if (Test-Path -LiteralPath $source) { Move-Item -LiteralPath $source -Destination $destination }
    }

    $state.phase = 'launching-t3'; Save-Status
    Start-ViaShell $appPath
    $runtime = $null
    for ($i = 0; $i -lt 90; $i++) {
        Start-Sleep -Seconds 2
        try { $r = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json; if ($r.startedAt -ne $before.startedAt) { $null = Invoke-WebRequest -UseBasicParsing -Uri ($r.origin + '/') -TimeoutSec 3; $runtime = $r; break } } catch { }
    }
    if (-not $runtime) { throw 'T3 server did not start within 3 minutes.' }
    $state.restarted = $true; $state.server = @{ pid = $runtime.pid; startedAt = $runtime.startedAt }
    $visible = $false
    for ($i = 0; $i -lt 30 -and -not $visible; $i++) { Start-Sleep -Seconds 1; $visible = [bool](@(Get-T3 | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } | Where-Object { $_.MainWindowHandle -ne 0 }).Count) }
    $state.windowVisible = $visible
    Log "T3 server up: pid $($runtime.pid), started $($runtime.startedAt); window visible: $visible"
    Start-Sleep -Seconds 8

    $state.phase = 'verifying'; Save-Status
    $verify = & $nodePath (Join-Path $root 'post-verify.mjs') (Join-Path $root 'restart-before.json') 2>&1
    $verify | ForEach-Object { Log $_ }
    $state.verified = ($LASTEXITCODE -eq 0)
    $state.phase = $(if ($state.verified -and $visible) { 'complete' } else { 'complete-with-failures' })
    Save-Status
    Log ('DONE: ' + $state.phase)
} catch {
    Log ('ERROR: ' + $_)
    $state.phase = 'error'; $state.error = $_.ToString(); Save-Status
    if (-not (Get-T3).Count) { Start-ViaShell $appPath; Log 'T3 relaunched after error.' }
} finally { Stop-Transcript | Out-Null }
