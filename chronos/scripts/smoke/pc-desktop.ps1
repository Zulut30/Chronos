param([Parameter(Mandatory)][string]$Tools)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Requires an isolated GitHub-hosted Windows runner.' }
$private = Join-Path $Tools 'private-desktop.exe'
$desktop = Join-Path $Tools 'agent-desktop.exe'
$deskName = 'ChronosPC-' + [guid]::NewGuid().ToString('N')
$dir = Join-Path $env:RUNNER_TEMP $deskName
New-Item -Type Directory -Path $dir | Out-Null
$env:AGENT_DESKTOP_HOME = Join-Path $dir 'state'
$note = Join-Path $env:WINDIR 'System32\notepad.exe'
$doc = Join-Path $dir 'background.txt'
[IO.File]::WriteAllText($doc,'seed')
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class InputProbe {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x,y; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  public static string Sample() { POINT p; if(!GetCursorPos(out p)) throw new Exception("No input desktop"); return GetForegroundWindow().ToString()+"/"+p.x+"/"+p.y; }
}
'@
function Invoke-Desktop([string[]]$CliArgs) {
  $r = & $private $deskName run $desktop @CliArgs
  if (-not $r) { throw "No result from $($CliArgs[0])" }
  $j = $r | ConvertFrom-Json
  if (-not $j.ok) { throw ($j.error | ConvertTo-Json -Depth 4 -Compress) }
  return $j.data
}
function Nodes($node) {
  $node
  foreach ($child in $node.children) { Nodes $child }
}
$baseline = [InputProbe]::Sample()
$owned = (& $private $deskName launch $note $doc | ConvertFrom-Json).pid
if (-not $owned) { throw 'Notepad failed to start' }
try {
  $until = [DateTime]::UtcNow.AddSeconds(15)
  do {
    try { $snap = Invoke-Desktop @('snapshot','--app','notepad.exe','-i'); break }
    catch { if ([DateTime]::UtcNow -ge $until) { throw }; Start-Sleep -Milliseconds 300 }
  } while ($true)
  if ([InputProbe]::Sample() -ne $baseline) { throw 'Launch changed the input desktop' }
  $nodes = @(Nodes $snap.tree)
  $nodes | Select-Object role,name,ref_id,available_actions | Format-Table -Wrap | Out-Host
  $edit = $nodes | Where-Object { $_.available_actions -contains 'SetValue' -or $_.role -in 'edit','textbox','text area','document','text_field','textarea','text-field' } | Select-Object -First 1
  if (-not $edit.ref_id) { throw 'Notepad has no semantic text field' }
  $text = 'Chronos background test'
  Invoke-Desktop @('set-value',$edit.ref_id,$text) | Out-Null
  if ([InputProbe]::Sample() -ne $baseline) { throw 'Writing changed focus or cursor' }
  Write-Host 'Notepad accepted a background semantic write.'
} finally {
  Stop-Process -Id $owned -ErrorAction SilentlyContinue
}
