@echo off
setlocal EnableExtensions

rem Resolve the current pwsh.exe path at runtime so Store auto-updates do not break the task.
set "SCRIPT_DIR=%~dp0"
set "DATA_DIR=%SCRIPT_DIR%data"
set "LOG_FILE=%DATA_DIR%\agent-maintenance.log"
set "MAINTENANCE_SCRIPT=%SCRIPT_DIR%agent-maintenance.ps1"
set "SCAN_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "PWSH_EXE="

if not exist "%DATA_DIR%" mkdir "%DATA_DIR%" >nul 2>&1

rem First choice: pwsh on PATH (works for MSI installs and App Execution Alias setups).
for /f "delims=" %%I in ('where pwsh 2^>nul') do if not defined PWSH_EXE set "PWSH_EXE=%%~fI"

rem Fallback: scan the Windows Store install folders and pick the newest available version.
if not defined PWSH_EXE if exist "%SCAN_POWERSHELL%" (
    for /f "usebackq delims=" %%I in (`"%SCAN_POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -Command "$candidates = Get-ChildItem -Path 'C:\Program Files\WindowsApps\Microsoft.PowerShell_*_x64__*\pwsh.exe' -File -ErrorAction SilentlyContinue ^| Sort-Object { $leaf = Split-Path $_.DirectoryName -Leaf; if ($leaf -match '^Microsoft\.PowerShell_([^_]+)_x64__') { try { [version]$Matches[1] } catch { [version]'0.0' } } else { [version]'0.0' } } -Descending; if ($candidates) { $candidates[0].FullName }"`) do if not defined PWSH_EXE set "PWSH_EXE=%%~fI"
)

if not defined PWSH_EXE (
    call :Log "ERROR: Could not resolve pwsh.exe from PATH or WindowsApps."
    exit /b 2
)

call :Log "Resolved pwsh.exe to %PWSH_EXE%"

rem Optional test hook: set AGENT_MAINTENANCE_TEST_COMMAND=echo WRAPPER_OK to validate resolution without running maintenance.
if defined AGENT_MAINTENANCE_TEST_COMMAND (
    "%PWSH_EXE%" -NoProfile -Command "%AGENT_MAINTENANCE_TEST_COMMAND%"
) else (
    "%PWSH_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%MAINTENANCE_SCRIPT%" %*
)

set "EXIT_CODE=%ERRORLEVEL%"
exit /b %EXIT_CODE%

:Log
>>"%LOG_FILE%" echo([%DATE% %TIME%] %~1
exit /b 0
