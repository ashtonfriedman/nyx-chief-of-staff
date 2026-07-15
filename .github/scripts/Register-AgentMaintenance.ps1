<#
.SYNOPSIS
    Register (or update) the Agent Maintenance scheduled task in Windows Task Scheduler.

.DESCRIPTION
    Creates a task called "Agent Maintenance" with three triggers:
      1. Daily at 5:00 AM (local time)
      2. On workstation unlock (catch-up after sleep)
      3. On logon (catch-up after reboot)

    Requires admin (elevated shell) on managed machines.
    The launcher handles idempotency — multiple triggers firing the same day
    are safe because the script checks the state file.

.PARAMETER Unregister
    Remove the scheduled task.

.PARAMETER TriggerTime
    Time for the daily trigger (default: '05:00'). Format: HH:mm

.EXAMPLE
    .\Register-AgentMaintenance.ps1
    .\Register-AgentMaintenance.ps1 -TriggerTime '06:30'
    .\Register-AgentMaintenance.ps1 -Unregister
#>

[CmdletBinding()]
param(
    [switch]$Unregister,
    [string]$TriggerTime = '05:00'
)

$ErrorActionPreference = 'Stop'
$TaskName = 'Agent Maintenance'
$TaskPath = '\Agent\'

# --- Check admin ---
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "This script requires an elevated (admin) shell. Right-click PowerShell → Run as Administrator."
    exit 1
}

# --- Paths ---
$ScriptDir    = $PSScriptRoot
$LauncherPath = Join-Path $ScriptDir 'agent-maintenance.ps1'

if (-not (Test-Path $LauncherPath)) {
    Write-Error "Launcher script not found: $LauncherPath"
    exit 1
}

# --- Unregister ---
if ($Unregister) {
    try {
        Unregister-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Confirm:$false
        Write-Host "Task '$TaskPath$TaskName' removed."
    } catch {
        Write-Host "Task not found or already removed."
    }
    exit 0
}

# --- Build Triggers ---

# 1. Daily at the specified time
$dailyTrigger = New-ScheduledTaskTrigger -Daily -At $TriggerTime

# 2. On session unlock (StateChange 8 = session unlock)
$unlockTrigger = New-CimInstance -CimClass (
    Get-CimClass -ClassName MSFT_TaskSessionStateChangeTrigger -Namespace Root/Microsoft/Windows/TaskScheduler
) -ClientOnly -Property @{
    StateChange = [int32]8   # Session unlock
    Enabled     = $true
}

# 3. On logon
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$triggers = @($dailyTrigger, $unlockTrigger, $logonTrigger)

# --- Action ---
$pwshPath = (Get-Command pwsh -ErrorAction SilentlyContinue)?.Source
if (-not $pwshPath) {
    $pwshPath = (Get-Command powershell -ErrorAction SilentlyContinue)?.Source
}
if (-not $pwshPath) {
    Write-Error "Neither pwsh nor powershell found in PATH."
    exit 1
}

$action = New-ScheduledTaskAction `
    -Execute $pwshPath `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$LauncherPath`"" `
    -WorkingDirectory (Split-Path $LauncherPath -Parent)

# --- Settings ---
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -MultipleInstances IgnoreNew

# --- Principal ---
# Run as current user, only when logged on (required for M365 delegated auth tokens)
$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Limited

# --- Register ---
$existingTask = Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue

if ($existingTask) {
    Write-Host "Updating existing task '$TaskPath$TaskName'..."
    Set-ScheduledTask `
        -TaskName $TaskName `
        -TaskPath $TaskPath `
        -Trigger $triggers `
        -Action $action `
        -Settings $settings `
        -Principal $principal | Out-Null
} else {
    Write-Host "Creating task '$TaskPath$TaskName'..."
    Register-ScheduledTask `
        -TaskName $TaskName `
        -TaskPath $TaskPath `
        -Trigger $triggers `
        -Action $action `
        -Settings $settings `
        -Principal $principal `
        -Description 'Automated agent mind maintenance: peer sync, log consolidation, audit analysis, graph re-index.' | Out-Null
}

Write-Host ""
Write-Host "Task registered:"
Write-Host "  Name:     $TaskPath$TaskName"
Write-Host "  Triggers: Daily at $TriggerTime, on logon, on session unlock"
Write-Host "  Action:   $pwshPath -File $LauncherPath"
Write-Host "  Timeout:  30 minutes"
Write-Host "  User:     $env:USERNAME (interactive logon)"
Write-Host ""
Write-Host "Verify:  Get-ScheduledTask -TaskName '$TaskName' -TaskPath '$TaskPath' | Format-List"
Write-Host "Run now: Start-ScheduledTask -TaskName '$TaskName' -TaskPath '$TaskPath'"
Write-Host "Remove:  .\Register-AgentMaintenance.ps1 -Unregister"
