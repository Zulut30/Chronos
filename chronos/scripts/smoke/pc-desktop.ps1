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
using System.Threading;
public static class InputProbe {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x,y; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [StructLayout(LayoutKind.Sequential)] struct Gui { public int size,flags; public IntPtr active,focus,capture,menu,move,caret; public int l,t,r,b; }
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread,ref Gui gui);
  public static string Sample() { POINT p; Gui gui=new Gui(); gui.size=Marshal.SizeOf(gui); if(!GetCursorPos(out p) || !GetGUIThreadInfo(0,ref gui)) throw new Exception("No input desktop"); return GetForegroundWindow().ToString()+"/"+gui.focus+"/"+p.x+"/"+p.y; }
  static Timer timer; public static int changes, samples;
  public static void Watch(string expected) { timer=new Timer(_ => { try { if (Sample()!=expected) Interlocked.Increment(ref changes); } catch { Interlocked.Increment(ref changes); } Interlocked.Increment(ref samples); },null,0,5); }
  public static void End() { timer.Dispose(); }
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
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$fixture = Join-Path $dir 'ChronosFields.exe'
& $csc /nologo /target:winexe "/out:$fixture" /reference:System.Windows.Forms.dll (Join-Path $PSScriptRoot 'PcFields.cs')
if ($LASTEXITCODE) { throw 'Fixture compile failed' }
$baseline = [InputProbe]::Sample()
[InputProbe]::Watch($baseline)
$owned = (& $private $deskName launch $note $doc | ConvertFrom-Json).pid
if (-not $owned) { throw 'Notepad failed to start' }
try {
  Write-Host "Windows session $([Diagnostics.Process]::GetCurrentProcess().SessionId), foreground/cursor $baseline"
  Get-Process -Id $owned | Select-Object ProcessName,SessionId,Responding,HasExited | Out-Host
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
  $fileRef = ($nodes | Where-Object { $_.name -eq 'File' -and $_.role -eq 'menuitem' } | Select-Object -First 1).ref_id
  Invoke-Desktop @('expand',$fileRef) | Out-Null
  $menu = Invoke-Desktop @('snapshot','--app','notepad.exe','--surface','menu','-i')
  $save = (Nodes $menu.tree | Where-Object { $_.name -match '^&?Save(?:$|\s)' -and $_.name -notmatch 'As' } | Select-Object -First 1).ref_id
  if (-not $save) { throw 'Save has no semantic menu ref' }
  Invoke-Desktop @('click',$save) | Out-Null
  if ([IO.File]::ReadAllText($doc).TrimEnd() -ne $text) { throw 'Notepad file failed independent readback' }
  Write-Host 'PASS Notepad saved the temporary document.'

  $receipt = Join-Path $dir 'fields.txt'
  $fieldPid = (& $private $deskName launch $fixture $receipt | ConvertFrom-Json).pid
  if (-not $fieldPid) { throw 'Fixture launch failed' }
  try {
    foreach ($name in 'First','Second') {
      $fields = Invoke-Desktop @('snapshot','--app','ChronosFields.exe','-i')
      $ref = (Nodes $fields.tree | Where-Object name -eq $name | Select-Object -First 1).ref_id
      Invoke-Desktop @('set-value',$ref,($name+' value')) | Out-Null
    }
    $fields = Invoke-Desktop @('snapshot','--app','ChronosFields.exe','-i')
    $button = (Nodes $fields.tree | Where-Object name -eq 'Check' | Select-Object -First 1).ref_id
    Invoke-Desktop @('click',$button) | Out-Null
    if (([IO.File]::ReadAllText($receipt)) -ne 'First value/Second value') { throw 'Native form did not receive both values' }

    foreach ($i in 1..3) {
      $metrics = Join-Path $dir "metrics-$i.txt"
      $measured = & $private $deskName measure $desktop snapshot --app ChronosFields.exe -i 2> $metrics
      if ($LASTEXITCODE -or -not ($measured | ConvertFrom-Json).ok) { throw 'Invalid resource measurement' }
      $line = Get-Content -Raw $metrics
      Write-Host "Native snapshot $i $line"
      "Native snapshot $i $line" | Out-File -Append $env:GITHUB_STEP_SUMMARY
    }
    # Dedicated runner and this exact released image. No agent-desktop process survives the commands.
    Start-Sleep -Milliseconds 250
    $idle = @(Get-Process -Name agent-desktop -ErrorAction SilentlyContinue | Where-Object Path -eq $desktop)
    if ($idle.Count) { throw 'Native CLI remained alive after the last command' }
    Write-Host "Idle CLI: 0 processes, 0 bytes, 0 CPU. Foreground, keyboard focus and pointer: $([InputProbe]::samples) samples, $([InputProbe]::changes) changes."
    if ([InputProbe]::changes -or [InputProbe]::samples -lt 2) { throw 'Foreground, keyboard focus or cursor changed' }
  } finally {
    Stop-Process -Id $fieldPid -ErrorAction SilentlyContinue
  }
} finally {
  [InputProbe]::End()
  Stop-Process -Id $owned -ErrorAction SilentlyContinue
}
