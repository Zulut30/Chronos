param([Parameter(Mandatory)][string]$Id)
$ErrorActionPreference = 'Stop'
if (-not $env:RUNNER_TEMP -or -not $env:CHRONOS_HOME) { throw 'Windows CI profile required' }
$shell = New-Object -ComObject WScript.Shell
$title = 'Проверка артефакта'
$desktop = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) ($title+'.lnk')
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) ('Chronos\'+$title+'.lnk')
foreach ($link in $desktop,$menu) {
  if (-not (Test-Path -LiteralPath $link)) {throw "Missing shortcut: $link"}
  $shortcut = $shell.CreateShortcut($link)
  if ($shortcut.Arguments -ne ('--chronos-artifact='+$Id) -or $shortcut.TargetPath -ne $env:CHRONOS_EXE) {throw 'Unexpected shortcut target'}
  if (-not (Test-Path -LiteralPath ($shortcut.IconLocation -replace ',\s*0$',''))) {throw 'Missing icon'}
}
if (Get-Process Chronos -ErrorAction SilentlyContinue | Where-Object MainWindowHandle) {throw 'A desktop window survived the smoke shutdown'}
$started = Start-Process -FilePath $desktop -PassThru
try {
  $deadline = [DateTime]::UtcNow.AddSeconds(40)
  do {
    Start-Sleep -Milliseconds 250
    $started.Refresh()
    $windows = @(Get-Process Chronos -ErrorAction SilentlyContinue | Where-Object MainWindowHandle)
    if ($windows.Count -eq 1 -and $windows[0].MainWindowTitle -eq $title) {break}
  } while ([DateTime]::UtcNow -lt $deadline -and -not $started.HasExited)
  if ($windows.Count -ne 1 -or $windows[0].MainWindowTitle -ne $title) {throw 'Shortcut did not open an artifact-only window'}
  $env:ARTIFACT_PROBE_ID=$Id
  node -e "const p=require('node:path'),s=require(p.join(p.dirname(process.env.CHRONOS_EXE),'resources/chronos-services/artifacts/store.mjs')).openArtifacts(process.env.CHRONOS_HOME); (async()=>{try{for(let i=0;i<80;i++){if(s.documents(process.env.ARTIFACT_PROBE_ID,'get',{collection:'probe',key:'frame'})?.opens>=2)return;await new Promise(r=>setTimeout(r,100));}throw Error('Standalone page did not render');}finally{s.close()}})()"
  if ($LASTEXITCODE) {exit $LASTEXITCODE}
  Write-Host 'PASS: both shortcuts, custom icon, cold start with a single artifact window'
} finally {
  if (-not $started.HasExited) { $null=$started.CloseMainWindow(); $null=$started.WaitForExit(5000) }
}
