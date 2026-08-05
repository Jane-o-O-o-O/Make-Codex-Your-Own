import { buildTraceTree, findTraceNode, flattenTree, nodeDetails } from "./trace-detail.js";

const state = {
  traces: [], trace: null, traceTree: null, collapsedNodes: new Set(), selectedTraceId: null, selectedRowId: null, view: "tree",
  reviews: [], selectedReviewDate: null, selectedDay: null, settings: null, config: null, sessionQuery: "", treeQuery: "",
  sessionStatus: "all", sessionModel: "all", route: "days", mobileView: "tree", isInteracting: false,
  lastRefreshAt: null, refreshInFlight: false,
};
const elements = {
  dayBrowser: document.querySelector("#day-browser"),
  sessionBrowser: document.querySelector("#session-browser"),
  days: document.querySelector("#days-list"),
  dayCount: document.querySelector("#day-count"),
  sessionsDayTitle: document.querySelector("#sessions-day-title"),
  breadcrumbDay: document.querySelector("#breadcrumb-day"),
  breadcrumbSessionSeparator: document.querySelector("#breadcrumb-session-separator"),
  backToDays: document.querySelector("#back-to-days"),
  count: document.querySelector("#session-count"),
  sessions: document.querySelector("#sessions-list"),
  sessionSearch: document.querySelector("#session-search"),
  sessionStatusFilter: document.querySelector("#session-status-filter"),
  sessionModelFilter: document.querySelector("#session-model-filter"),
  activeSessionName: document.querySelector("#active-session-name"),
  treeSearch: document.querySelector("#tree-search"),
  expandAll: document.querySelector("#expand-all"),
  graph: document.querySelector("#graph-canvas"),
  graphFit: document.querySelector("#graph-fit"),
  summary: document.querySelector("#trace-summary"),
  timeline: document.querySelector("#timeline-list"),
  details: document.querySelector("#details"),
  refresh: document.querySelector("#refresh"),
  autoRefresh: document.querySelector("#auto-refresh"),
  refreshInterval: document.querySelector("#refresh-interval"),
  captureStatus: document.querySelector("#capture-status"),
  lastRefresh: document.querySelector("#last-refresh"),
  mobileTabs: document.querySelector("#mobile-view-tabs"),
  detailsPane: document.querySelector(".details"),
  traceNavigation: document.querySelector(".trace-navigation"),
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
  settingsSaved: document.querySelector("#settings-saved"),
  traceRootSetting: document.querySelector("#trace-root-setting"),
  codexExecutable: document.querySelector("#codex-executable"),
  runReview: document.querySelector("#run-review"),
};

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const values = (object) => Object.values(object || {});
const duration = (execution) => execution?.ended_at_unix_ms == null
  ? "运行中"
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
  if (!response.ok) {
    const error = new Error(body.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function setMode(mode) {
  document.querySelectorAll(".mode").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  if (mode === "settings") {
    elements.breadcrumbDay.textContent = "设置";
    elements.breadcrumbDay.classList.remove("hidden");
    elements.breadcrumbSessionSeparator.classList.add("hidden");
    elements.activeSessionName.classList.add("hidden");
    elements.dayBrowser.classList.add("hidden");
    elements.sessionBrowser.classList.add("hidden");
    elements.traceWorkspace.classList.add("hidden");
    elements.reviewsWorkspace.classList.add("hidden");
    openSettings();
    return;
  }
  if (mode === "traces") showDays(true);
  else {
    elements.dayBrowser.classList.add("hidden");
    elements.sessionBrowser.classList.add("hidden");
    elements.traceWorkspace.classList.add("hidden");
    elements.breadcrumbDay.textContent = mode === "reviews" ? "每日复盘" : "设置";
    elements.breadcrumbDay.classList.remove("hidden");
    elements.breadcrumbSessionSeparator.classList.add("hidden");
    elements.activeSessionName.classList.add("hidden");
    state.route = "reviews";
    updateHash("reviews");
  }
  elements.reviewsWorkspace.classList.toggle("hidden", mode !== "reviews");
  if (mode === "reviews") loadReviews();
}

function updateHash(value, replace = false) {
  const next = `#${value}`;
  if (window.location.hash === next) return;
  if (replace) window.history.replaceState(null, "", next);
  else window.history.pushState(null, "", next);
}

function routeForSession(day, traceId, nodeId = "") {
  const params = new URLSearchParams({ day, trace: traceId });
  if (nodeId) params.set("node", nodeId);
  return `trace?${params}`;
}

function syncRouteFromHash() {
  const raw = window.location.hash.slice(1);
  if (!raw || raw === "traces") return showDays(false);
  if (raw === "reviews") return setMode("reviews");
  const [name, query] = raw.split("?");
  const params = new URLSearchParams(query || "");
  if (name === "day" && params.get("value")) return showSessions(params.get("value"), false);
  if (name === "trace" && params.get("trace")) {
    const traceId = params.get("trace");
    const trace = state.traces.find((item) => item.id === traceId);
    if (!trace) return showDays(false);
    state.selectedTraceId = traceId;
    showSessions(localDay(trace.startedAtUnixMs), false);
    return loadTrace(traceId, { nodeId: params.get("node") || "" });
  }
  showDays(false);
}

function localDay(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function groupedDays() {
  const groups = new Map();
  for (const trace of state.traces) {
    const day = localDay(trace.startedAtUnixMs);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(trace);
  }
  return [...groups.entries()].sort(([left], [right]) => right.localeCompare(left));
}

function renderDays() {
  const days = groupedDays();
  elements.dayCount.textContent = days.length;
  elements.days.innerHTML = days.map(([day, traces]) => {
    const ready = traces.filter((trace) => trace.reducedAtUnixMs).length;
    return `<button class="day-row" data-day="${day}"><span class="day-icon">▦</span><span class="day-main"><strong>${day}</strong><small>${new Date(`${day}T00:00:00`).toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</small></span><span class="day-stat"><strong>${traces.length}</strong><small>会话</small></span><span class="day-stat"><strong>${ready}</strong><small>已归约</small></span><span class="row-arrow">›</span></button>`;
  }).join("") || `<div class="empty-onboarding"><span class="state-icon">⌁</span><h2>还没有可浏览的会话</h2><p>先让 Codex 写入 rollout trace，再回到这里刷新。所有数据只保存在本机。</p><div class="onboarding-path">Trace 根目录：<code>${escapeHtml(state.config?.traceRoot || "未配置")}</code></div><div class="onboarding-actions"><button class="primary-action" id="onboarding-refresh">刷新</button><button class="secondary-action" id="onboarding-settings">检查设置</button></div></div>`;
  elements.days.querySelectorAll("[data-day]").forEach((button) => button.addEventListener("click", () => showSessions(button.dataset.day)));
  document.querySelector("#onboarding-refresh")?.addEventListener("click", () => refresh());
  document.querySelector("#onboarding-settings")?.addEventListener("click", openSettings);
}

function showDays(sync = true) {
  document.querySelectorAll(".mode").forEach((button) => button.classList.toggle("active", button.dataset.mode === "traces"));
  state.selectedDay = null;
  state.route = "days";
  if (sync) updateHash("traces");
  elements.dayBrowser.classList.remove("hidden");
  elements.sessionBrowser.classList.add("hidden");
  elements.traceWorkspace.classList.add("hidden");
  elements.reviewsWorkspace.classList.add("hidden");
  elements.breadcrumbDay.classList.add("hidden");
  elements.breadcrumbSessionSeparator.classList.add("hidden");
  elements.activeSessionName.classList.add("hidden");
  renderDays();
}

function showSessions(day, sync = true) {
  document.querySelectorAll(".mode").forEach((button) => button.classList.toggle("active", button.dataset.mode === "traces"));
  state.selectedDay = day;
  state.route = "sessions";
  if (sync) updateHash(`day?value=${encodeURIComponent(day)}`);
  state.sessionQuery = "";
  state.sessionStatus = "all";
  state.sessionModel = "all";
  elements.sessionSearch.value = "";
  elements.sessionStatusFilter.value = "all";
  elements.sessionModelFilter.value = "all";
  elements.dayBrowser.classList.add("hidden");
  elements.sessionBrowser.classList.remove("hidden");
  elements.traceWorkspace.classList.add("hidden");
  elements.sessionsDayTitle.textContent = day;
  elements.breadcrumbDay.textContent = day;
  elements.breadcrumbDay.classList.remove("hidden");
  elements.breadcrumbSessionSeparator.classList.add("hidden");
  elements.activeSessionName.classList.add("hidden");
  renderSessions();
}

function renderSessions() {
  const query = state.sessionQuery.trim().toLowerCase();
  const traces = state.traces.filter((trace) => {
    if (localDay(trace.startedAtUnixMs) !== state.selectedDay) return false;
    if (state.sessionStatus !== "all" && trace.status !== state.sessionStatus) return false;
    if (state.sessionModel !== "all" && !(trace.models || []).includes(state.sessionModel)) return false;
    return !query || `${trace.rolloutId} ${trace.id} ${trace.firstUserMessage} ${trace.project} ${(trace.models || []).join(" ")}`.toLowerCase().includes(query);
  });
  elements.count.textContent = traces.length;
  const models = [...new Set(state.traces.filter((trace) => localDay(trace.startedAtUnixMs) === state.selectedDay).flatMap((trace) => trace.models || []))].sort();
  const currentModel = state.sessionModel;
  elements.sessionModelFilter.innerHTML = `<option value="all">全部模型</option>${models.map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join("")}`;
  elements.sessionModelFilter.value = models.includes(currentModel) ? currentModel : "all";
  elements.sessions.innerHTML = traces.map((trace) => `
    <button class="session-row ${trace.id === state.selectedTraceId ? "active" : ""}" data-trace="${escapeHtml(trace.id)}">
      <span class="session-type-icon" aria-hidden="true">⌁</span><span class="session-main"><strong>${escapeHtml(trace.firstUserMessage || trace.rolloutId || trace.id)}</strong><small>${escapeHtml(trace.rolloutId || trace.id)} · ${new Date(trace.startedAtUnixMs).toLocaleTimeString([], { hour12: false })}${trace.project ? ` · ${escapeHtml(trace.project)}` : ""}</small></span>
      <span class="session-state ${trace.reducedAtUnixMs ? trace.status : "raw"}">${trace.reducedAtUnixMs ? statusLabel(trace.status) : "待归约"}</span><span class="session-model">${escapeHtml((trace.models || []).join(", ") || "未识别")}</span><span class="session-node-count">${trace.tools || 0} 工具</span><span class="session-token-count">${formatCompactTokens((trace.inputTokens || 0) + (trace.outputTokens || 0))}</span><span class="session-duration">${trace.durationMs == null ? "进行中" : formatMilliseconds(trace.durationMs)}</span><span class="row-arrow">›</span>
    </button>`).join("") || '<div class="empty">暂无 Trace 数据包</div>';
  elements.sessions.querySelectorAll("[data-trace]").forEach((button) => {
    button.addEventListener("click", () => loadTrace(button.dataset.trace));
  });
}

function statusLabel(value) {
  return ({ completed: "已完成", running: "运行中", failed: "失败", cancelled: "已取消", aborted: "已中止", raw: "待归约", corrupt: "文件损坏", unknown: "未知" })[value] || value || "未知";
}

function formatCompactTokens(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value || 0);
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
    <div class="summary-kicker">TRACE</div><h1>${escapeHtml(state.trace.rollout_id)}</h1>
    <div class="summary-date">${new Date(state.trace.started_at_unix_ms).toLocaleString()}</div>
    <div class="metrics">
      <span>耗时: <strong>${state.trace.ended_at_unix_ms == null ? "运行中" : formatMilliseconds(state.trace.ended_at_unix_ms - state.trace.started_at_unix_ms)}</strong></span>
      <span>状态: <strong>${escapeHtml(statusLabel(state.trace.status))}</strong></span>
      <span>${metrics.calls} 次模型调用</span><span>${metrics.tools} 次工具调用</span>
      <span>${metrics.usage.input.toLocaleString()} 输入 → ${metrics.usage.output.toLocaleString()} 输出</span>
    </div>`;
}

function turnRows() {
  const items = state.trace.conversation_items || {};
  return values(state.trace.codex_turns).map((turn) => {
    const inputs = turn.input_item_ids.map((id) => itemText(items[id])).filter(Boolean).join(" · ");
    return { id: turn.codex_turn_id, time: turn.execution.started_at_unix_ms, title: inputs || "运行时激活", subtitle: `${turn.thread_id} · ${duration(turn.execution)}`, status: status(turn.execution), data: turn };
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
  if (!kind) return "工具";
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
  return data?.label || data?.message_preview || data?.operation_id || "运行时调用";
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
  if (state.view === "graph") {
    renderGraphInTimeline();
    return;
  }
  if (state.view === "conversation") {
    renderConversation();
    return;
  }
  const rows = currentRows();
  elements.timeline.innerHTML = rows.map((row) => `
    <button class="row ${row.id === state.selectedRowId ? "active" : ""}" data-row="${escapeHtml(row.id)}">
      <span class="row-time">${clock(row.time)}</span>
      <span class="row-main"><span class="row-title">${escapeHtml(row.title)}</span><span class="row-subtitle">${escapeHtml(row.subtitle)}</span></span>
      <span class="badge ${escapeHtml(row.status)}">${escapeHtml(statusLabel(row.status))}</span>
    </button>`).join("") || '<div class="empty">此视图没有记录</div>';
  elements.timeline.querySelectorAll("[data-row]").forEach((button) => {
    button.addEventListener("click", () => selectRow(button.dataset.row));
  });
}

function renderObservationTree() {
  const query = state.treeQuery.trim().toLowerCase();
  const rows = query ? filteredTreeRows(state.traceTree, state.collapsedNodes, query) : flattenTree(state.traceTree, state.collapsedNodes);
  elements.timeline.innerHTML = `<div class="observation-header"><span>观察节点</span><span>耗时</span></div>${rows.map(({ node, depth }) => observationRow(node, depth)).join("")}`;
  wireObservationRows();
}

function filteredTreeRows(root, collapsed, query) {
  const rows = [];
  function visit(node, depth, ancestorsMatch = false) {
    const matches = `${node.title} ${node.type}`.toLowerCase().includes(query);
    const childRows = [];
    for (const child of node.children) {
      const before = rows.length;
      visit(child, depth + 1, ancestorsMatch || matches);
      childRows.push(...rows.splice(before));
    }
    if (matches || childRows.length || ancestorsMatch) rows.push({ node, depth });
    rows.push(...childRows);
  }
  visit(root, 0);
  return rows.filter(({ node, depth }) => depth === 0 || !collapsed.has(node.id) || query);
}

function observationRow(node, depth) {
  const hasChildren = node.children.length > 0;
  const collapsed = state.collapsedNodes.has(node.id);
  return `<div class="observation-row ${node.id === state.selectedRowId ? "active" : ""}" data-node="${escapeHtml(node.id)}" role="treeitem" tabindex="0" aria-expanded="${hasChildren ? String(!collapsed) : "false"}">
    <button class="collapse-button ${hasChildren ? "" : "invisible"}" data-collapse="${escapeHtml(node.id)}" title="展开或折叠" aria-label="${collapsed ? "展开" : "折叠"}">${collapsed ? "›" : "⌄"}</button>
    <span class="tree-indent" style="width:${depth * 16}px"></span>
    <span class="node-type ${escapeHtml(node.type)}">${nodeIcon(node)}</span>
    <span class="observation-name"><strong>${escapeHtml(node.title)}</strong><small>${escapeHtml(nodeTypeLabel(node.type))}</small></span>
    <span class="observation-duration">${formatNodeDuration(node)}</span>
  </div>`;
}

function nodeIcon(node) {
  if (node.type === "trace") return "⌁";
  if (node.type === "turn") return "↪";
  if (node.type === "generation") return "✦";
  if (node.type === "code") return "⌘";
  if (node.type === "compaction") return "⇲";
  if (node.type === "tool") {
    const kind = node.data?.kind?.type || node.raw?.kind?.type;
    if (kind === "exec_command" || kind === "shell") return ">_";
    if (kind === "mcp") return "◇";
    if (kind === "apply_patch") return "±";
    return "⚙";
  }
  return "•";
}

function wireObservationRows() {
  elements.timeline.querySelectorAll("[data-node]").forEach((row) => {
    row.addEventListener("click", () => selectTraceNode(row.dataset.node));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectTraceNode(row.dataset.node); }
    });
  });
  elements.timeline.querySelectorAll("[data-collapse]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    const id = button.dataset.collapse;
    if (state.collapsedNodes.has(id)) state.collapsedNodes.delete(id); else state.collapsedNodes.add(id);
    renderTimeline();
  }));
}

function renderWaterfall() {
  const query = state.treeQuery.trim().toLowerCase();
  const rows = query ? filteredTreeRows(state.traceTree, state.collapsedNodes, query) : flattenTree(state.traceTree, state.collapsedNodes);
  const start = state.trace.started_at_unix_ms;
  const end = Math.max(state.trace.ended_at_unix_ms || Date.now(), ...rows.map(({ node }) => node.end || node.start || start));
  const range = Math.max(1, end - start);
  elements.timeline.innerHTML = `<div class="waterfall-head"><span>观察节点</span><span class="waterfall-scale"><i>0 ms</i><i>${formatMilliseconds(range / 2)}</i><i>${formatMilliseconds(range)}</i></span></div>
    <div class="waterfall-body">${rows.map(({ node, depth }) => {
      const left = Math.max(0, ((node.start || start) - start) / range * 100);
      const width = Math.max(0.7, ((node.end || end) - (node.start || start)) / range * 100);
      return `<div class="waterfall-row ${node.id === state.selectedRowId ? "active" : ""}" data-node="${escapeHtml(node.id)}">
        <span class="waterfall-label" style="padding-left:${8 + depth * 14}px"><span class="node-type ${escapeHtml(node.type)}">${nodeIcon(node)}</span><strong>${escapeHtml(node.title)}</strong></span>
        <span class="waterfall-chart"><i class="waterfall-bar ${escapeHtml(node.type)}" style="left:${left}%;width:${Math.min(width, 100 - left)}%" title="${escapeHtml(formatNodeDuration(node))}"></i></span>
      </div>`;
    }).join("")}</div>`;
  elements.timeline.querySelectorAll("[data-node]").forEach((row) => row.addEventListener("click", () => selectTraceNode(row.dataset.node)));
}

function renderConversation() {
  const query = state.treeQuery.trim().toLowerCase();
  const rows = values(state.trace.conversation_items).sort((left, right) => (left.first_seen_at_unix_ms || 0) - (right.first_seen_at_unix_ms || 0)).filter((item) => {
    const text = itemText(item);
    return !query || `${item.role} ${item.kind} ${text}`.toLowerCase().includes(query);
  });
  elements.timeline.innerHTML = rows.map((item) => `<article class="conversation-item ${escapeHtml(item.role || "unknown")}" tabindex="0" data-row="${escapeHtml(item.item_id)}"><div class="conversation-meta"><strong>${escapeHtml(item.role || "unknown")}</strong><span>${escapeHtml(item.channel || item.kind || "")}</span><time>${clock(item.first_seen_at_unix_ms)}</time></div><div class="conversation-content">${escapeHtml(itemText(item) || "结构化内容")}</div></article>`).join("") || '<div class="empty">没有符合条件的对话内容</div>';
  elements.timeline.querySelectorAll("[data-row]").forEach((row) => row.addEventListener("click", () => selectRow(row.dataset.row)));
}

function renderGraphInTimeline() {
  const rows = flattenTree(state.traceTree, new Set());
  elements.timeline.innerHTML = `<div class="graph-expanded-head"><span>轨迹关系图</span><span>${rows.length} 个节点</span></div><div class="graph-expanded">${rows.slice(0, 100).map(({ node, depth }) => `<button class="graph-node ${escapeHtml(node.type)} ${node.id === state.selectedRowId ? "active" : ""}" data-node="${escapeHtml(node.id)}" style="--depth:${depth}"><span>${nodeIcon(node)} ${escapeHtml(node.title)}</span><small>${formatNodeDuration(node)}</small></button>`).join("")}</div>${rows.length > 100 ? '<div class="graph-truncated">关系图已显示前 100 个节点，树和时间线仍保留全部节点。</div>' : ""}`;
  elements.timeline.querySelectorAll("[data-node]").forEach((button) => button.addEventListener("click", () => selectTraceNode(button.dataset.node)));
}

function renderGraph() {
  if (!state.traceTree) return;
  const allRows = flattenTree(state.traceTree, new Set());
  const rows = allRows.slice(0, 100);
  elements.graph.classList.remove("empty");
  elements.graph.innerHTML = `<div class="graph-flow">${rows.map(({ node, depth }, index) => `
    <button class="graph-node ${escapeHtml(node.type)} ${node.id === state.selectedRowId ? "active" : ""}" data-node="${escapeHtml(node.id)}" style="--depth:${depth}">
      <span>${nodeIcon(node)} ${escapeHtml(node.title)}</span><small>${formatNodeDuration(node)}</small>
    </button>${index < rows.length - 1 ? '<i class="graph-line"></i>' : ""}`).join("")}</div>${allRows.length > 100 ? `<div class="graph-truncated">关系图已显示前 100 个节点，完整节点仍可在树和时间线中查看。</div>` : ""}`;
  elements.graph.querySelectorAll("[data-node]").forEach((button) => button.addEventListener("click", () => selectTraceNode(button.dataset.node)));
}

function nodeTypeLabel(type) {
  return ({ trace: "TRACE", turn: "TURN", generation: "GENERATION", tool: "SPAN · TOOL", code: "SPAN · CODE", compaction: "SPAN · COMPACTION" })[type] || type.toUpperCase();
}

function formatNodeDuration(node) {
  if (!node.start) return "-";
  if (!node.end) return "运行中";
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
  renderGraph();
  applyMobilePanel("details");
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
      <dt>开始时间</dt><dd>${new Date(row.time).toLocaleString()}</dd>
      ${execution ? `<dt>耗时</dt><dd>${duration(execution)}</dd><dt>状态</dt><dd>${escapeHtml(statusLabel(status(execution)))}</dd>` : ""}
    </dl>
    ${payloads.length ? `<div class="section-title">原始 Payload</div>${payloads.map((payload) => `<button class="payload-button" data-payload="${escapeHtml(payload)}">${escapeHtml(payload)}</button>`).join("")}<pre id="payload-preview">选择 Payload 查看原始数据</pre>` : ""}
    <div class="section-title">归约对象</div><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  elements.details.querySelectorAll("[data-payload]").forEach((button) => {
    button.addEventListener("click", () => loadPayload(button.dataset.payload));
  });
  elements.detailsPane.classList.add("open");
}

async function selectTraceNode(id, { focus = true } = {}) {
  const node = findTraceNode(state.traceTree, id);
  if (!node) return;
  state.selectedRowId = id;
  renderTimeline();
  renderGraph();
  updateHash(routeForSession(localDay(state.trace.started_at_unix_ms), state.selectedTraceId, id), true);
  if (focus) applyMobilePanel("details");
  const detail = nodeDetails(state.trace, node);
  elements.details.classList.remove("empty");
  elements.details.innerHTML = renderNodeDetail(detail);
  elements.detailsPane.classList.add("open");
  elements.details.querySelectorAll("[data-payload]").forEach((button) => button.addEventListener("click", () => loadNodePayload(button.dataset.payload, button.dataset.label)));
  elements.details.querySelector("[data-copy-payload]")?.addEventListener("click", copyActivePayload);
  elements.details.querySelector("[data-download-payload]")?.addEventListener("click", downloadActivePayload);
  elements.details.querySelectorAll("[data-detail-view]").forEach((button) => button.addEventListener("click", () => {
    const view = button.dataset.detailView;
    elements.details.querySelectorAll("[data-detail-view]").forEach((item) => item.classList.toggle("active", item === button));
    elements.details.querySelectorAll("[data-detail-pane]").forEach((pane) => pane.classList.toggle("hidden", pane.dataset.detailPane !== view));
  }));
}

function clearDetails() {
  elements.details.className = "details-content empty";
  elements.details.textContent = "选择一条记录查看详情";
}

function applyMobilePanel(panel) {
  state.mobileView = panel;
  document.querySelectorAll("[data-mobile-view]").forEach((button) => button.classList.toggle("active", button.dataset.mobileView === panel));
  elements.traceNavigation.classList.toggle("mobile-panel-hidden", panel === "details");
  elements.details.classList.toggle("mobile-panel-hidden", panel !== "details");
}

function renderNodeDetail(detail) {
  const metadata = detail.metadata.filter(([, value]) => value !== null && value !== undefined);
  return `<div class="detail-header">
      <div><span class="detail-kind"><span class="node-type ${escapeHtml(detail.type)}">${nodeIcon(detail)}</span>${escapeHtml(nodeTypeLabel(detail.type))}</span><h2>${escapeHtml(detail.title)}</h2></div>
      <span class="badge ${escapeHtml(detail.status)}">${escapeHtml(statusLabel(detail.status))}</span>
    </div>
    <div class="detail-tabs" role="tablist"><button class="active" data-detail-view="overview">概览</button><button data-detail-view="input">输入</button><button data-detail-view="output">输出</button><button data-detail-view="metadata">元数据</button><button data-detail-view="json">原始 JSON</button></div>
    <div data-detail-pane="overview"><dl class="kv detail-metadata">
      <dt>开始时间</dt><dd>${detail.startedAt ? new Date(detail.startedAt).toLocaleString() : "-"}</dd>
      <dt>耗时</dt><dd>${formatNodeDuration({ start: detail.startedAt, end: detail.endedAt })}</dd>
      <dt>类型</dt><dd>${escapeHtml(nodeTypeLabel(detail.type))}</dd>
    </dl>${detail.payloads.length ? `<section class="io-section"><div class="io-title">原始 Payload</div><div>${detail.payloads.map((payload) => `<button class="payload-button" data-payload="${escapeHtml(payload.id)}" data-label="${escapeHtml(payload.label)}">${escapeHtml(payload.label)}</button>`).join("")}</div><div class="payload-actions"><button data-copy-payload disabled>复制</button><button data-download-payload disabled>下载</button><small id="payload-meta">按需加载 Payload</small></div><pre id="node-payload-preview">选择 Payload 查看完整原始数据</pre></section>` : ""}</div>
    <div class="detail-pane hidden" data-detail-pane="input">${ioSection("输入", detail.input)}</div>
    <div class="detail-pane hidden" data-detail-pane="output">${ioSection("输出", detail.output)}</div>
    <div class="detail-pane hidden" data-detail-pane="metadata"><dl class="kv detail-metadata">${metadata.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join("") || "<dt>状态</dt><dd>没有额外 Metadata</dd>"}</dl></div>
    <div class="detail-pane hidden" data-detail-pane="json"><pre>${escapeHtml(JSON.stringify(detail.raw, null, 2))}</pre></div>`;
}

function ioSection(title, value) {
  if (value === null || value === undefined || value === "") return `<section class="io-section"><div class="io-title">${title}</div><div class="empty-io">未捕获${title}</div></section>`;
  return `<section class="io-section"><div class="io-title">${title}</div><pre class="io-preview">${escapeHtml(formatPreview(value))}</pre></section>`;
}

function formatPreview(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

async function loadNodePayload(payloadId, label) {
  const preview = document.querySelector("#node-payload-preview");
  const meta = document.querySelector("#payload-meta");
  preview.textContent = `正在加载 ${label}…`;
  state.activePayload = null;
  document.querySelector("[data-copy-payload]")?.setAttribute("disabled", "true");
  document.querySelector("[data-download-payload]")?.setAttribute("disabled", "true");
  try {
    const payload = await api(`/api/traces/${encodeURIComponent(state.selectedTraceId)}/payloads/${encodeURIComponent(payloadId)}`);
    state.activePayload = { id: payloadId, label, value: payload };
    preview.textContent = formatPreview(payload);
    if (meta) meta.textContent = `${label} · ${new Blob([JSON.stringify(payload)]).size.toLocaleString()} bytes`;
    document.querySelector("[data-copy-payload]")?.removeAttribute("disabled");
    document.querySelector("[data-download-payload]")?.removeAttribute("disabled");
  } catch (error) {
    preview.textContent = error.message;
    if (meta) meta.textContent = "加载失败，可重新点击 Payload 重试";
  }
}

async function copyActivePayload() {
  if (!state.activePayload) return;
  const meta = document.querySelector("#payload-meta");
  try {
    await navigator.clipboard.writeText(JSON.stringify(state.activePayload.value, null, 2));
    if (meta) meta.textContent = "已复制到剪贴板";
  } catch (error) {
    if (meta) meta.textContent = `复制失败：${error.message || "浏览器未授权"}`;
  }
}

function downloadActivePayload() {
  if (!state.activePayload) return;
  const blob = new Blob([JSON.stringify(state.activePayload.value, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${state.activePayload.label.toLowerCase()}-${state.activePayload.id}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function loadPayload(payloadId) {
  const preview = document.querySelector("#payload-preview");
  preview.textContent = "正在加载…";
  try {
    const payload = await api(`/api/traces/${encodeURIComponent(state.selectedTraceId)}/payloads/${encodeURIComponent(payloadId)}`);
    preview.textContent = JSON.stringify(payload, null, 2);
  } catch (error) {
    preview.textContent = error.message;
  }
}

function traceMeta(id) {
  return state.traces.find((trace) => trace.id === id);
}

function showTraceWorkspace(id) {
  const meta = traceMeta(id);
  const day = meta ? localDay(meta.startedAtUnixMs) : state.selectedDay;
  state.route = "trace";
  updateHash(routeForSession(day, id, state.selectedRowId || ""));
  elements.dayBrowser.classList.add("hidden");
  elements.sessionBrowser.classList.add("hidden");
  elements.traceWorkspace.classList.remove("hidden");
  elements.reviewsWorkspace.classList.add("hidden");
  elements.breadcrumbDay.textContent = day || "日期";
  elements.breadcrumbDay.classList.remove("hidden");
  elements.breadcrumbSessionSeparator.classList.remove("hidden");
  elements.activeSessionName.textContent = meta?.rolloutId || id;
  elements.activeSessionName.classList.remove("hidden");
}

function renderReductionRequired(error) {
  elements.timeline.innerHTML = `<div class="reduction-card" role="alert"><span class="state-icon">⌁</span><h2>这次会话还没有归约状态</h2><p>Raw trace 仍在本地目录中。归约会读取已有事件并生成可浏览的树、时间线和详情，不会上传数据。</p><div class="reduction-error">${escapeHtml(error?.message || "需要归约")}</div><button id="reduce-trace" class="primary-action">开始归约</button></div>`;
  elements.graph.innerHTML = '<div class="empty">归约完成后生成关系图</div>';
  elements.details.classList.remove("empty");
  elements.details.innerHTML = `<div class="empty-detail"><span class="state-icon">⌁</span><h2>等待归约</h2><p>完成后可查看完整 Trace。</p></div>`;
  document.querySelector("#reduce-trace")?.addEventListener("click", () => reduceTrace(state.selectedTraceId));
}

async function reduceTrace(id) {
  const button = document.querySelector("#reduce-trace");
  if (button) { button.disabled = true; button.textContent = "准备归约…"; }
  elements.captureStatus.textContent = "正在归约 Trace…";
  try {
    const trace = await api(`/api/traces/${encodeURIComponent(id)}?reduce=1`);
    installTrace(id, trace);
    elements.captureStatus.textContent = "采集正常";
  } catch (error) {
    renderReductionRequired(error);
    elements.captureStatus.textContent = "归约失败";
  } finally {
    if (button) { button.disabled = false; button.textContent = "重试归约"; }
  }
}

function installTrace(id, trace, nodeId = "") {
  state.selectedTraceId = id;
  state.trace = trace;
  state.traceTree = buildTraceTree(trace);
  state.collapsedNodes = new Set();
  state.selectedRowId = nodeId && findTraceNode(state.traceTree, nodeId) ? nodeId : state.traceTree.id;
  showTraceWorkspace(id);
  applyMobilePanel("tree");
  renderSummary();
  renderTimeline();
  renderGraph();
  selectTraceNode(state.selectedRowId, { focus: false });
}

async function loadTrace(id, options = {}) {
  state.selectedTraceId = id;
  state.selectedRowId = null;
  renderSessions();
  showTraceWorkspace(id);
  elements.timeline.innerHTML = '<div class="loading-state" aria-live="polite"><span class="spinner"></span>正在读取 Trace…</div>';
  try {
    const trace = await api(`/api/traces/${encodeURIComponent(id)}`);
    installTrace(id, trace, options.nodeId || "");
  } catch (error) {
    if (error.status === 409) renderReductionRequired(error);
    else elements.timeline.innerHTML = `<div class="error" role="alert"><strong>读取 Trace 失败</strong><p>${escapeHtml(error.message)}</p><button class="retry-button" id="retry-trace">重试</button></div>`;
    document.querySelector("#retry-trace")?.addEventListener("click", () => loadTrace(id, options));
  }
}

async function refresh({ initial = false } = {}) {
  if (state.refreshInFlight) return;
  state.refreshInFlight = true;
  elements.refresh.disabled = true;
  elements.captureStatus.textContent = "正在刷新…";
  try {
    const [config, result] = await Promise.all([api("/api/config"), api("/api/traces")]);
    state.config = config;
    state.traces = result.traces;
    state.lastRefreshAt = Date.now();
    elements.lastRefresh.textContent = `更新于 ${new Date(state.lastRefreshAt).toLocaleTimeString([], { hour12: false })}`;
    elements.captureStatus.textContent = config.traceCaptureEnabled ? "采集正常" : "未检测到采集环境变量";
    if (state.route === "sessions" && state.selectedDay) renderSessions();
    else if (state.route === "trace" && state.selectedTraceId) await refreshCurrentTrace();
    else if (state.route === "reviews") await loadReviews();
    else renderDays();
    if (initial) syncRouteFromHash();
  } catch (error) {
    elements.captureStatus.textContent = "刷新失败";
    const target = state.route === "sessions" ? elements.sessions : state.route === "days" ? elements.days : elements.timeline;
    target.innerHTML = `<div class="error" role="alert"><strong>刷新失败</strong><p>${escapeHtml(error.message)}</p><button class="retry-button" id="retry-refresh">重试</button></div>`;
    document.querySelector("#retry-refresh")?.addEventListener("click", () => refresh());
  } finally {
    state.refreshInFlight = false;
    elements.refresh.disabled = false;
  }
}

async function refreshCurrentTrace() {
  const selectedId = state.selectedRowId;
  try {
    const trace = await api(`/api/traces/${encodeURIComponent(state.selectedTraceId)}`);
    state.trace = trace;
    state.traceTree = buildTraceTree(trace);
    state.selectedRowId = selectedId && findTraceNode(state.traceTree, selectedId) ? selectedId : state.traceTree.id;
    renderSummary();
    renderTimeline();
    renderGraph();
    selectTraceNode(state.selectedRowId, { focus: false });
  } catch (error) {
    if (error.status === 409) renderReductionRequired(error);
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
      <span class="session-meta"><span>${review.summary.sessions} 个会话</span><span>${review.summary.modelCalls} 次模型调用</span></span>
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
  const previous = state.reviews.find((item) => item.date < review.date);
  const cacheRate = summary.inputTokens ? summary.cachedInputTokens / summary.inputTokens * 100 : 0;
  const completionRate = summary.sessions ? summary.completedSessions / summary.sessions * 100 : 0;
  const delta = previous ? summary.sessions - previous.summary.sessions : null;
  const scenarios = rankedEntries(review.scenarioUsage, 1);
  const topScenario = scenarios[0];
  const topTool = rankedEntries(review.toolUsage || review.toolKinds, 1)[0];
  const inactiveCount = (review.cleanupRecommendations || []).length;
  const statGrid = `
    <div class="stat-grid">
      ${statCard("会话", summary.sessions)}${statCard("运行时回合", summary.runtimeTurns)}${statCard("模型调用", summary.modelCalls)}
      ${statCard("工具调用", summary.toolCalls)}${statCard("输入 Token", summary.inputTokens.toLocaleString())}${statCard("输出 Token", summary.outputTokens.toLocaleString())}
      ${statCard("推理 Token", summary.reasoningTokens.toLocaleString())}${statCard("用户消息", summary.userMessages)}${statCard("缓存输入", summary.cachedInputTokens.toLocaleString())}
    </div>`;
  elements.reviewHeader.classList.remove("empty");
  elements.reviewHeader.innerHTML = `<h1>${review.date} 使用复盘</h1><div class="metrics"><span class="review-generated">生成于 <strong>${new Date(review.generatedAtUnixMs).toLocaleString()}</strong></span><span>完成率 <strong>${completionRate.toFixed(0)}%</strong></span><span>活跃时间 <strong>${formatDuration(summary.activeMs)}</strong></span><span>缓存命中 <strong>${cacheRate.toFixed(1)}%</strong></span>${topScenario ? `<span>主场景 <strong>${escapeHtml(topScenario[0])}</strong></span>` : ""}${topTool ? `<span>高频工具 <strong>${escapeHtml(topTool[0])}</strong></span>` : ""}${inactiveCount ? `<span>长期未使用 <strong>${inactiveCount} 项</strong></span>` : ""}${delta === null ? "" : `<span>较前一日 <strong>${delta >= 0 ? "+" : ""}${delta} 个会话</strong></span>`}</div>`;
  elements.reviewContent.innerHTML = `
    ${reviewSection("使用习惯", `<ul class="habit-list">${(review.habits || []).map((habit) => `<li>${escapeHtml(habit)}</li>`).join("") || "<li>数据不足</li>"}</ul>`)}
    ${reviewSection("使用场景", scenarioCards(review.scenarioUsage))}
    <div class="review-columns">
      ${reviewSection("高频工具", usageBars(review.toolUsage || review.toolKinds, 12, "tool"))}
      ${reviewSection("Skill 使用", usageBars(review.skillUsage, 12, "skill"))}
      ${reviewSection("MCP 使用", usageBars(review.mcpUsage, 12, "mcp"))}
    </div>
    ${reviewSection("基础统计", statGrid)}
    <div class="review-columns review-support-grid">
      ${reviewSection("项目", usageBars(review.projects, 12, "project"))}
      ${reviewSection("Provider / 模型", usageBars({ ...(review.providers || {}), ...(review.models || {}) }))}
      ${reviewSection("活跃时段", hourlyBars(review.hourlyStarts))}
    </div>
    ${reviewSection("长期未使用", inactiveUsage(review.cleanupRecommendations))}
  `;
}

function scenarioCards(record) {
  const entries = rankedEntries(record).filter(([, value]) => value && typeof value === "object");
  if (!entries.length) return '<div class="review-empty">暂无足够数据识别使用场景。</div>';
  return `<div class="scenario-grid">${entries.map(([name, value]) => {
    const tools = rankedEntries(value.tools, 3).map(([label, count]) => `${escapeHtml(usageLabel(label, "tool"))} <strong>${count}</strong>`).join("、") || "暂无工具调用";
    const skills = rankedEntries(value.skills, 2).map(([label, count]) => `${escapeHtml(usageLabel(label, "skill"))} <strong>${count}</strong>`).join("、");
    const project = rankedEntries(value.projects, 1)[0]?.[0];
    const example = value.examples?.[0];
    return `<article class="scenario-card"><div class="scenario-card-head"><div><span class="scenario-kicker">使用场景</span><h3>${escapeHtml(name)}</h3></div><strong>${value.sessions} 个会话</strong></div><div class="scenario-metrics"><span>${value.toolCalls} 次工具调用</span><span>${value.modelCalls} 次模型调用</span>${project ? `<span>${escapeHtml(project)}</span>` : ""}</div><p><b>常用工具</b> ${tools}</p>${skills ? `<p><b>相关 Skill</b> ${skills}</p>` : ""}${example ? `<blockquote>${escapeHtml(example)}</blockquote>` : ""}</article>`;
  }).join("")}</div>`;
}

function hourlyBars(valuesByHour) {
  const entries = (valuesByHour || []).map((count, hour) => [`${String(hour).padStart(2, "0")}:00`, count]).filter(([, count]) => count > 0);
  return usageBars(Object.fromEntries(entries));
}

function statCard(label, value) {
  return `<div class="stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function reviewSection(title, body) {
  return `<section class="review-section"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

function usageBars(record, limit = 12, kind = "") {
  const allEntries = Object.entries(record || {}).sort((a, b) => b[1] - a[1]);
  const entries = allEntries.slice(0, limit);
  const max = entries[0]?.[1] || 1;
  return `<div class="usage-bars">${entries.map(([label, count]) => `<div class="usage-bar"><span title="${escapeHtml(label)}">${escapeHtml(usageLabel(label, kind))}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, count / max * 100)}%"></div></div><strong>${count}</strong></div>`).join("") || "暂无记录"}${allEntries.length > limit ? `<small class="usage-more">另有 ${allEntries.length - limit} 项未展开</small>` : ""}</div>`;
}

function usageLabel(value, kind = "") {
  const normalized = String(value).replaceAll("\\", "/");
  if (kind !== "skill") return value;
  const marker = normalized.toLowerCase().lastIndexOf("/skills/");
  return marker >= 0 ? normalized.slice(marker + "/skills/".length) : normalized.split("/").at(-1) || normalized;
}

function inactiveUsage(items) {
  if (!items?.length) return '<div class="review-empty">当前没有达到长期未使用阈值的工具、Skill 或 MCP。</div>';
  const labels = { tool: "工具", skill: "Skill", mcp: "MCP" };
  const groups = ["tool", "skill", "mcp"].map((type) => [type, items.filter((item) => item.type === type)]).filter(([, entries]) => entries.length);
  return `<div class="inactive-grid">${groups.map(([type, entries]) => `<section class="inactive-group"><div class="inactive-group-head"><h3>${labels[type]}</h3><span>${entries.length} 项</span></div><ul>${entries.map((item) => `<li><div><strong title="${escapeHtml(item.id)}">${escapeHtml(usageLabel(item.id, type))}</strong><small>${escapeHtml(item.lastUsed ? `最后使用：${item.lastUsed}` : "历史中未观察到")}</small></div><span>${escapeHtml(item.reason)}</span></li>`).join("")}</ul></section>`).join("")}</div>`;
}

function rankedEntries(record, limit = 12) {
  return Object.entries(record || {}).sort(([, left], [, right]) => {
    const leftCount = typeof left === "object" ? left.sessions || 0 : left;
    const rightCount = typeof right === "object" ? right.sessions || 0 : right;
    return rightCount - leftCount;
  }).slice(0, limit);
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
    elements.settingsForm.elements.inactiveToolDays.value = state.settings.inactiveToolDays;
    elements.settingsForm.elements.inactiveSkillDays.value = state.settings.inactiveSkillDays;
    elements.settingsForm.elements.inactiveMcpDays.value = state.settings.inactiveMcpDays;
    elements.settingsForm.elements.retentionDays.value = state.settings.retentionDays;
    document.querySelector("#data-root").textContent = state.config?.dataRoot || state.settings.dataRoot;
    elements.traceRootSetting.textContent = state.config?.traceRoot || "未配置";
    elements.codexExecutable.textContent = state.config?.codexExecutable || "codex";
    elements.settingsError.textContent = "";
    elements.settingsSaved.textContent = "";
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
    inactiveToolDays: Number(form.inactiveToolDays.value),
    inactiveSkillDays: Number(form.inactiveSkillDays.value),
    inactiveMcpDays: Number(form.inactiveMcpDays.value),
    retentionDays: Number(form.retentionDays.value),
  };
  state.settings = await api("/api/settings", { method: "PUT", body: JSON.stringify(payload) });
  elements.settingsSaved.textContent = "已保存设置";
}

async function runReviewNow() {
  elements.runReview.disabled = true;
  elements.runReview.textContent = "正在归约并生成日报…";
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
    elements.runReview.textContent = "立即生成今日复盘";
  }
}

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === tab));
  state.view = tab.dataset.view;
  renderTimeline();
  if (state.view === "graph") renderGraphInTimeline();
  if (state.selectedRowId && state.view !== "conversation") selectTraceNode(state.selectedRowId);
  else if (!state.selectedRowId) clearDetails();
  applyMobilePanel(state.view === "graph" ? "graph" : state.mobileView);
}));
elements.sessionSearch.addEventListener("input", () => { state.sessionQuery = elements.sessionSearch.value; renderSessions(); });
elements.sessionStatusFilter.addEventListener("change", () => { state.sessionStatus = elements.sessionStatusFilter.value; renderSessions(); });
elements.sessionModelFilter.addEventListener("change", () => { state.sessionModel = elements.sessionModelFilter.value; renderSessions(); });
elements.treeSearch.addEventListener("input", () => { state.treeQuery = elements.treeSearch.value; renderTimeline(); });
elements.expandAll.addEventListener("click", () => { state.collapsedNodes.clear(); renderTimeline(); });
elements.mobileTabs.querySelectorAll("[data-mobile-view]").forEach((button) => button.addEventListener("click", () => {
  const view = button.dataset.mobileView;
  if (["tree", "timeline", "graph"].includes(view)) {
    state.view = view;
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
    renderTimeline();
  }
  applyMobilePanel(view);
}));
elements.backToDays.addEventListener("click", showDays);
document.querySelector('[data-route="days"]').addEventListener("click", showDays);
elements.breadcrumbDay.addEventListener("click", () => showSessions(state.selectedDay));
elements.refresh.addEventListener("click", () => refresh());
elements.refreshInterval.addEventListener("change", scheduleRefresh);
elements.autoRefresh.addEventListener("change", scheduleRefresh);
elements.graphFit.addEventListener("click", () => { elements.graph.scrollTo({ top: 0, left: 0, behavior: "smooth" }); elements.graph.classList.add("fit-flash"); setTimeout(() => elements.graph.classList.remove("fit-flash"), 500); });
document.querySelectorAll(".mode").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
elements.settingsButton.addEventListener("click", openSettings);
elements.settingsDialog.addEventListener("close", () => {
  if (document.querySelector('.mode.active')?.dataset.mode === "settings") syncRouteFromHash();
});
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
window.addEventListener("popstate", syncRouteFromHash);
window.addEventListener("hashchange", syncRouteFromHash);
document.addEventListener("pointerdown", () => { state.isInteracting = true; clearTimeout(state.interactionTimer); state.interactionTimer = setTimeout(() => { state.isInteracting = false; }, 1200); });
document.addEventListener("keydown", () => { state.isInteracting = true; clearTimeout(state.interactionTimer); state.interactionTimer = setTimeout(() => { state.isInteracting = false; }, 1200); });
function scheduleRefresh() {
  clearInterval(state.refreshTimer);
  const interval = Number(elements.refreshInterval.value);
  if (elements.autoRefresh.checked && interval > 0) state.refreshTimer = setInterval(() => { if (!state.isInteracting && !document.querySelector("dialog[open]")) refresh(); }, interval);
}
scheduleRefresh();
refresh({ initial: true });
