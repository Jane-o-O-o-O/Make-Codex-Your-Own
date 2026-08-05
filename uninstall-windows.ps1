$ErrorActionPreference = "Stop"
Unregister-ScheduledTask -TaskName "CodexDailyInsights" -Confirm:$false -ErrorAction SilentlyContinue
[Environment]::SetEnvironmentVariable("CODEX_ROLLOUT_TRACE_ROOT", $null, "User")
[Environment]::SetEnvironmentVariable("CODEX_INSIGHTS_ROOT", $null, "User")
Write-Output "Removed the CodexDailyInsights startup task and user environment variables."
