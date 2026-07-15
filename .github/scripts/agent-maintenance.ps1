<#
.SYNOPSIS
    Agent Maintenance Launcher — invokes copilot CLI headlessly for daily housekeeping.

.DESCRIPTION
    Task Scheduler fires this script. It checks whether maintenance already ran today,
    acquires a PID-based lock, invokes copilot in non-interactive mode with the
    the agent-maintenance skill, and updates the state file with results.

    Designed for both primary and secondary instances — uses $PSScriptRoot for path discovery.

.NOTES
    Triggers: Daily 5 AM ET, on logon, on session unlock.
    Idempotency: skips if already ran successfully today.
    Lock: PID-based with 45-minute stale detection.
#>

[CmdletBinding()]
param(
    [switch]$Force,       # Skip the "already ran today" check
    [switch]$DryRun,      # Print what would happen without invoking copilot
    [int]$TimeoutMinutes = 30
)

$ErrorActionPreference = 'Stop'

# --- Path Discovery ---
$ScriptDir   = $PSScriptRoot
$DataDir     = Join-Path $ScriptDir 'data'
$StateFile   = Join-Path $DataDir 'agent-maintenance-state.json'
$LogFile     = Join-Path $DataDir 'agent-maintenance.log'
$MindRoot    = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path

# Ensure data directory exists
if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

# --- Logging ---
function Write-Log {
    param([string]$Message)
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $line = "[$ts] $Message"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue
}

# --- State Management ---
function Read-State {
    if (Test-Path $StateFile) {
        try {
            return Get-Content $StateFile -Raw | ConvertFrom-Json
        } catch {
            Write-Log "WARN: Corrupt state file. Starting fresh."
            return $null
        }
    }
    return $null
}

function Write-State {
    param([hashtable]$State)
    $State | ConvertTo-Json -Depth 4 | Set-Content $StateFile -Encoding utf8
}

# --- Lock Management ---
function Test-ProcessAlive {
    param([int]$Pid)
    try {
        $proc = Get-Process -Id $Pid -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

# --- Main ---
Write-Log "=== Agent Maintenance Launcher ==="
Write-Log "Mind root: $MindRoot"

$state = Read-State
$now = Get-Date
$todayDate = $now.ToString('yyyy-MM-dd')

# Check: already ran successfully today?
if (-not $Force -and $state -and $state.status -eq 'success') {
    $lastSuccess = $null
    if ($state.last_success) {
        try { $lastSuccess = [datetime]::Parse($state.last_success) } catch {}
    }
    if ($lastSuccess -and $lastSuccess.ToString('yyyy-MM-dd') -eq $todayDate) {
        Write-Log "Already ran successfully today ($($state.last_success)). Skipping."
        exit 0
    }
}

# Check: is another run in progress?
if ($state -and $state.status -eq 'running' -and $state.pid) {
    $lockAge = $null
    if ($state.last_run) {
        try { $lockAge = $now - [datetime]::Parse($state.last_run) } catch {}
    }
    if ($lockAge -and $lockAge.TotalMinutes -lt 45 -and (Test-ProcessAlive -Pid $state.pid)) {
        Write-Log "Another run is active (PID $($state.pid), started $($state.last_run)). Skipping."
        exit 0
    }
    Write-Log "Stale lock detected (PID $($state.pid)). Clearing."
}

# Acquire lock
$runCount = if ($state -and $state.run_count) { $state.run_count } else { 0 }
Write-State @{
    last_run    = $now.ToString('o')
    status      = 'running'
    pid         = $PID
    error       = $null
    run_count   = $runCount
}
Write-Log "Lock acquired (PID $PID)."

if ($DryRun) {
    Write-Log "DRY RUN: Would invoke copilot -p with the agent-maintenance skill."
    Write-Log "DRY RUN: Mind root = $MindRoot"
    Write-State @{
        last_run     = $now.ToString('o')
        last_success = $now.ToString('o')
        status       = 'dry-run'
        pid          = $null
        error        = $null
        run_count    = $runCount + 1
    }
    exit 0
}

# Build the prompt
$prompt = @"
You are running as the agent-maintenance skill. This is an automated, headless maintenance run.

Skip the interactive boot sequence (no timezone check, no interactive triage).
Read SOUL.md for your voice, then execute the agent-maintenance skill phases in order:

1. Orient (read memory.md architecture section, rules.md, log.md line count, git status)
2. Log Consolidation (if log.md exceeds 80 lines)
3. Audit Analysis — REPORT ONLY, no moves (scan rules for misplacement, check cross-file duplication, reconcile mind-index)
4. Graph Re-Index (if files changed)
5. Commit (if changes exist)
6. Update state file at .github/scripts/data/agent-maintenance-state.json

Read .github/skills/agent-maintenance/SKILL.md for full instructions on each phase.
This is a headless run. Do not ask questions. Do not wait for input. Execute and exit.
"@

# Invoke copilot CLI
Write-Log "Invoking copilot CLI (model: claude-sonnet-4, timeout: ${TimeoutMinutes}m)..."

$copilotArgs = @(
    '-p', $prompt,
    '--yolo',
    '--autopilot',
    '--no-ask-user',
    '--model', 'claude-sonnet-4',
    '-s'
)

try {
    Push-Location $MindRoot

    $process = Start-Process -FilePath 'copilot' `
        -ArgumentList $copilotArgs `
        -WorkingDirectory $MindRoot `
        -NoNewWindow `
        -PassThru `
        -RedirectStandardOutput (Join-Path $DataDir "maintenance-stdout-$todayDate.log") `
        -RedirectStandardError (Join-Path $DataDir "maintenance-stderr-$todayDate.log")

    $completed = $process.WaitForExit($TimeoutMinutes * 60 * 1000)

    if (-not $completed) {
        Write-Log "ERROR: Copilot timed out after ${TimeoutMinutes} minutes. Killing."
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        $exitCode = -1
    } else {
        $exitCode = $process.ExitCode
    }
} catch {
    Write-Log "ERROR: Failed to invoke copilot: $_"
    $exitCode = -2
} finally {
    Pop-Location
}

# Re-read state in case the maintenance skill updated it
$updatedState = Read-State

if ($exitCode -eq 0) {
    Write-Log "Copilot exited successfully (code 0)."

    # Preserve any fields the skill wrote, update ours
    $finalState = @{
        last_run       = $now.ToString('o')
        last_success   = (Get-Date).ToString('o')
        status         = if ($updatedState -and $updatedState.status -eq 'partial') { 'partial' } else { 'success' }
        pid            = $null
        error          = $null
        run_count      = $runCount + 1
        items_synced   = if ($updatedState.items_synced) { $updatedState.items_synced } else { 0 }
        audit_findings = if ($updatedState.audit_findings) { $updatedState.audit_findings } else { 0 }
    }
    Write-State $finalState
} else {
    Write-Log "ERROR: Copilot exited with code $exitCode."
    Write-State @{
        last_run       = $now.ToString('o')
        last_success   = if ($state -and $state.last_success) { $state.last_success } else { $null }
        status         = 'failed'
        pid            = $null
        error          = "Exit code: $exitCode"
        run_count      = $runCount + 1
    }
}

# Trim old stdout/stderr logs (keep last 7 days)
Get-ChildItem $DataDir -Filter 'maintenance-std*' |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } |
    Remove-Item -Force -ErrorAction SilentlyContinue

Write-Log "=== Maintenance complete (status: $(if ($exitCode -eq 0) { 'success' } else { 'failed' })) ==="
exit $exitCode
