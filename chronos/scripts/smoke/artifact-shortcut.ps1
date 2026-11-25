param([Parameter(Mandatory)][string]$Id)
$ErrorActionPreference = 'Stop'
if (-not $env:RUNNER_TEMP -or -not $env:CHRONOS_HOME) { throw 'Windows CI profile required' }
$Id = $Id.Trim()
$shell = New-Object -ComObject Shell.Application
$title = 'Проверка артефакта'
$desktop = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) ($title+'.lnk')
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) ('Chronos\'+$title+'.lnk')
foreach ($link in $desktop,$menu) {
  if (-not (Test-Path -LiteralPath $link)) {throw "Missing shortcut: $link"}
  $item = $shell.Namespace((Split-Path $link)).ParseName((Split-Path $link -Leaf))
  $shortcut = $item.GetLink
  $actualTarget = [string]$shortcut.Path
  $actualArgs = [string]$shortcut.Arguments
  if ($actualArgs -ne ('--chronos-artifact='+$Id)) {throw "Shortcut arguments [$actualArgs], expected [--chronos-artifact=$Id]"}
  if (-not (Test-Path -LiteralPath $actualTarget -PathType Leaf)) {throw "Shortcut target missing [$actualTarget]"}
  # The Shell can return an 8.3 spelling of exactly the same installed executable.
  $env:ARTIFACT_LINK_TARGET = $actualTarget
  node -e "const f=require('node:fs').realpathSync.native; if(f(process.env.ARTIFACT_LINK_TARGET).toLowerCase()!==f(process.env.CHRONOS_EXE).toLowerCase()) throw Error('Unexpected shortcut executable: '+process.env.ARTIFACT_LINK_TARGET)"
  if ($LASTEXITCODE) {exit $LASTEXITCODE}
  $iconPath = ''
  $null = $shortcut.GetIconLocation([ref]$iconPath)
  if (-not (Test-Path -LiteralPath $iconPath -PathType Leaf)) {throw "Missing shortcut icon [$iconPath]"}
}
if (Get-Process Chronos -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowHandle -ne [IntPtr]::Zero}) {throw 'A desktop window survived the smoke shutdown'}
$env:ARTIFACT_PROBE_ID=$Id
$env:ARTIFACT_PROBE_BASE=node -e "const p=require('node:path'),s=require(p.join(p.dirname(process.env.CHRONOS_EXE),'resources/chronos-services/artifacts/store.mjs')).openArtifacts(process.env.CHRONOS_HOME);console.log(s.documents(process.env.ARTIFACT_PROBE_ID,'get',{collection:'probe',key:'frame'}).opens);s.close()"
if ($LASTEXITCODE) {exit $LASTEXITCODE}
$baseline = @(Get-Process Chronos -ErrorAction SilentlyContinue | ForEach-Object Id)
$startMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
Start-Process -FilePath $desktop
$started = $null
try {
  $deadline = [DateTime]::UtcNow.AddSeconds(40)
  do {
    Start-Sleep -Milliseconds 250
    $windows = @(Get-Process Chronos -ErrorAction SilentlyContinue | Where-Object {$_.Id -notin $baseline -and $_.MainWindowHandle -ne [IntPtr]::Zero})
    if ($windows.Count -eq 1 -and $windows[0].MainWindowTitle -eq $title) {$started=$windows[0];break}
  } while ([DateTime]::UtcNow -lt $deadline)
  if ($windows.Count -ne 1 -or $windows[0].MainWindowTitle -ne $title) {
    $diagnostic = @(Get-Process Chronos -ErrorAction SilentlyContinue | Select-Object Id,SessionId,MainWindowTitle,MainWindowHandle)
    Write-Host ('Shortcut processes '+($diagnostic|ConvertTo-Json -Compress))
    $targets = @(Get-CimInstance Win32_Process -Filter "Name='Chronos.exe'" | Select-Object ProcessId,ParentProcessId,@{Name='artifactFlag';Expression={$_.CommandLine -like '*--chronos-artifact=*'}})
    Write-Host ('Shortcut launch '+($targets|ConvertTo-Json -Compress))
    node -e "const p=require('node:path'),s=require(p.join(p.dirname(process.env.CHRONOS_EXE),'resources/chronos-services/artifacts/store.mjs')).openArtifacts(process.env.CHRONOS_HOME);console.log('Frame after launch',s.documents(process.env.ARTIFACT_PROBE_ID,'get',{collection:'probe',key:'frame'}),'baseline',process.env.ARTIFACT_PROBE_BASE);s.close()"
    throw 'Shortcut did not open an artifact-only window'
  }
  node -e "const p=require('node:path'),s=require(p.join(p.dirname(process.env.CHRONOS_EXE),'resources/chronos-services/artifacts/store.mjs')).openArtifacts(process.env.CHRONOS_HOME); (async()=>{try{for(let i=0;i<80;i++){if(s.documents(process.env.ARTIFACT_PROBE_ID,'get',{collection:'probe',key:'frame'})?.opens>Number(process.env.ARTIFACT_PROBE_BASE))return;await new Promise(r=>setTimeout(r,100));}throw Error('Standalone page did not render');}finally{s.close()}})()"
  if ($LASTEXITCODE) {exit $LASTEXITCODE}
  $paintAt = node -e "const p=require('node:path'),s=require(p.join(p.dirname(process.env.CHRONOS_EXE),'resources/chronos-services/artifacts/store.mjs')).openArtifacts(process.env.CHRONOS_HOME);console.log(s.documents(process.env.ARTIFACT_PROBE_ID,'get',{collection:'probe',key:'frame'}).firstPaintAt);s.close()"
  if ($LASTEXITCODE) {exit $LASTEXITCODE}
  Start-Sleep -Milliseconds 1500
  $tree = & (Join-Path $PSScriptRoot 'artifact-process-tree.ps1') -RootId $started.Id | ConvertFrom-Json
  $tree | Add-Member -NotePropertyName firstPaintMs -NotePropertyValue ([Math]::Round(([double]$paintAt) - $startMs))
  Write-Host ('PACKAGED_COLD '+($tree|ConvertTo-Json -Compress))
  Write-Host 'PASS: both shortcuts, custom icon, cold start with a single artifact window'
} finally {
  if ($started -and -not $started.HasExited) { $null=$started.CloseMainWindow(); $null=$started.WaitForExit(5000) }
}
