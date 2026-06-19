# KOVAN 일별TR현황 자동 수집을 매일 08:00에 실행하도록 윈도우 작업 스케줄러에 등록합니다.
# 실행: PowerShell에서  powershell -ExecutionPolicy Bypass -File server\register-tr-task.ps1
# 제거:  Unregister-ScheduledTask -TaskName "KOVAN-TR-Daily" -Confirm:$false

$ErrorActionPreference = "Stop"

$nodeExe   = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) { $nodeExe = "C:\Program Files\nodejs\node.exe" }

$projectDir = Split-Path -Parent $PSScriptRoot   # = d:\erp\dashboard
$script     = Join-Path $projectDir "server\daily-collect.mjs"  # TR + 무실적 가맹점 통합 수집
$taskName   = "KOVAN-TR-Daily"

$action  = New-ScheduledTaskAction -Execute $nodeExe -Argument "`"$script`"" -WorkingDirectory $projectDir
$trigger = New-ScheduledTaskTrigger -Daily -At 8:00am
# PC가 8시에 켜져 있다가 시간을 놓쳤으면(절전 등) 깨어난 뒤 즉시 실행
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "KOVAN CATECA 일별TR현황 매일 수집" -Force | Out-Null

Write-Host "✅ 등록 완료: '$taskName' — 매일 08:00 실행"
Write-Host "   node : $nodeExe"
Write-Host "   script: $script"
Write-Host "   지금 즉시 한번 실행해 보려면:  Start-ScheduledTask -TaskName $taskName"
