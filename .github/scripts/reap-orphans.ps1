<#
.SYNOPSIS
  Reap orphaned Copilot CLI / MCP host process trees on Windows.

.DESCRIPTION
  Root cause: the Copilot CLI launcher (copilot.exe) and its MCP hosts
  (mcp-host.exe) spawn child workers and MCP servers
  (mcp-host http servers, and `cmd /c npx ...` -> node stdio servers, plus
  the node daemon) as ordinary detached child processes. Windows does NOT
  cascade-kill children when a parent exits (there is no Job Object configured
  with KILL_ON_JOB_CLOSE). So whenever a session ends abnormally -- terminal
  closed, crash, OS sleep, or a non-graceful exit -- the entire subtree is
  orphaned and runs forever. They pile up across days, hold ports, and the
  stale singleton daemon can block a new instance from starting.

  This script protects every *live* session (a `copilot.exe ... copilot`
  whose launching terminal is still alive, plus its descendants) and kills
  everything else that matches the orphan profile. It is therefore safe to
  run even from inside an active Copilot session.

.PARAMETER Execute
  Actually terminate. Without it, runs in dry-run mode and only reports.

.EXAMPLE
  pwsh -File reap-orphans.ps1            # dry run: show what would be killed
  pwsh -File reap-orphans.ps1 -Execute   # kill the orphans
#>
[CmdletBinding()]
param(
  [switch]$Execute
)

$ErrorActionPreference = 'Stop'

# --- Snapshot every process once (PPID + CommandLine + CreationDate) ---
$all = Get-CimInstance Win32_Process |
  Select-Object ProcessId, ParentProcessId, Name, CreationDate, CommandLine
$byPid = @{}
foreach ($p in $all) { $byPid[[int]$p.ProcessId] = $p }
$alivePids = [System.Collections.Generic.HashSet[int]]::new()
foreach ($p in $all) { [void]$alivePids.Add([int]$p.ProcessId) }

# Map parent -> children for fast descendant walks.
$childrenOf = @{}
foreach ($p in $all) {
  $pp = [int]$p.ParentProcessId
  if (-not $childrenOf.ContainsKey($pp)) { $childrenOf[$pp] = New-Object System.Collections.Generic.List[object] }
  $childrenOf[$pp].Add($p)
}

function Get-Descendants([int]$rootPid) {
  $acc = [System.Collections.Generic.HashSet[int]]::new()
  $stack = New-Object System.Collections.Generic.Stack[int]
  $stack.Push($rootPid)
  while ($stack.Count -gt 0) {
    $cur = $stack.Pop()
    if ($childrenOf.ContainsKey($cur)) {
      foreach ($c in $childrenOf[$cur]) {
        $cid = [int]$c.ProcessId
        if ($acc.Add($cid)) { $stack.Push($cid) }
      }
    }
  }
  return $acc
}

# --- Identify session roots: copilot.exe whose command line drives a copilot session ---
$sessionRoots = $all | Where-Object {
  $_.Name -eq 'copilot.exe' -and $_.CommandLine -and $_.CommandLine -match '\bcopilot\b'
}

$protected = [System.Collections.Generic.HashSet[int]]::new()
$liveRoots = @()
foreach ($r in $sessionRoots) {
  $parentAlive = $alivePids.Contains([int]$r.ParentProcessId)
  $parentIsLauncher = -not (@('copilot.exe','mcp-host.exe') -contains $byPid[[int]$r.ParentProcessId].Name)
  if ($parentAlive -and $parentIsLauncher) {
    # Live session: its launching terminal is still around. Protect the whole tree.
    $liveRoots += $r
    [void]$protected.Add([int]$r.ProcessId)
    foreach ($d in Get-Descendants([int]$r.ProcessId)) { [void]$protected.Add($d) }
  }
}

# --- Build the orphan set ---
$orphanPids = [System.Collections.Generic.HashSet[int]]::new()

# 1. Orphaned session roots (dead/detached terminal) + their subtrees.
foreach ($r in $sessionRoots) {
  if ($protected.Contains([int]$r.ProcessId)) { continue }
  [void]$orphanPids.Add([int]$r.ProcessId)
  foreach ($d in Get-Descendants([int]$r.ProcessId)) { [void]$orphanPids.Add($d) }
}

# 2. Standalone orphans whose ancestry no longer reaches a live, protected root:
#    mcp-host http servers, node MCP/daemon servers, and `cmd /c (npx|mcp)` wrappers.
$mcpProfile = {
  param($p)
  switch ($p.Name) {
    'mcp-host.exe' { return ($p.CommandLine -match '\bmcp\b') }
    'node.exe'    { return ($p.CommandLine -match 'daemon\.js|mcp|modelcontext|--transport') }
    'cmd.exe'     { return ($p.CommandLine -match '/c\b' -and $p.CommandLine -match 'npx|mcp|playwright') }
    default       { return $false }
  }
}
foreach ($p in $all) {
  $procId = [int]$p.ProcessId
  if ($protected.Contains($procId) -or $orphanPids.Contains($procId)) { continue }
  if (& $mcpProfile $p) {
    # Orphaned only if its parent is gone, or its parent is itself an orphan/not protected copilot/mcp-host.
    $parent = $byPid[[int]$p.ParentProcessId]
    $parentGone = -not $alivePids.Contains([int]$p.ParentProcessId)
    $parentUnprotected = $parent -and ((@('copilot.exe','mcp-host.exe','cmd.exe') -contains $parent.Name) -and -not $protected.Contains([int]$p.ParentProcessId))
    if ($parentGone -or $parentUnprotected) {
      [void]$orphanPids.Add($procId)
      foreach ($d in Get-Descendants($procId)) { [void]$orphanPids.Add($d) }
    }
  }
}

# --- Report ---
$orphans = $orphanPids | ForEach-Object { $byPid[$_] } | Where-Object { $_ } | Sort-Object CreationDate
Write-Host ("Live sessions protected : {0} (root PIDs: {1})" -f $liveRoots.Count, (($liveRoots.ProcessId) -join ', '))
Write-Host ("Orphan processes found  : {0}" -f $orphans.Count)
if ($orphans.Count -eq 0) { Write-Host "Nothing to reap."; return }

$orphans | Select-Object ProcessId, Name, ParentProcessId, CreationDate,
  @{n='Cmd';e={ if ($_.CommandLine) { ($_.CommandLine -replace '\s+',' ').Substring(0,[Math]::Min(80,$_.CommandLine.Length)) } else { '' } }} |
  Format-Table -AutoSize

if (-not $Execute) {
  Write-Host "`nDRY RUN. Re-run with -Execute to terminate the processes above." -ForegroundColor Yellow
  return
}

# --- Kill leaf-first (newest CreationDate first approximates deepest-first) ---
$killed = 0; $failed = 0
foreach ($p in ($orphans | Sort-Object CreationDate -Descending)) {
  try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; $killed++ }
  catch { Write-Host ("FAILED {0} {1}: {2}" -f $p.ProcessId, $p.Name, $_.Exception.Message) -ForegroundColor Red; $failed++ }
}
Write-Host ("Reaped: {0}  Failed: {1}" -f $killed, $failed) -ForegroundColor Green
