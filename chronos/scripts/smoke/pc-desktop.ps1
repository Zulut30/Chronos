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
    try { $snap = Invoke-Desktop @('snapshot','--app','notepad.exe','-i','--wait-for','textfield:Text Editor','--timeout-ms','15000','--wait-timeout','15000'); break }
    catch { if ([DateTime]::UtcNow -ge $until) { throw }; Start-Sleep -Milliseconds 300 }
  } while ($true)
  if ([InputProbe]::Sample() -ne $baseline) { throw 'Launch changed the input desktop' }
  $nodes = @(Nodes $snap.tree)
  $nodes | Select-Object role,name,ref_id,available_actions | Format-Table -Wrap | Out-Host
  # Only the edit control in our document is a valid write target. Scrollbars and
  # unnamed groups can also report SetValue. An incomplete tree cannot prove identity.
  $edits = @($nodes | Where-Object { $_.role -in 'edit','textbox','textfield','text_field','text-field' -and $_.name -eq 'Text Editor' -and $_.available_actions -contains 'SetValue' })
  if ($edits.Count -ne 1 -or -not $edits[0].ref_id) { throw 'Notepad has no unique semantic text field' }
  $edit = $edits[0]
  $text = 'Chronos background test'
  Invoke-Desktop @('set-value',$edit.ref_id,$text) | Out-Null
  if ([InputProbe]::Sample() -ne $baseline) { throw 'Writing changed focus or cursor' }
  $saved = & $private $deskName save-note $note $owned | ConvertFrom-Json
  if (-not $saved.ok) { throw 'Save command unavailable on the private desktop' }
  if ([IO.File]::ReadAllText($doc).TrimEnd() -ne $text) { throw 'Notepad file failed independent readback' }
  Write-Host 'PASS Notepad saved the temporary document.'

  $receipt = Join-Path $dir 'fields.txt'
  $fieldPid = (& $private $deskName launch $fixture $receipt | ConvertFrom-Json).pid
  if (-not $fieldPid) { throw 'Fixture launch failed' }
  try {
    # The CLR can report input-idle before Application.Run has shown the fixture form.
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while (-not (Test-Path -LiteralPath ($receipt + '.ready'))) {
      if (-not (Get-Process -Id $fieldPid -ErrorAction SilentlyContinue)) { throw 'Fixture exited before Form.Shown' }
      if ([DateTime]::UtcNow -ge $deadline) { throw 'Fixture did not signal Form.Shown' }
      Start-Sleep -Milliseconds 50
    }
    function Get-FixtureControl([string]$Name) {
      $untilVisible = [DateTime]::UtcNow.AddSeconds(15)
      do {
        $tree = (Invoke-Desktop @('snapshot','--app','ChronosFields.exe','-i','--timeout-ms','15000')).tree
        $nodes = @(Nodes $tree | Where-Object ref_id)
        $matchesByName = @($nodes | Where-Object { $_.name -eq $Name })
        if ($matchesByName.Count -eq 1) { return $matchesByName[0].ref_id }
        if ($Name -in 'First','Second') {
          # The legacy Win32 accessibility provider can omit the names of native edit
          # children. The fixture has exactly two text fields in creation/tab order.
          $edits = @($nodes | Where-Object { $_.role -in 'edit','textbox','textfield','text_field','text-field' -and $_.available_actions -contains 'SetValue' })
          if ($edits.Count -eq 2) { return $edits[[int]($Name -eq 'Second')].ref_id }
        }
        Start-Sleep -Milliseconds 150
      } while ([DateTime]::UtcNow -lt $untilVisible)
      $nodes | Select-Object role,name,ref_id,available_actions | Format-Table -Wrap | Out-Host
      throw "No unique accessible fixture control for $Name"
    }
    foreach ($name in 'First','Second') {
      $ref = Get-FixtureControl $name
      Invoke-Desktop @('set-value',$ref,($name+' value')) | Out-Null
    }
    $button = Get-FixtureControl 'Check'
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
