# Copies the Chronos sources from the live install folders into this repo (whitelist only).
# Never copies: T3's own compiled bundles / server.asar, service state & data, logs, keys, generated model dumps, binaries.
$ErrorActionPreference = 'Stop'
$src  = 'C:\Users\zulut\.t3\caches\t3-customizations'
$repo = $PSScriptRoot

function Put([string]$from, [string]$to, [string[]]$include, [switch]$Recurse, [string[]]$exclude = @()) {
    $base = Join-Path $src $from
    if (-not (Test-Path -LiteralPath $base)) { Write-Warning "missing $base"; return }
    if (Test-Path -LiteralPath $base -PathType Leaf) { Copy-Item -LiteralPath $base -Destination (Join-Path (Join-Path $repo $to) (Split-Path $base -Leaf)) -Force; return }
    $files = Get-ChildItem -LiteralPath $base -File -Recurse:$Recurse -Force |
        Where-Object { $n = $_.Name; ($include | Where-Object { $n -like $_ }) } |
        Where-Object { $rel = $_.FullName.Substring($base.Length + 1); -not ($exclude | Where-Object { $rel -like $_ }) }
    foreach ($f in $files) {
        $rel = $f.FullName.Substring($base.Length + 1)
        $dst = Join-Path (Join-Path $repo $to) $rel
        New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
        Copy-Item -LiteralPath $f.FullName -Destination $dst -Force
    }
}
$code = @('*.mjs', '*.js', '*.jsx', '*.py', '*.ps1', '*.vbs', '*.md', '*.css', '*.html', '*.svg')

# clean generated folders first (keeps README/.gitignore/brand/sync.ps1)
foreach ($d in 'theme', 'client', 'installer', 'services') { if (Test-Path (Join-Path $repo $d)) { Remove-Item -Recurse -Force (Join-Path $repo $d) } }

Put 'AGENTS-BRIEF.md' '.' @('AGENTS-BRIEF.md')
# theme (Olympus day/night)
Put 'olympus-v2' 'theme' ($code + @('*.meta.json', '*.imgs.json', 'olympus.json', 'apollo-1400.webp', 'apollo-1700.webp')) -Recurse -exclude @('staged-assets\*', '__pycache__\*', 'main-patched.js', 'olympus.test.css')
# client feature scripts + Russian UI
Put 'ru-l10n\features' 'client\features' @('*.js')
Put 'ru-l10n' 'client\l10n' @('*.json', '*.py', '*.js', '*.md') -Recurse -exclude @('features\*')
# installer / archive builder / verification
Put 'olympus-v3' 'installer' @('*.py', '*.mjs', '*.ps1', 'README.md') -exclude @()
Put 'olympus-v3\src' 'installer\src' $code
Put 'olympus-v3\test-work' 'installer\test-work' @('*.mjs', '*.js', '*.py')
Put 'olympus-v3\update-studio-chat' 'installer\update-studio-chat' @('*.py', '*.mjs', '*.ps1')
Put 'olympus-images-20261116' 'installer\image-limit' @('*.py', '*.ps1')
# local services
foreach ($s in 'files-service', 'integrations-service', 'openrouter-service', 'skills-manager', 'tasks-service') { Put $s "services\$s" $code }
Put 'studio-service' 'services\studio-service' $code
Put 'studio-service\app-src' 'services\studio-service\app-src' ($code + @('package.json'))
Put 'studio-service\public' 'services\studio-service\public' @('index.html', 'hub.css')
Write-Output ('synced ' + (Get-ChildItem $repo -Recurse -File -Force | Where-Object { $_.FullName -notmatch '\\\.git\\' }).Count + ' files')
