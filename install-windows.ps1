param(
    [string]$TraceRoot = (Join-Path $PSScriptRoot "data\traces"),
    [string]$DataRoot = (Join-Path $PSScriptRoot "data\insights"),
    [int]$Port = 4319
)

$ErrorActionPreference = "Stop"
$node = (Get-Command node).Source
$server = Join-Path $PSScriptRoot "server.mjs"
$TraceRoot = [System.IO.Path]::GetFullPath($TraceRoot)
$DataRoot = [System.IO.Path]::GetFullPath($DataRoot)

New-Item -ItemType Directory -Path $TraceRoot,$DataRoot -Force | Out-Null
[Environment]::SetEnvironmentVariable("CODEX_ROLLOUT_TRACE_ROOT", $TraceRoot, "User")
[Environment]::SetEnvironmentVariable("CODEX_INSIGHTS_ROOT", $DataRoot, "User")

$arguments = '"{0}" --trace-root "{1}" --data-root "{2}" --port {3}' -f $server,$TraceRoot,$DataRoot,$Port
$action = New-ScheduledTaskAction -Execute $node -Argument $arguments -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "CodexDailyInsights" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Local Codex trace viewer and daily usage review scheduler" -Force | Out-Null

Write-Output "Installed CodexDailyInsights startup task."
Write-Output "Trace root: $TraceRoot"
Write-Output "Insights repository: $DataRoot"
Write-Output "Viewer URL: http://127.0.0.1:$Port"
Write-Output "Restart Codex App/CLI so it inherits CODEX_ROLLOUT_TRACE_ROOT."
