if(-not([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){Write-Error 'Run this script from an elevated PowerShell session.';exit 1}
$taskName='Agent Maintenance'
$taskPath='\Agent\'
$taskFullName="$taskPath$taskName"
$xmlPath=Join-Path $PSScriptRoot 'data\agent-maintenance-task.xml'
if(-not(Test-Path $xmlPath)){Write-Error "Task XML not found: $xmlPath";exit 1}

# schtasks.exe requires UTF-16 encoded XML. Git stores the template as UTF-8.
$tmpXml = Join-Path $env:TEMP 'agent-maintenance-task-utf16.xml'
$content = Get-Content $xmlPath -Raw
$content = $content -replace 'encoding="UTF-8"', 'encoding="UTF-16"'
$content | Out-File $tmpXml -Encoding unicode

schtasks.exe /Delete /TN $taskFullName /F 2>$null | Out-Null
schtasks.exe /Create /TN $taskFullName /XML $tmpXml /F | Out-Null
$exitCode = $LASTEXITCODE
Remove-Item $tmpXml -ErrorAction SilentlyContinue
if($exitCode -ne 0){Write-Error "Failed to register $taskFullName from $xmlPath";exit $exitCode}
$info=Get-ScheduledTaskInfo -TaskPath $taskPath -TaskName $taskName
Write-Host "Registered $taskFullName. Next run: $($info.NextRunTime)"
