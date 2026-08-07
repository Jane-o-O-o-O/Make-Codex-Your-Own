param(
    [string]$BindHost = "127.0.0.1",
    [int]$Port = 4319,
    [string]$TraceRoot,
    [string]$DataRoot,
    [string]$Codex,
    [string]$CodexHome
)

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath($PSScriptRoot)
if (-not $TraceRoot) { $TraceRoot = $env:CODEX_ROLLOUT_TRACE_ROOT }
if (-not $TraceRoot) { $TraceRoot = Join-Path $PSScriptRoot "data\traces" }
if (-not $DataRoot) { $DataRoot = $env:CODEX_INSIGHTS_ROOT }
if (-not $DataRoot) { $DataRoot = Join-Path $PSScriptRoot "data\insights" }
if (-not $Codex) { $Codex = $env:CODEX_TRACE_VIEWER_CODEX }
if (-not $Codex) { $Codex = "codex" }
if (-not $CodexHome) { $CodexHome = $env:CODEX_HOME }
if (-not $CodexHome) { $CodexHome = Join-Path $env:USERPROFILE ".codex" }
$TraceRoot = [System.IO.Path]::GetFullPath($TraceRoot)
$DataRoot = [System.IO.Path]::GetFullPath($DataRoot)
$url = "http://{0}:{1}/" -f $BindHost, $Port

New-Item -ItemType Directory -Path $TraceRoot, $DataRoot -Force | Out-Null

$serverReady = $false
try {
    $health = Invoke-WebRequest -Uri ($url + "api/config") -UseBasicParsing -TimeoutSec 2
    $serverReady = $health.StatusCode -eq 200
} catch {
    $serverReady = $false
}

if (-not $serverReady) {
    $server = Join-Path $root "server.mjs"
    $args = @(
        $server,
        "--host", $BindHost,
        "--port", $Port,
        "--trace-root", $TraceRoot,
        "--data-root", $DataRoot,
        "--codex", $Codex,
        "--codex-home", $CodexHome
    )
    Start-Process -FilePath "node" -ArgumentList $args -WorkingDirectory $root -WindowStyle Hidden | Out-Null
    $deadline = (Get-Date).AddSeconds(10)
    do {
        Start-Sleep -Milliseconds 250
        try {
            $health = Invoke-WebRequest -Uri ($url + "api/config") -UseBasicParsing -TimeoutSec 2
            $serverReady = $health.StatusCode -eq 200
        } catch {
            $serverReady = $false
        }
    } while (-not $serverReady -and (Get-Date) -lt $deadline)
}

if (-not $serverReady) {
    throw "Unable to start Codex Trace Viewer service: $url"
}

$edgeCandidates = @(
    (Get-Command msedge.exe -ErrorAction SilentlyContinue).Source,
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $env:LOCALAPPDATA "Microsoft\Edge\Application\msedge.exe")
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique
$edgeCandidates = @($edgeCandidates)

if (-not $edgeCandidates) {
    throw "Microsoft Edge was not found. Install Edge or open $url directly."
}

Start-Process -FilePath $edgeCandidates[0] -ArgumentList @(
    "--app=$url",
    "--start-maximized",
    "--no-first-run"
) | Out-Null

Write-Output "Codex Trace Viewer desktop window: $url"
