[CmdletBinding()]
param([switch]$Install,[string]$Installer,[string]$ProfileHome=$env:USERPROFILE)
$ErrorActionPreference='Stop'
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'services.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if(-not [Environment]::Is64BitOperatingSystem -or $env:OS -ne 'Windows_NT'){throw 'This compatibility package requires Windows x64.'}
$cacheRoot=Join-Path $ProfileHome '.t3\caches\t3-customizations'
foreach($service in $manifest.services){
  if(-not(Test-Path -LiteralPath (Join-Path $cacheRoot $service.directory) -PathType Container)){throw "Missing existing service: $($service.id)"}
  $health=Invoke-RestMethod -Uri "http://127.0.0.1:$($service.port)$($service.health)" -TimeoutSec 8
  if(-not $health.ok -or ($service.service -and $health.service -ne $service.service)){throw "Incompatible service: $($service.id)"}
}
$codexConfig=Join-Path $ProfileHome '.codex\config.toml'
if(-not(Test-Path -LiteralPath $codexConfig)){throw 'Existing Codex MCP config missing; refusing a partial migration.'}
$config=Get-Content -LiteralPath $codexConfig -Raw -Encoding UTF8
foreach($name in $manifest.stdio){if($config -notmatch ('(?m)^\[mcp_servers\.'+[regex]::Escape($name)+'\]')){throw "Existing MCP registration missing: $name"}}
$projects=Invoke-RestMethod -Uri 'http://127.0.0.1:4518/api/projects' -TimeoutSec 8
foreach($project in $projects){foreach($field in 'id','title','root'){if($field -notin $project.PSObject.Properties.Name){throw "Incompatible task project contract: $field"}}}
$boards=Invoke-RestMethod -Uri 'http://127.0.0.1:4520/api/boards' -TimeoutSec 8
if('boards' -notin $boards.PSObject.Properties.Name){throw 'Incompatible Studio contract.'}
Write-Output 'Compatibility preflight passed: six local services, task/Studio contracts and existing Codex MCP registrations.'
if(-not $Install){Write-Output 'Preflight only. Nothing installed or changed.';return}
if(-not $Installer){$candidate=@(Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.exe' -File);if($candidate.Count -ne 1){throw 'Specify one installer with -Installer.'};$Installer=$candidate[0].FullName}
$resolvedInstaller=(Resolve-Path -LiteralPath $Installer).Path
$checksums=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'SHA256SUMS.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$name=[IO.Path]::GetFileName($resolvedInstaller)
$expected=$checksums.PSObject.Properties[$name].Value
if(-not $expected -or (Get-FileHash -LiteralPath $resolvedInstaller -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){throw 'Installer SHA256 mismatch.'}
$protected=@()
foreach($relative in $manifest.preserve){
  $path=Join-Path $ProfileHome $relative
  if(Test-Path -LiteralPath $path -PathType Leaf){$protected+=Get-Item -LiteralPath $path}
  elseif(Test-Path -LiteralPath $path -PathType Container){$protected+=Get-ChildItem -LiteralPath $path -File -Recurse | Where-Object {$_.FullName -notmatch '[\\/](node_modules|\.git|logs|cache)[\\/]' -and $_.Extension -in '.json','.toml','.js','.mjs','.py','.html','.css','.vbs','.ps1'}}
}
$before=@{};foreach($file in $protected){$before[$file.FullName]=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash}
$checkpoint=Join-Path $ProfileHome ('.t3\chronos-install-checkpoints\'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $checkpoint | Out-Null
$before | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $checkpoint 'before-hashes.json') -Encoding UTF8
Write-Output 'Close T3 manually before continuing the installer. Existing services remain in place.'
$process=Start-Process -FilePath $resolvedInstaller -PassThru -Wait
if($process.ExitCode -ne 0){throw "Installer exited with code $($process.ExitCode)"}
$changed=@();foreach($file in $before.Keys){if(-not(Test-Path -LiteralPath $file) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $before[$file]){$changed+=$file}}
if($changed.Count){$changed | Set-Content -LiteralPath (Join-Path $checkpoint 'changed-paths.txt') -Encoding UTF8;throw "Protected files changed; inspect local checkpoint $checkpoint before starting Chronos."}
Write-Output 'Installer completed. Protected service sources, MCP configs and task/skill files match their pre-install hashes.'
