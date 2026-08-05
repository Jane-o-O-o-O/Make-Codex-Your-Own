import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import test from "node:test";
import path from "node:path";

import { fileURLToPath } from "node:url";

import { createViewerServer, parseArgs, safeChild } from "./server.mjs";

const fixtureRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

test("parseArgs resolves trace root and overrides options", () => {
  const options = parseArgs([
    "--trace-root",
    "fixtures",
    "--host",
    "0.0.0.0",
    "--port",
    "9000",
    "--codex",
    "codex-dev",
  ]);
  assert.equal(options.traceRoot, path.resolve("fixtures"));
  assert.equal(options.host, "0.0.0.0");
  assert.equal(options.port, 9000);
  assert.equal(options.codex, "codex-dev");
});

test("safeChild accepts descendants and rejects traversal", () => {
  const root = path.resolve("trace-root");
  assert.equal(safeChild(root, "bundle/state.json"), path.join(root, "bundle", "state.json"));
  assert.throws(() => safeChild(root, "../secret"), /escapes trace root/);
});

test("parseArgs rejects invalid ports and unknown arguments", () => {
  assert.throws(() => parseArgs(["--port", "0"]), /--port/);
  assert.throws(() => parseArgs(["--wat"]), /unknown argument/);
});

test("viewer serves trace state and referenced payloads", async (context) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "codex-viewer-"));
  const server = createViewerServer({ traceRoot: fixtureRoot, dataRoot, codexHome: dataRoot, codex: path.join(dataRoot, "missing-codex") });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  context.after(() => rm(dataRoot, { recursive: true, force: true }));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const traces = await fetch(`${base}/api/traces`).then((response) => response.json());
  assert.equal(traces.traces[0].rolloutId, "rollout-sample");
  assert.equal(traces.traces[0].status, "completed");
  assert.deepEqual(traces.traces[0].models, ["gpt-5"]);
  assert.equal(traces.traces[0].tools, 1);
  assert.equal(traces.traces[0].inputTokens, 1420);
  assert.equal(traces.traces[0].firstUserMessage, "检查项目并总结关键风险");

  const trace = await fetch(`${base}/api/traces/sample`).then((response) => response.json());
  assert.equal(trace.inference_calls["inference-1"].usage.input_tokens, 1420);

  const readyTrace = await fetch(`${base}/api/traces/sample?reduce=1`);
  assert.equal(readyTrace.status, 200);

  const payload = await fetch(`${base}/api/traces/sample/payloads/payload-request`).then((response) => response.json());
  assert.equal(payload.model, "gpt-5");

  const settings = await fetch(`${base}/api/settings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scheduleTime: "08:45", inactiveSkillDays: 60 }),
  }).then((response) => response.json());
  assert.equal(settings.scheduleTime, "08:45");
  assert.equal(settings.inactiveSkillDays, 60);
});
