import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildDailyReview,
  defaultSettings,
  listReviews,
  loadSettings,
  saveSettings,
  shouldRunScheduledReview,
  storeReview,
  validateSettings,
} from "./insights.mjs";

test("schedule runs once after the configured local time", () => {
  const settings = { ...defaultSettings("data"), scheduleTime: "20:30", lastScheduledRunDate: null };
  assert.equal(shouldRunScheduledReview(settings, new Date(2026, 7, 4, 20, 29)), false);
  assert.equal(shouldRunScheduledReview(settings, new Date(2026, 7, 4, 20, 30)), true);
  settings.lastScheduledRunDate = "2026-08-04";
  assert.equal(shouldRunScheduledReview(settings, new Date(2026, 7, 4, 23, 0)), false);
});

test("settings validation accepts schedule changes and rejects bad values", () => {
  const current = defaultSettings("data");
  assert.equal(validateSettings({ scheduleTime: "08:15", inactiveSkillDays: 45 }, current).scheduleTime, "08:15");
  assert.throws(() => validateSettings({ scheduleTime: "25:00" }, current), /HH:MM/);
  assert.throws(() => validateSettings({ inactiveMcpDays: 0 }, current), /inactiveMcpDays/);
});

test("scheduled run date persists across service restarts", async (context) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "codex-settings-"));
  context.after(() => rm(dataRoot, { recursive: true, force: true }));
  const settings = { ...defaultSettings(dataRoot), lastScheduledRunDate: "2026-08-04" };
  await saveSettings(settings);
  assert.equal((await loadSettings(dataRoot)).lastScheduledRunDate, "2026-08-04");
});

test("daily review aggregates sessions and stores JSON and Markdown", async (context) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "codex-insights-"));
  context.after(() => rm(dataRoot, { recursive: true, force: true }));
  const timestamp = new Date(2026, 7, 4, 10, 0).getTime();
  const trace = {
    trace_id: "trace-1", rollout_id: "rollout-1", started_at_unix_ms: timestamp,
    ended_at_unix_ms: timestamp + 5_000, status: "completed", codex_turns: { turn: { execution: {} } },
    inference_calls: {
      call: { model: "gpt-5", provider_name: "openai", usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 30, reasoning_output_tokens: 10 } },
    },
    tool_calls: { tool: { kind: { type: "mcp", server: "docs", tool: "search" } } },
    conversation_items: { user: { role: "user", body: { parts: [{ text: "hello" }] } } }, raw_payloads: {},
  };
  const report = await buildDailyReview({
    date: "2026-08-04", traces: [trace], inventory: { skills: [], mcpServers: [{ id: "docs" }] },
    previousReviews: [], bundleRoot: dataRoot, settings: defaultSettings(dataRoot),
  });
  assert.deepEqual(report.summary, {
    sessions: 1, completedSessions: 1, activeMs: 5_000, runtimeTurns: 1, modelCalls: 1, toolCalls: 1,
    inputTokens: 100, cachedInputTokens: 20, outputTokens: 30, reasoningTokens: 10, userMessages: 1, userCharacters: 5,
  });
  assert.deepEqual(report.mcpUsage, { docs: 1 });
  assert.deepEqual(report.cleanupRecommendations, []);
  await storeReview(report, dataRoot);
  assert.equal((await listReviews(dataRoot))[0].date, "2026-08-04");
  assert.match(await readFile(path.join(dataRoot, "reports", "2026-08-04.md"), "utf8"), /Codex Daily Review/);
});
