import { buildTraceTree, findTraceNode, flattenTree, nodeDetails } from "./trace-detail.js";

const state = {
  traces: [], trace: null, traceTree: null, collapsedNodes: new Set(), selectedTraceId: null, selectedRowId: null, view: "tree",
  reviews: [], selectedReviewDate: null, settings: null, config: null,
};
const elements = {
  root: document.querySelector("#trace-root"),
  count: document.querySelector("#session-count"),
  sessions: document.querySelector("#sessions-list"),
  summary: document.querySelector("#trace-summary"),
  timeline: document.querySelector("#timeline-list"),
  details: document.querySelector("#details"),
  refresh: document.querySelector("#refresh"),
  autoRefresh: document.querySelector("#auto-refresh"),
  detailsPane: document.querySelector(".details"),
  traceWorkspace: document.querySelector("#trace-workspace"),
  reviewsWorkspace: document.querySelector("#reviews-workspace"),
  reviewCount: document.querySelector("#review-count"),
  reviewList: document.querySelector("#review-list"),
  reviewHeader: document.querySelector("#review-header"),
  reviewContent: document.querySelector("#review-content"),
  settingsButton: document.querySelector("#settings-button"),
  settingsDialog: document.querySelector("#settings-dialog"),
  settingsForm: document.querySelector("#settings-form"),
  settingsError: document.querySelector("#settings-error"),
  runReview: document.querySelector("#run-review"),
};

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const values = (object) => Object.values(object || {});
const duration = (execution) => execution?.ended_at_unix_ms == null
  ? "running"
  : `${Math.max(0, execution.ended_at_unix_ms - execution.started_at_unix_ms)} ms`;
const clock = (timestamp) => timestamp ? new Date(timestamp).toLocaleTimeString([], { hour12: false }) : "-";
const status = (execution) => execution?.status || "unknown";

async function api(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
    headers: options.body ? { "content-type": "application/json", ...(options.headers || {}) } : options.headers,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function setMode(mode) {
  document.querySelectorAll(".mode").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  elements.traceWorkspace.classList.toggle("hidden", mode !== "traces");
  elements.reviewsWorkspace.classList.toggle("hidden", mode !== "reviews");
  if (mode === "reviews") loadReviews();
}

function renderSessions() {
  elements.count.textContent = state.traces.length;
  elements.sessions.innerHTML = state.traces.map((trace) => `
    <button class="session ${trace.id === state.selectedTraceId ? "active" : ""}" data-trace="${escapeHtml(trace.id)}">
      <span class="session-id">${escapeHtml(trace.rolloutId || trace.id)}</span>
      <span class="session-meta"><span>${new Date(trace.startedAtUnixMs).toLocaleString()}</span><span>${trace.reducedAtUnixMs ? "ready" : "raw"}</span></span>
    </button>`).join("") || '<div class="empty">尚无 trace bundle</div>';
  elements.sessions.querySelectorAll("[data-trace]").forEach((button) => {
    button.addEventListener("click", () => loadTrace(button.dataset.trace));
  });
}

function traceMetrics(trace) {
  const calls = values(trace.inference_calls);
  const usage = calls.reduce((sum, call) => {
    sum.input += call.usage?.input_tokens || 0;
    sum.output += call.usage?.output_tokens || 0;
    return sum;
  }, { input: 0, output: 0 });
  return { calls: calls.length, tools: values(trace.tool_calls).length, turns: values(trace.codex_turns).length, usage };
}

function renderSummary() {
  if (!state.trace) return;
  const metrics = traceMetrics(state.trace);
  elements.summary.classList.remove("empty");
  elements.summary.innerHTML = `
    <h1>${escapeHtml(state.trace.rollout_id)}</h1>
    <div class="metrics">
      <span>Status <strong>${escapeHtml(state.trace.status)}</strong></span>
      <span>Runtime turns <strong>${metrics.turns}</strong></span>
      <span>Model calls <strong>${metrics.calls}</strong></span>
      <span>Tools <strong>${metrics.tools}</strong></span>
      <span>Tokens <strong>${metrics.usage.input.toLocaleString()} in / ${metrics.usage.output.toLocaleString()} out</strong></span>
    </div>`;
}

function turnRows() {
  const items = state.trace.conversation_items || {};
  return values(state.trace.codex_turns).map((turn) => {
    const inputs = turn.input_item_ids.map((id) => itemText(items[id])).filter(Boolean).join(" · ");
    return { id: turn.codex_turn_id, time: turn.execution.started_at_unix_ms, title: inputs || "Runtime activation", subtitle: `${turn.thread_id} · ${duration(turn.execution)}`, status: status(turn.execution), data: turn };
  });
}

function inferenceRows() {
  return values(state.trace.inference_calls).map((call) => ({
    id: call.inference_call_id, time: call.execution.started_at_unix_ms, title: call.model,
    subtitle: `${call.provider_name} · ${call.usage?.input_tokens || 0} in / ${call.usage?.output_tokens || 0} out · ${duration(call.execution)}`,
    status: status(call.execution), data: call,
  }));
}

function toolLabel(kind) {
  if (!kind) return "Tool";
  if (typeof kind === "string") return kind;
  if (kind.type === "mcp") return `${kind.server}/${kind.tool}`;
  if (kind.type) return kind.type;
  const [type, data] = Object.entries(kind)[0] || ["tool", null];
  return data?.tool ? `${data.server}/${data.tool}` : type;
}

function toolRows() {
  return values(state.trace.tool_calls).map((call) => ({
    id: call.tool_call_id, time: call.execution.started_at_unix_ms, title: toolLabel(call.kind),
    subtitle: `${summaryText(call.summary)} · ${duration(call.execution)}`,
    status: status(call.execution), data: call,
  }));
}

function conversationRows() {
  return values(state.trace.conversation_items).map((item) => ({
    id: item.item_id, time: item.first_seen_at_unix_ms, title: `${item.role} · ${item.kind}`,
    subtitle: itemText(item) || "Structured payload", status: item.channel || item.role, data: item,
  }));
}

function itemText(item) {
  return item?.body?.parts?.map((part) => part.text || part.source || part.summary || part.value || "").filter(Boolean).join(" ") || "";
}

function summaryText(summary) {
  if (!summary) return "";
  if (typeof summary === "string") return summary;
  if (summary.label) return summary.label;
  if (summary.message_preview) return summary.message_preview;
  if (summary.operation_id) return summary.operation_id;
  const [, data] = Object.entries(summary)[0] || [];
  return data?.label || data?.message_preview || data?.operation_id || "runtime call";
}

function currentRows() {
  const rows = state.view === "turns" ? turnRows() : state.view === "inference" ? inferenceRows() : state.view === "tools" ? toolRows() : conversationRows();
  return rows.sort((a, b) => a.time - b.time);
}

function renderTimeline() {
  if (!state.trace) return;
  if (state.view === "tree") {
    renderObservationTree();
    return;
  }
  if (state.view === "timeline") {
    renderWaterfall();
    return;
  }
  const rows = currentRows();
  elements.timeline.innerHTML = rows.map((row) => `
    <button class="row ${row.id === state.selectedRowId ? "active" : ""}" data-row="${escapeHtml(row.id)}">
      <span class="row-time">${clock(row.time)}</span>
      <span class="row-main"><span class="row-title">${escapeHtml(row.title)}</span><span class="row-subtitle">${escapeHtml(row.subtitle)}</span></span>
      <span class="badge ${escapeHtml(row.status)}">${escapeHtml(row.status)}</span>
    </button>`).join("") || '<div class="empty">此视图没有记录</div>';
  elements.timeline.querySelectorAll("[data-row]").forEach((button) => {
    button.addEventListener("click", () => selectRow(button.dataset.row));
  });
}

function renderObservationTree() {
  const rows = flattenTree(state.traceTree, state.collapsedNodes);
  elements.timeline.innerHTML = `<div class="observation-header"><span>Observation</span><span>Duration</span></div>${rows.map(({ node, depth }) => observationRow(node, depth)).join("")}`;
  wireObservationRows();
}

function observationRow(node, depth) {
  const hasChildren = node.children.length > 0;
  const collapsed = state.collapsedNodes.has(node.id);
  return `<div class="observation-row ${node.id === state.selectedRowId ? "active" : ""}" data-node="${escapeHtml(node.id)}">
    <button class="collapse-button ${hasChildren ? "" : "invisible"}" data-collapse="${escapeHtml(node.id)}" title="展开或折叠">${collapsed ? "›" : "⌄"}</button>
    <span class="tree-indent" style="width:${depth * 16}px"></span>
    <span class="node-type ${escapeHtml(node.type)}"></span>
    <span class="observation-name"><strong>${escapeHtml(node.title)}</strong><small>${escapeHtml(nodeTypeLabel(node.type))}</small></span>
    <span class="observation-duration">${formatNodeDuration(node)}</span>
  </div>`;
}

function wireObservationRows() {
  elements.timeline.querySelectorAll("[data-node]").forEach((row) => row.addEventListener("click", () => selectTraceNode(row.dataset.node)));
  elements.timeline.querySelectorAll("[data-collapse]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    const id = button.dataset.collapse;
    if (state.collapsedNodes.has(id)) state.collapsedNodes.delete(id); else state.collapsedNodes.add(id);
    renderTimeline();
  }));
}

function renderWaterfall() {
  const rows = flattenTree(state.traceTree, state.collapsedNodes);
  const start = state.trace.started_at_unix_ms;
  const end = Math.max(state.trace.ended_at_unix_ms || Date.now(), ...rows.map(({ node }) => node.end || node.start || start));
  const range = Math.max(1, end - start);
  elements.timeline.innerHTML = `<div class="waterfall-head"><span>Observation</span><span class="waterfall-scale"><i>0 ms</i><i>${formatMilliseconds(range / 2)}</i><i>${formatMilliseconds(range)}</i></span></div>
    <div class="waterfall-body">${rows.map(({ node, depth }) => {
      const left = Math.max(0, ((node.start || start) - start) / range * 100);
      const width = Math.max(0.7, ((node.end || end) - (node.start || start)) / range * 100);
      return `<div class="waterfall-row ${node.id === state.selectedRowId ? "active" : ""}" data-node="${escapeHtml(node.id)}">
        <span class="waterfall-label" style="padding-left:${8 + depth * 14}px"><span class="node-type ${escapeHtml(node.type)}"></span><strong>${escapeHtml(node.title)}</strong></span>
        <span class="waterfall-chart"><i class="waterfall-bar ${escapeHtml(node.type)}" style="left:${left}%;width:${Math.min(width, 100 - left)}%" title="${escapeHtml(formatNodeDuration(node))}"></i></span>
      </div>`;
    }).join("")}</div>`;
  elements.timeline.querySelectorAll("[data-node]").forEach((row) => row.addEventListener("click", () => selectTraceNode(row.dataset.node)));
}

function nodeTypeLabel(type) {
  return ({ trace: "TRACE", turn: "TURN", generation: "GENERATION", tool: "SPAN · TOOL", code: "SPAN · CODE", compaction: "SPAN · COMPACTION" })[type] || type.toUpperCase();
}

function formatNodeDuration(node) {
  if (!node.start) return "-";
  if (!node.end) return "running";
  return formatMilliseconds(Math.max(0, node.end - node.start));
}

function formatMilliseconds(value) {
  if (value >= 60_000) return `${(value / 60_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}s`;
  return `${Math.round(value)}ms`;
}

function payloadIds(data) {
  const ids = [];
  for (const [key, value] of Object.entries(data)) {
    if (key.endsWith("payload_id") && typeof value === "string") ids.push(value);
    if (key.endsWith("payload_ids") && Array.isArray(value)) ids.push(...value);
  }
  return [...new Set(ids)];
}

function selectRow(id) {
  if (state.view !== "conversation") {
    selectTraceNode(id);
    return;
  }
  state.selectedRowId = id;
  renderTimeline();
  const row = currentRows().find((candidate) => candidate.id === id);
  if (!row) return;
  const data = row.data;
  const execution = data.execution;
  const payloads = payloadIds(data);
  elements.details.classList.remove("empty");
  elements.details.innerHTML = `
    <h2>${escapeHtml(row.title)}</h2>
    <dl class="kv">
      <dt>ID</dt><dd>${escapeHtml(row.id)}</dd>
      <dt>Started</dt><dd>${new Date(row.time).toLocaleString()}</dd>
      ${execution ? `<dt>Duration</dt><dd>${duration(execution)}</dd><dt>Status</dt><dd>${escapeHtml(status(execution))}</dd>` : ""}
    </dl>
    ${payloads.length ? `<div class="section-title">Raw payloads</div>${payloads.map((payload) => `<button class="payload-button" data-payload="${escapeHtml(payload)}">${escapeHtml(payload)}</button>`).join("")}<pre id="payload-preview">选择 payload 查看原始数据</pre>` : ""}
    <div class="section-title">Reduced object</div><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  elements.details.querySelectorAll("[data-payload]").forEach((button) => {
    button.addEventListener("click", () => loadPayload(button.dataset.payload));
  });
  elements.detailsPane.classList.add("open");
}

async function selectTraceNode(id) {
  const node = findTraceNode(state.traceTree, id);
  if (!node) return;
  state.selectedRowId = id;
  renderTimeline();
  const detail = nodeDetails(state.trace, node);
  elements.details.classList.remove("empty");
  elements.details.innerHTML = renderNodeDetail(detail);
  elements.detailsPane.classList.add("open");
  elements.details.querySelectorAll("[data-payload]").forEach((button) => button.addEventListener("click", () => loadNodePayload(button.dataset.payload, button.dataset.label)));
}

function renderNodeDetail(detail) {
  const metadata = detail.metadata.filter(([, value]) => value !== null && value !== undefined);
  return `<div class="detail-header">
      <div><span class="detail-kind"><span class="node-type ${escapeHtml(detail.type)}"></span>${escapeHtml(nodeTypeLabel(detail.type))}</span><h2>${escapeHtml(detail.title)}</h2></div>
      <span class="badge ${escapeHtml(detail.status)}">${escapeHtml(detail.status)}</span>
    </div>
    <dl class="kv detail-metadata">
      <dt>Started</dt><dd>${detail.startedAt ? new Date(detail.startedAt).toLocaleString() : "-"}</dd>
      <dt>Duration</dt><dd>${formatNodeDuration({ start: detail.startedAt, end: detail.endedAt })}</dd>
      ${metadata.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}
    </dl>
    ${ioSection("Input", detail.input)}
    ${ioSection("Output", detail.output)}
    ${detail.payloads.length ? `<section class="io-section"><div class="io-title">Raw payloads</div><div>${detail.payloads.map((payload) => `<button class="payload-button" data-payload="${escapeHtml(payload.id)}" data-label="${escapeHtml(payload.label)}">${escapeHtml(payload.label)}</button>`).join("")}</div><pre id="node-payload-preview">选择 payload 查看完整原始数据</pre></section>` : ""}
    <details class="raw-object"><summary>Reduced object</summary><pre>${escapeHtml(JSON.stringify(detail.raw, null, 2))}</pre></details>`;
}

function ioSection(title, value) {
  if (value === null || value === undefined || value === "") return `<section class="io-section"><div class="io-title">${title}</div><div class="empty-io">No ${title.toLowerCase()} captured</div></section>`;
  return `<section class="io-section"><div class="io-title">${title}</div><pre class="io-preview">${escapeHtml(formatPreview(value))}</pre></section>`;
}

function formatPreview(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

async function loadNodePayload(payloadId, label) {
  const preview = document.querySelector("#node-payload-preview");
  preview.textContent = `Loading ${label}…`;
  try {
    const payload = await api(`/api/traces/${encodeURIComponent(state.selectedTraceId)}/payloads/${encodeURIComponent(payloadId)}`);
    preview.textContent = formatPreview(payload);
  } catch (error) {
    preview.textContent = error.message;
  }
}

async function loadPayload(payloadId) {
  const preview = document.querySelector("#payload-preview");
  preview.textContent = "Loading…";
  try {
    const payload = await api(`/api/traces/${encodeURIComponent(state.selectedTraceId)}/payloads/${encodeURIComponent(payloadId)}`);
    preview.textContent = JSON.stringify(payload, null, 2);
  } catch (error) {
    preview.textContent = error.message;
  }
}

async function loadTrace(id, reduce = true) {
  state.selectedTraceId = id;
  state.selectedRowId = null;
  renderSessions();
  elements.timeline.innerHTML = '<div class="empty">正在载入…</div>';
  try {
    state.trace = await api(`/api/traces/${encodeURIComponent(id)}${reduce ? "?reduce=1" : ""}`);
  } catch (error) {
    elements.timeline.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
    return;
  }
  state.traceTree = buildTraceTree(state.trace);
  state.collapsedNodes = new Set();
  state.selectedRowId = state.traceTree.id;
  renderSummary();
  renderTimeline();
  await selectTraceNode(state.traceTree.id);
}

async function refresh() {
  try {
    const [config, result] = await Promise.all([api("/api/config"), api("/api/traces")]);
    state.config = config;
    elements.root.textContent = config.traceRoot;
    state.traces = result.traces;
    renderSessions();
    if (!state.selectedTraceId && state.traces[0]) await loadTrace(state.traces[0].id);
  } catch (error) {
    elements.sessions.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  }
}

async function loadReviews(selectDate) {
  try {
    const result = await api("/api/reviews");
    state.reviews = result.reviews;
    if (selectDate) state.selectedReviewDate = selectDate;
    if (!state.selectedReviewDate && state.reviews[0]) state.selectedReviewDate = state.reviews[0].date;
    renderReviewList();
    renderSelectedReview();
  } catch (error) {
    elements.reviewContent.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  }
}

function renderReviewList() {
  elements.reviewCount.textContent = state.reviews.length;
  elements.reviewList.innerHTML = state.reviews.map((review) => `
    <button class="session ${review.date === state.selectedReviewDate ? "active" : ""}" data-review="${review.date}">
      <span class="session-id">${review.date}</span>
      <span class="session-meta"><span>${review.summary.sessions} sessions</span><span>${review.summary.modelCalls} calls</span></span>
    </button>`).join("") || '<div class="empty">尚无日报，点击设置后立即复盘</div>';
  elements.reviewList.querySelectorAll("[data-review]").forEach((button) => button.addEventListener("click", () => {
    state.selectedReviewDate = button.dataset.review;
    renderReviewList();
    renderSelectedReview();
  }));
}

function renderSelectedReview() {
  const review = state.reviews.find((item) => item.date === state.selectedReviewDate);
  if (!review) {
    elements.reviewHeader.className = "review-header empty";
    elements.reviewHeader.textContent = "运行今日复盘后查看使用习惯";
    elements.reviewContent.innerHTML = "";
    return;
  }
  const summary = review.summary;
  elements.reviewHeader.classList.remove("empty");
  elements.reviewHeader.innerHTML = `<h1>${review.date} 使用复盘</h1><div class="metrics"><span>生成于 <strong>${new Date(review.generatedAtUnixMs).toLocaleString()}</strong></span><span>Sessions <strong>${summary.sessions}</strong></span><span>活跃时间 <strong>${formatDuration(summary.activeMs)}</strong></span></div>`;
  elements.reviewContent.innerHTML = `
    <div class="stat-grid">
      ${statCard("Sessions", summary.sessions)}${statCard("Runtime turns", summary.runtimeTurns)}${statCard("Model calls", summary.modelCalls)}
      ${statCard("Tool calls", summary.toolCalls)}${statCard("Input tokens", summary.inputTokens.toLocaleString())}${statCard("Output tokens", summary.outputTokens.toLocaleString())}
    </div>
    ${reviewSection("使用习惯", `<ul class="habit-list">${review.habits.map((habit) => `<li>${escapeHtml(habit)}</li>`).join("") || "<li>数据不足</li>"}</ul>`)}
    ${reviewSection("工具分布", usageBars(review.toolKinds))}
    ${reviewSection("模型分布", usageBars(review.models))}
    ${reviewSection("Skill / MCP 清理候选", cleanupTable(review.cleanupRecommendations))}
  `;
}

function statCard(label, value) {
  return `<div class="stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function reviewSection(title, body) {
  return `<section class="review-section"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

function usageBars(record) {
  const entries = Object.entries(record || {}).sort((a, b) => b[1] - a[1]);
  const max = entries[0]?.[1] || 1;
  return `<div class="usage-bars">${entries.map(([label, count]) => `<div class="usage-bar"><span>${escapeHtml(label)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, count / max * 100)}%"></div></div><strong>${count}</strong></div>`).join("") || "暂无记录"}</div>`;
}

function cleanupTable(items) {
  if (!items?.length) return "没有达到清理阈值的 Skill 或 MCP。";
  return `<table class="cleanup-table"><thead><tr><th>类型</th><th>名称</th><th>最后观察</th><th>建议依据</th></tr></thead><tbody>${items.map((item) => `<tr><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.lastUsed || "未观察到")}</td><td>${escapeHtml(item.reason)}</td></tr>`).join("")}</tbody></table>`;
}

function formatDuration(milliseconds) {
  const minutes = Math.round(milliseconds / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

async function openSettings() {
  try {
    state.settings = await api("/api/settings");
    elements.settingsForm.elements.enabled.checked = state.settings.enabled;
    elements.settingsForm.elements.scheduleTime.value = state.settings.scheduleTime;
    elements.settingsForm.elements.inactiveSkillDays.value = state.settings.inactiveSkillDays;
    elements.settingsForm.elements.inactiveMcpDays.value = state.settings.inactiveMcpDays;
    elements.settingsForm.elements.retentionDays.value = state.settings.retentionDays;
    document.querySelector("#data-root").textContent = state.config?.dataRoot || state.settings.dataRoot;
    elements.settingsError.textContent = "";
    elements.settingsDialog.showModal();
  } catch (error) {
    alert(error.message);
  }
}

async function saveSettings() {
  const form = elements.settingsForm.elements;
  const payload = {
    enabled: form.enabled.checked,
    scheduleTime: form.scheduleTime.value,
    inactiveSkillDays: Number(form.inactiveSkillDays.value),
    inactiveMcpDays: Number(form.inactiveMcpDays.value),
    retentionDays: Number(form.retentionDays.value),
  };
  state.settings = await api("/api/settings", { method: "PUT", body: JSON.stringify(payload) });
}

async function runReviewNow() {
  elements.runReview.disabled = true;
  elements.runReview.textContent = "正在归约全部调用…";
  elements.settingsError.textContent = "";
  try {
    const review = await api("/api/reviews/run", { method: "POST" });
    elements.settingsDialog.close();
    setMode("reviews");
    await loadReviews(review.date);
  } catch (error) {
    elements.settingsError.textContent = error.message;
  } finally {
    elements.runReview.disabled = false;
    elements.runReview.textContent = "立即复盘今天";
  }
}

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === tab));
  state.view = tab.dataset.view;
  state.selectedRowId = null;
  renderTimeline();
}));
elements.refresh.addEventListener("click", refresh);
document.querySelectorAll(".mode").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
elements.settingsButton.addEventListener("click", openSettings);
elements.runReview.addEventListener("click", runReviewNow);
elements.settingsForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value !== "save") return;
  event.preventDefault();
  try {
    await saveSettings();
    elements.settingsDialog.close();
  } catch (error) {
    elements.settingsError.textContent = error.message;
  }
});
setInterval(() => { if (elements.autoRefresh.checked) refresh(); }, 3000);
refresh();
