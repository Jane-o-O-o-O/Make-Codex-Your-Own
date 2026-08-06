# Codex Trace Viewer

Local-first observability and daily review workspace for Codex rollout traces.
The viewer reads the diagnostic bundles produced by `codex-rollout-trace` and
presents them in a Langfuse-inspired workflow without depending on Langfuse,
Docker, a database, or a hosted service.

The project is an independent community tool. It is not affiliated with or
endorsed by OpenAI, Codex, or Langfuse.

## What It Provides

- Day-first navigation: date -> session -> trace.
- Session summaries with the first user instruction, status, duration, model,
  project, tool count, and token usage.
- Search and filtering by instruction, rollout ID, project, model, status, and
  node type.
- Trace tree, waterfall timeline, relationship graph, and readable conversation
  views.
- Node details with overview, input, output, metadata, and raw JSON tabs.
- On-demand payload loading with copy, download, and retry feedback.
- Raw bundle reduction through the local Codex CLI with explicit progress and
  retry states.
- Daily reviews covering completion rate, active time, model/provider usage,
  tools, tokens, cache usage, active hours, habits, and cleanup suggestions.
- Optional OpenAI-compatible LLM analysis for dynamically inferred scenarios,
  cross-signal habits, and improvement recommendations.
- Local-only storage by default. Trace and report data never leave the machine.

## Requirements

- Node.js 22 or newer.
- A Codex CLI build that can write rollout traces.
- Windows PowerShell for the optional login-task installer. The viewer itself
  is a plain Node.js server and can also be started from other platforms.

## Quick Start

Set the trace directory before starting Codex:

```powershell
$env:CODEX_ROLLOUT_TRACE_ROOT = "E:\codex-traces"
$env:CODEX_INSIGHTS_ROOT = "E:\codex-insights"
codex
```

In another terminal, start the viewer:

```powershell
node server.mjs --trace-root E:\codex-traces --data-root E:\codex-insights
```

Open <http://127.0.0.1:4319/>. The server binds to loopback by default.

The same command can be started with npm:

```powershell
npm start -- --trace-root E:\codex-traces --data-root E:\codex-insights
```

The trace environment variable must be present when Codex starts. Restart
Codex after changing it.

## Windows Autostart

From the repository directory, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
```

The installer creates a current-user `CodexDailyInsights` login task and stores
the trace and insights roots in the task environment. Remove it with:

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-windows.ps1
```

The task starts the local viewer on port `4319`. Update the task or use the
command-line options below when a different layout is needed.

## Command-Line Options

| Option | Default | Purpose |
| --- | --- | --- |
| `--trace-root <path>` | `CODEX_ROLLOUT_TRACE_ROOT` or `./traces` | Rollout trace bundle directory |
| `--data-root <path>` | `CODEX_INSIGHTS_ROOT` or `./.codex-insights` | Daily review and settings directory |
| `--codex <executable>` | `codex` | CLI used for raw bundle reduction |
| `--host <address>` | `127.0.0.1` | HTTP bind address |
| `--port <number>` | `4319` | HTTP port |

`CODEX_HOME` can be set when Skills and MCP inventory should be collected from
a non-default Codex home directory.

## Trace Lifecycle

The viewer distinguishes a session from the smaller events inside it:

- **Session**: one rollout bundle, including its root thread and child threads.
- **Runtime turn**: one Codex activation. It is not guaranteed to be exactly
  one user/assistant message pair.
- **Model call**: one upstream inference request and response.
- **Tool call**: one runtime tool boundary, such as a shell, patch, or MCP call.
- **Conversation item**: a model-visible user, assistant, or tool message.

Ready sessions already contain `state.json` and are read directly. Raw sessions
are left untouched until the user chooses **Start reduction**. The reduction
request invokes:

```text
codex debug trace-reduce <bundle-directory>
```

The API returns `409 Conflict` for a known raw bundle because it needs this
explicit reduction step. A Ready bundle is idempotent when requested with
`?reduce=1` and is never reduced a second time.

## Daily Reviews

The settings dialog can run a report immediately or schedule one for a local
time. Reports are written below the configured insights root:

```text
reports/YYYY-MM-DD.json
reports/YYYY-MM-DD.md
```

Cleanup rows are recommendations only. The viewer never deletes Skills, MCP
configuration, reports, or trace bundles automatically.

### Optional LLM Analysis

The settings dialog can enable an additional OpenAI-compatible Chat
Completions request after the deterministic report has been built. Configure:

- API base URL, such as `https://api.openai.com/v1` or a compatible local
  service. A full `/chat/completions` URL is also accepted.
- Model name.
- Optional API key. Local services that do not require authorization can leave
  it blank.
- Request timeout from 5 to 300 seconds.

Use **Test connection** before saving. Manual and scheduled reviews share the
same pipeline. If the model request times out, returns an error, or produces
invalid JSON, the local rule-based report is still stored and the failure is
shown in the report instead of aborting the daily review.

Only bounded aggregate metrics, top usage entries, cleanup signals, and
already-redacted prompt previews are sent to the configured endpoint. Raw
payloads, source code, and complete command output are not included. The API
key is stored in the local `settings.json`, is never returned by the settings
API, and should be protected like any other local credential.

## Privacy and Security

Trace bundles may contain prompts, model responses, tool arguments, command
output, local paths, and source code. Keep the default loopback binding unless
the host and network are protected. Do not expose the viewer to an untrusted
network without adding authentication and access controls.

The viewer does not upload data to Langfuse or any other service. Payloads are
loaded only when requested by the local UI. The repository ignores local trace,
insights, runtime, and environment data; keep credentials out of the trace root
and working tree.

## Development

Install no runtime dependencies; the project uses Node.js built-ins and browser
APIs. Run the test suite with:

```powershell
npm test
node --check server.mjs
node --check public/app.js
node --check public/trace-detail.js
```

The main files are:

```text
server.mjs              HTTP API, bundle discovery, reduction, and scheduler
insights.mjs            Daily review aggregation and persistence
public/index.html       Application shell
public/app.js           Routing, UI state, and interactions
public/trace-detail.js  Trace tree and node detail normalization
public/styles.css       Dark, responsive workspace styles
fixtures/               Small deterministic test bundles
```

## License

This project is released under the [MIT License](LICENSE).
