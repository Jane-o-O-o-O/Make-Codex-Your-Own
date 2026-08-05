# Codex Trace Viewer

Local monitoring UI for Codex rollout traces. It reads the diagnostic bundles
produced by `codex-rollout-trace`; it does not upload data or require Langfuse,
a database, or Docker.

It also aggregates every traced session into a configurable daily review,
stores JSON and Markdown reports, tracks usage habits, and identifies Skills or
MCP servers that have not been observed for a configurable number of days.

## Start

Enable trace capture before starting Codex:

```powershell
$env:CODEX_ROLLOUT_TRACE_ROOT = "E:\codex-traces"
codex
```

Run the viewer from this directory:

```powershell
node server.mjs --trace-root E:\codex-traces
```

Then open `http://127.0.0.1:4319`.

The project is standalone and does not require a Codex source checkout. Trace
and report data can live under this repository's ignored `data/` directory or
at any external path supplied through command-line options or environment
variables.

The default daily review time is `23:30` local time. Change it from the settings
button in the viewer. Reports are stored under the configured insights root in
`reports/YYYY-MM-DD.json` and `reports/YYYY-MM-DD.md`.

## Windows Autostart

Run this once from the viewer directory:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
```

This installs a current-user `CodexDailyInsights` login task and persists both
`CODEX_ROLLOUT_TRACE_ROOT` and `CODEX_INSIGHTS_ROOT`. Restart Codex after
installation so new sessions inherit trace capture. Remove it with
`uninstall-windows.ps1`.

The viewer invokes this command when a bundle does not have a current reduced
state file:

```text
codex debug trace-reduce <bundle-directory>
```

Use `--codex <executable>` when the desired Codex binary is not on `PATH`.
Other options are `--host` and `--port`.

## Data Model

- Session: one rollout, including its root thread and spawned child threads.
- Runtime turn: one Codex activation. This is not guaranteed to be exactly one
  user/assistant message pair.
- Model call: one upstream inference request and response.
- Tool: one runtime tool boundary, including terminal and agent operations.
- Conversation: model-visible input and output items.
- Daily review: all sessions whose local start date matches the report date.

The UI presents these as separate views so runtime activations are not confused
with conversational turns.

## Privacy

Trace bundles can contain prompts, model responses, tool arguments, command
output, local paths, and source code. The server binds to `127.0.0.1` by default.
Do not expose it on another interface unless access to the machine and network
is controlled.

Cleanup entries are recommendations only. The viewer never deletes Skills, MCP
configuration, reports, or trace bundles automatically.
