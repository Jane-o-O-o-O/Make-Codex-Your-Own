import { readFile, readdir, stat, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const DAY_MS = 86_400_000;
const MAX_INVENTORY_FILES = 2_000;
const MAX_PAYLOAD_BYTES = 1_000_000;

export function localDate(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function defaultSettings(dataRoot) {
  return {
    scheduleTime: "23:30",
    enabled: true,
    inactiveSkillDays: 30,
    inactiveMcpDays: 30,
    retentionDays: 365,
    dataRoot,
    lastScheduledRunDate: null,
  };
}

export function validateSettings(input, current) {
  const next = { ...current };
  if (typeof input.enabled === "boolean") next.enabled = input.enabled;
  if (typeof input.scheduleTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.scheduleTime)) {
    next.scheduleTime = input.scheduleTime;
  } else if (input.scheduleTime !== undefined) {
    throw new Error("scheduleTime must use HH:MM in local time");
  }
  for (const key of ["inactiveSkillDays", "inactiveMcpDays", "retentionDays"]) {
    if (input[key] !== undefined) {
      const value = Number(input[key]);
      if (!Number.isInteger(value) || value < 1 || value > 3_650) throw new Error(`${key} must be an integer from 1 to 3650`);
      next[key] = value;
    }
  }
  return next;
}

export async function loadSettings(dataRoot) {
  const file = path.join(dataRoot, "settings.json");
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    const settings = validateSettings(parsed, defaultSettings(dataRoot));
    if (/^\d{4}-\d{2}-\d{2}$/.test(parsed.lastScheduledRunDate || "")) settings.lastScheduledRunDate = parsed.lastScheduledRunDate;
    return settings;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return defaultSettings(dataRoot);
  }
}

export async function saveSettings(settings) {
  await writeJsonAtomic(path.join(settings.dataRoot, "settings.json"), settings);
}

export function shouldRunScheduledReview(settings, now = new Date()) {
  if (!settings.enabled || settings.lastScheduledRunDate === localDate(now.getTime())) return false;
  const [hour, minute] = settings.scheduleTime.split(":").map(Number);
  return now.getHours() > hour || (now.getHours() === hour && now.getMinutes() >= minute);
}

export async function listReviews(dataRoot) {
  const reportsDir = path.join(dataRoot, "reports");
  try {
    const entries = await readdir(reportsDir, { withFileTypes: true });
    const reviews = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/^\d{4}-\d{2}-\d{2}\.json$/.test(entry.name)) continue;
      const report = JSON.parse(await readFile(path.join(reportsDir, entry.name), "utf8"));
      reviews.push(report);
    }
    return reviews.sort((a, b) => b.date.localeCompare(a.date));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function collectInventory(codexHome) {
  const [skills, mcpServers] = await Promise.all([
    collectSkills(codexHome),
    collectMcpServers(path.join(codexHome, "config.toml")),
  ]);
  return { skills, mcpServers };
}

async function collectSkills(codexHome) {
  const roots = [path.join(codexHome, "skills"), path.join(codexHome, "plugins", "cache")];
  const found = [];
  for (const root of roots) await walkSkillFiles(root, root, found);
  const unique = new Map();
  for (const skill of found) if (!unique.has(skill.id)) unique.set(skill.id, skill);
  return [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function walkSkillFiles(root, current, found) {
  if (found.length >= MAX_INVENTORY_FILES) return;
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (found.length >= MAX_INVENTORY_FILES) return;
    const file = path.join(current, entry.name);
    if (entry.isDirectory()) await walkSkillFiles(root, file, found);
    else if (entry.isFile() && entry.name === "SKILL.md") {
      const info = await stat(file);
      const relative = path.relative(root, path.dirname(file)).replaceAll("\\", "/");
      found.push({ id: relative || path.basename(path.dirname(file)), path: file, modifiedAtUnixMs: info.mtimeMs });
    }
  }
}

async function collectMcpServers(configPath) {
  let source;
  try {
    source = await readFile(configPath, "utf8");
  } catch {
    return [];
  }
  const servers = new Map();
  for (const line of source.split(/\r?\n/)) {
    const match = line.trim().match(/^\[mcp_servers\.([^\]]+)\]$/);
    if (!match) continue;
    const rawId = match[1];
    const quoted = /^(['"]).*\1$/.test(rawId);
    if (!quoted && rawId.includes(".")) continue;
    const id = rawId.replace(/^['"]|['"]$/g, "");
    servers.set(id, { id });
  }
  return [...servers.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function buildDailyReview({ date, traces, inventory, previousReviews, bundleRoot, settings = defaultSettings("") }) {
  const selected = traces.filter((trace) => localDate(trace.started_at_unix_ms) === date);
  const report = {
    schemaVersion: 1,
    date,
    generatedAtUnixMs: Date.now(),
    summary: emptySummary(),
    sessions: [],
    models: {},
    providers: {},
    projects: {},
    toolKinds: {},
    mcpUsage: {},
    skillUsage: {},
    hourlyStarts: Array(24).fill(0),
    habits: [],
    cleanupRecommendations: [],
  };
  for (const trace of selected) await addTrace(report, trace, bundleRoot, inventory);
  report.habits = buildHabits(report, previousReviews);
  report.cleanupRecommendations = buildCleanupRecommendations(report, inventory, previousReviews, settings);
  return report;
}

function emptySummary() {
  return {
    sessions: 0, completedSessions: 0, activeMs: 0, runtimeTurns: 0, modelCalls: 0, toolCalls: 0,
    inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0,
    userMessages: 0, userCharacters: 0,
  };
}

async function addTrace(report, trace, bundleRoot, inventory) {
  const calls = Object.values(trace.inference_calls || {});
  const tools = Object.values(trace.tool_calls || {});
  const turns = Object.values(trace.codex_turns || {});
  const ended = trace.ended_at_unix_ms || Math.max(trace.started_at_unix_ms, ...turns.map((turn) => turn.execution?.ended_at_unix_ms || 0));
  const activeMs = Math.max(0, ended - trace.started_at_unix_ms);
  const session = {
    traceId: trace.trace_id, rolloutId: trace.rollout_id, status: trace.status,
    startedAtUnixMs: trace.started_at_unix_ms, endedAtUnixMs: trace.ended_at_unix_ms,
    activeMs, runtimeTurns: turns.length, modelCalls: calls.length, toolCalls: tools.length,
    project: await traceProject(trace, bundleRoot),
  };
  report.sessions.push(session);
  report.summary.sessions += 1;
  if (trace.status === "completed") report.summary.completedSessions += 1;
  report.summary.activeMs += activeMs;
  report.summary.runtimeTurns += turns.length;
  report.summary.modelCalls += calls.length;
  report.summary.toolCalls += tools.length;
  for (const item of Object.values(trace.conversation_items || {})) {
    if (item.role !== "user") continue;
    report.summary.userMessages += 1;
    report.summary.userCharacters += (item.body?.parts || []).reduce((sum, part) => sum + (part.text?.length || 0), 0);
  }
  if (session.project) increment(report.projects, session.project);
  report.hourlyStarts[new Date(trace.started_at_unix_ms).getHours()] += 1;
  for (const call of calls) {
    increment(report.models, call.model || "unknown");
    increment(report.providers, call.provider_name || "unknown");
    report.summary.inputTokens += call.usage?.input_tokens || 0;
    report.summary.cachedInputTokens += call.usage?.cached_input_tokens || 0;
    report.summary.outputTokens += call.usage?.output_tokens || 0;
    report.summary.reasoningTokens += call.usage?.reasoning_output_tokens || 0;
  }
  for (const tool of tools) {
    let kind = tool.kind?.type || tool.kind || "unknown";
    let mcpServer = kind === "mcp" ? tool.kind?.server : null;
    const label = tool.summary?.label || "";
    const bridgedMcp = label.match(/^mcp__([^.]*)\./);
    if (!mcpServer && bridgedMcp) {
      mcpServer = bridgedMcp[1];
      kind = `mcp:${mcpServer}`;
    }
    increment(report.toolKinds, kind);
    if (mcpServer) increment(report.mcpUsage, mcpServer);
  }
  await scanSkillUsage(report, trace, bundleRoot, inventory.skills);
}

async function traceProject(trace, bundleRoot) {
  for (const reference of Object.values(trace.raw_payloads || {})) {
    if (reference.kind?.type !== "session_metadata") continue;
    const payload = await readPayload(reference, trace, bundleRoot);
    if (payload?.cwd) return payload.cwd;
    if (payload?.config?.cwd) return payload.config.cwd;
  }
  return null;
}

async function scanSkillUsage(report, trace, bundleRoot, skills) {
  for (const reference of Object.values(trace.raw_payloads || {})) {
    if (reference.kind?.type !== "tool_invocation") continue;
    const payload = await readPayload(reference, trace, bundleRoot);
    for (const text of stringValues(payload)) {
      if (!/SKILL\.md/i.test(text)) continue;
      const normalized = normalizePathText(text);
      const matched = skills.filter((skill) => normalized.includes(normalizePathText(skill.path)));
      if (matched.length) {
        for (const skill of matched) increment(report.skillUsage, skill.id);
      } else {
        const fallback = normalized.match(/\/([^/]+)\/skill\.md/i)?.[1];
        if (fallback) increment(report.skillUsage, fallback);
      }
    }
  }
}

function normalizePathText(value) {
  return value.replaceAll("\\", "/").replace(/\/{2,}/g, "/").toLowerCase();
}

function stringValues(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) for (const item of value) stringValues(item, output);
  else if (value && typeof value === "object") for (const item of Object.values(value)) stringValues(item, output);
  return output;
}

async function readPayload(reference, trace, bundleRoot) {
  if (!bundleRoot || !trace.__bundleId || !reference.path) return null;
  const file = path.join(bundleRoot, trace.__bundleId, reference.path);
  try {
    const info = await stat(file);
    if (info.size > MAX_PAYLOAD_BYTES) return null;
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function increment(record, key) {
  record[key] = (record[key] || 0) + 1;
}

function buildHabits(report, previousReviews) {
  const habits = [];
  const busiestHour = report.hourlyStarts.indexOf(Math.max(...report.hourlyStarts));
  if (report.summary.sessions) habits.push(`今天启动了 ${report.summary.sessions} 个 session，最常开始工作的时段是 ${String(busiestHour).padStart(2, "0")}:00。`);
  if (report.summary.modelCalls) {
    const callsPerTurn = report.summary.modelCalls / Math.max(1, report.summary.runtimeTurns);
    habits.push(`每个 runtime turn 平均触发 ${callsPerTurn.toFixed(1)} 次模型调用。`);
  }
  const topTool = topEntry(report.toolKinds);
  if (topTool) habits.push(`最常用工具类型是 ${topTool[0]}，共 ${topTool[1]} 次。`);
  if (report.summary.userMessages) habits.push(`共发送 ${report.summary.userMessages} 条用户消息，平均每条 ${Math.round(report.summary.userCharacters / report.summary.userMessages)} 个字符。`);
  const topProject = topEntry(report.projects);
  if (topProject) habits.push(`最常使用 Codex 的项目是 ${topProject[0]}，涉及 ${topProject[1]} 个 session。`);
  if (report.summary.inputTokens) {
    const cacheRate = report.summary.cachedInputTokens / report.summary.inputTokens * 100;
    habits.push(`输入 token 缓存命中占比约 ${cacheRate.toFixed(1)}%。`);
  }
  const recent = previousReviews.slice(0, 7);
  if (recent.length) {
    const averageSessions = recent.reduce((sum, item) => sum + item.summary.sessions, 0) / recent.length;
    habits.push(`过去 ${recent.length} 个有记录日平均 ${averageSessions.toFixed(1)} 个 session。`);
  }
  return habits;
}

function buildCleanupRecommendations(report, inventory, previousReviews, settings) {
  const recommendations = [];
  const oldestDate = [report, ...previousReviews].map((item) => item.date).sort()[0];
  const observedDays = Math.floor((new Date(`${report.date}T00:00:00`).getTime() - new Date(`${oldestDate}T00:00:00`).getTime()) / DAY_MS) + 1;
  const skillLastUsed = historicalLastUsed("skillUsage", report, previousReviews);
  const mcpLastUsed = historicalLastUsed("mcpUsage", report, previousReviews);
  for (const skill of inventory.skills) {
    const lastUsed = skillLastUsed.get(skill.id) || matchLastUsed(skillLastUsed, skill.id);
    if (!lastUsed && observedDays < settings.inactiveSkillDays) continue;
    const item = cleanupItem("skill", skill.id, lastUsed, report.date, observedDays);
    if (item.inactiveDays >= settings.inactiveSkillDays) recommendations.push(item);
  }
  for (const server of inventory.mcpServers) {
    const lastUsed = mcpLastUsed.get(server.id);
    if (!lastUsed && observedDays < settings.inactiveMcpDays) continue;
    const item = cleanupItem("mcp", server.id, lastUsed, report.date, observedDays);
    if (item.inactiveDays >= settings.inactiveMcpDays) recommendations.push(item);
  }
  return recommendations.filter(Boolean).sort((a, b) => b.inactiveDays - a.inactiveDays).slice(0, 50);
}

function historicalLastUsed(field, report, previousReviews) {
  const result = new Map();
  for (const item of [report, ...previousReviews]) {
    for (const [id, count] of Object.entries(item[field] || {})) if (count && !result.has(id)) result.set(id, item.date);
  }
  return result;
}

function matchLastUsed(map, id) {
  const normalized = id.toLowerCase();
  for (const [key, value] of map) if (normalized.includes(key.toLowerCase()) || key.toLowerCase().includes(normalized)) return value;
  return null;
}

function cleanupItem(type, id, lastUsed, reportDate, observedDays) {
  const inactiveDays = lastUsed
    ? Math.floor((new Date(`${reportDate}T00:00:00`).getTime() - new Date(`${lastUsed}T00:00:00`).getTime()) / DAY_MS)
    : observedDays;
  return { type, id, lastUsed, inactiveDays, reason: lastUsed ? `已 ${inactiveDays} 天未观察到使用` : `连续 ${observedDays} 天未观察到使用` };
}

function topEntry(record) {
  return Object.entries(record).sort((a, b) => b[1] - a[1])[0] || null;
}

export async function storeReview(report, dataRoot) {
  const reportsDir = path.join(dataRoot, "reports");
  await mkdir(reportsDir, { recursive: true });
  await writeJsonAtomic(path.join(reportsDir, `${report.date}.json`), report);
  await writeFile(path.join(reportsDir, `${report.date}.md`), renderMarkdown(report), "utf8");
}

export async function pruneReviews(dataRoot, retentionDays, now = Date.now()) {
  const reportsDir = path.join(dataRoot, "reports");
  let entries;
  try {
    entries = await readdir(reportsDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  const cutoff = now - retentionDays * DAY_MS;
  for (const entry of entries) {
    const match = entry.name.match(/^(\d{4}-\d{2}-\d{2})\.(json|md)$/);
    if (entry.isFile() && match && new Date(`${match[1]}T00:00:00`).getTime() < cutoff) {
      await unlink(path.join(reportsDir, entry.name));
    }
  }
}

export function renderMarkdown(report) {
  const summary = report.summary;
  const lines = [
    `# Codex Daily Review - ${report.date}`, "",
    `- Sessions: ${summary.sessions} (${summary.completedSessions} completed)`,
    `- Active time: ${(summary.activeMs / 3_600_000).toFixed(2)} hours`,
    `- Runtime turns: ${summary.runtimeTurns}`,
    `- Model calls: ${summary.modelCalls}`,
    `- Tool calls: ${summary.toolCalls}`,
    `- Tokens: ${summary.inputTokens} input / ${summary.outputTokens} output / ${summary.reasoningTokens} reasoning`,
    `- User messages: ${summary.userMessages} (${summary.userCharacters} characters)`,
    "", "## Habits", "", ...report.habits.map((item) => `- ${item}`),
    "", "## Cleanup Candidates", "",
    ...report.cleanupRecommendations.map((item) => `- ${item.type}: ${item.id} - ${item.reason}`), "",
  ];
  return lines.join("\n");
}

async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}
