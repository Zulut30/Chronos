param([Parameter(Mandatory)][int]$RootPid, [int]$ServerPid = 0)
$ErrorActionPreference = 'Stop'
$rows = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate,CommandLine,ExecutablePath,PrivatePageCount,WorkingSetSize,ThreadCount)
$children = $rows | Group-Object ParentProcessId -AsHashTable -AsString
$root = $rows | Where-Object ProcessId -eq $RootPid
if (!$root) { throw "Root PID $RootPid not found" }
$tree = [Collections.Generic.List[object]]::new()
function Visit($p, $inAgent) {
  $cmd = if ($p.CommandLine) { $p.CommandLine } else { '' }
  $img = if ($p.ExecutablePath) { [IO.Path]::GetFileName($p.ExecutablePath) } else { '' }
  $isAgent = $inAgent -or ($cmd -match '[\\/]agent\.mjs\b|\bacp-mcp-bridge\b') -or ($img -in 'claude.exe','codex.exe','glm.exe')
  $role = if ($isAgent) {'agents'}
    elseif ($p.ProcessId -eq $RootPid) {'main'}
    elseif ($ServerPid -gt 0 -and $p.ProcessId -eq $ServerPid) {'server'}
    elseif ($cmd -match '--type=renderer\b') {'renderer'}
    elseif ($cmd -match '--type=gpu-process\b') {'gpu'}
    elseif ($cmd -match '--type=utility\b') {'utility'}
    elseif ($cmd -match '[\\/]chronos-services[\\/]host\.mjs') {'olympus'}
    else {'other'}
  $tree.Add([pscustomobject]@{
    role=$role
    image=$img
    threads=[int]$p.ThreadCount
    priv=[double]$p.PrivatePageCount/1MB
    ws=[double]$p.WorkingSetSize/1MB
  })
  foreach ($child in $children[[string]$p.ProcessId]) {
    if ($child -and $child.CreationDate -ge $p.CreationDate) { Visit $child $isAgent }
  }
}
Visit $root $false
$result = @{}
foreach ($role in @('main','renderer','gpu','utility','server','olympus','agents','other','total')) {
  $members = @($tree | Where-Object { $role -eq 'total' -or $_.role -eq $role })
  $result[$role] = @{
    count = $members.Count
    privateMiB = if ($members.Count) { [math]::Round(($members | Measure-Object priv -Sum).Sum, 3) } else { 0 }
    wsMiB = if ($members.Count) { [math]::Round(($members | Measure-Object ws -Sum).Sum, 3) } else { 0 }
    threads = if ($members.Count) { [int]($members | Measure-Object threads -Sum).Sum } else { 0 }
  }
}
$result['processes'] = @($tree | ForEach-Object {
  @{ role=$_.role; image=$_.image; privateMiB=[math]::Round($_.priv, 3); wsMiB=[math]::Round($_.ws, 3); threads=$_.threads }
} | Sort-Object { $_.role + '/' + $_.image })
$result | ConvertTo-Json -Depth 4
