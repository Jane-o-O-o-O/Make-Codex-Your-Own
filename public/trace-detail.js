export function buildTraceTree(trace) {
  const root = {
    id: `trace:${trace.trace_id}`,
    type: "trace",
    title: traceTitle(trace),
    start: trace.started_at_unix_ms,
    end: trace.ended_at_unix_ms,
    status: trace.status,
    data: trace,
    children: [],
  };
  const turns = new Map();
  for (const turn of Object.values(trace.codex_turns || {}).sort(byStart)) {
    const node = {
      id: `turn:${turn.codex_turn_id}`,
      type: "turn",
      title: turnTitle(trace, turn),
      start: turn.execution?.started_at_unix_ms,
      end: turn.execution?.ended_at_unix_ms,
      status: turn.execution?.status,
      data: turn,
      children: [],
    };
    turns.set(turn.codex_turn_id, node);
    root.children.push(node);
  }

  const inferenceNodes = new Map();
  const toolsOwnedByInference = new Map();
  for (const call of Object.values(trace.inference_calls || {}).sort(byStart)) {
    const node = {
      id: `generation:${call.inference_call_id}`,
      type: "generation",
      title: call.model || "Model call",
      start: call.execution?.started_at_unix_ms,
      end: call.execution?.ended_at_unix_ms,
      status: call.execution?.status,
      data: call,
      children: [],
    };
    inferenceNodes.set(call.inference_call_id, node);
    for (const toolId of call.tool_call_ids_started_by_response || []) toolsOwnedByInference.set(toolId, node);
    (turns.get(call.codex_turn_id) || root).children.push(node);
  }

  const codeCells = new Map();
  const toolsOwnedByCell = new Map();
  for (const cell of Object.values(trace.code_cells || {}).sort(byStart)) {
    const node = {
      id: `code:${cell.code_cell_id}`,
      type: "code",
      title: "Code cell",
      start: cell.execution?.started_at_unix_ms,
      end: cell.execution?.ended_at_unix_ms,
      status: cell.execution?.status,
      data: cell,
      children: [],
    };
    codeCells.set(cell.code_cell_id, node);
    for (const toolId of cell.nested_tool_call_ids || []) toolsOwnedByCell.set(toolId, node);
    (turns.get(cell.codex_turn_id) || root).children.push(node);
  }

  for (const tool of Object.values(trace.tool_calls || {}).sort(byStart)) {
    const node = {
      id: `tool:${tool.tool_call_id}`,
      type: "tool",
      title: toolTitle(tool),
      start: tool.execution?.started_at_unix_ms,
      end: tool.execution?.ended_at_unix_ms,
      status: tool.execution?.status,
      data: tool,
      children: [],
    };
    const parent = toolsOwnedByCell.get(tool.tool_call_id)
      || toolsOwnedByInference.get(tool.tool_call_id)
      || (tool.requester?.type === "code_cell" ? codeCells.get(tool.requester.code_cell_id) : null)
      || turns.get(tool.started_by_codex_turn_id)
      || root;
    parent.children.push(node);
  }

  for (const compaction of Object.values(trace.compactions || {})) {
    (turns.get(compaction.codex_turn_id) || root).children.push({
      id: `compaction:${compaction.compaction_id}`,
      type: "compaction",
      title: "Context compaction",
      start: compaction.installed_at_unix_ms,
      end: compaction.installed_at_unix_ms,
      status: "completed",
      data: compaction,
      children: [],
    });
  }
  sortChildren(root);
  return root;
}

export function flattenTree(root, collapsed = new Set(), depth = 0, output = []) {
  output.push({ node: root, depth });
  if (!collapsed.has(root.id)) for (const child of root.children) flattenTree(child, collapsed, depth + 1, output);
  return output;
}

export function findTraceNode(root, id) {
  if (root.id === id) return root;
  for (const child of root.children) {
    const match = findTraceNode(child, id);
    if (match) return match;
  }
  return null;
}

export function nodeDetails(trace, node) {
  const common = {
    id: node.id,
    title: node.title,
    type: node.type,
    status: node.status || "unknown",
    startedAt: node.start,
    endedAt: node.end,
    metadata: [],
    input: null,
    output: null,
    payloads: [],
    raw: node.data,
  };
  if (node.type === "trace") {
    common.input = itemsContent(trace, firstUserItems(trace));
    common.output = itemsContent(trace, finalAssistantItems(trace));
    common.metadata = [
      ["Trace ID", trace.trace_id], ["Rollout ID", trace.rollout_id],
      ["Threads", Object.keys(trace.threads || {}).length], ["Runtime turns", Object.keys(trace.codex_turns || {}).length],
    ];
  } else if (node.type === "turn") {
    common.input = itemsContent(trace, node.data.input_item_ids || []);
    const outputs = Object.values(trace.conversation_items || {})
      .filter((item) => item.codex_turn_id === node.data.codex_turn_id && !node.data.input_item_ids.includes(item.item_id))
      .map((item) => item.item_id);
    common.output = itemsContent(trace, outputs);
    common.metadata = [["Thread", node.data.thread_id], ["Turn ID", node.data.codex_turn_id]];
  } else if (node.type === "generation") {
    const usage = node.data.usage || {};
    common.input = itemsContent(trace, node.data.request_item_ids || []);
    common.output = itemsContent(trace, node.data.response_item_ids || []);
    common.payloads = compactPayloads([
      ["Request", node.data.raw_request_payload_id], ["Response", node.data.raw_response_payload_id],
    ]);
    common.metadata = [
      ["Model", node.data.model], ["Provider", node.data.provider_name], ["Response ID", node.data.response_id],
      ["Input tokens", usage.input_tokens], ["Cached input", usage.cached_input_tokens],
      ["Output tokens", usage.output_tokens], ["Reasoning tokens", usage.reasoning_output_tokens],
    ];
  } else if (node.type === "tool") {
    common.input = toolSummary(node.data, "input");
    common.output = toolSummary(node.data, "output");
    common.payloads = compactPayloads([
      ["Invocation", node.data.raw_invocation_payload_id], ["Result", node.data.raw_result_payload_id],
      ...(node.data.raw_runtime_payload_ids || []).map((id, index) => [`Runtime ${index + 1}`, id]),
    ]);
    common.metadata = [
      ["Tool", toolTitle(node.data)], ["Call ID", node.data.model_visible_call_id],
      ["MCP call", node.data.mcp_call_id], ["Requester", node.data.requester?.type],
    ];
  } else if (node.type === "code") {
    common.input = node.data.source_js;
    common.output = itemsContent(trace, node.data.output_item_ids || []);
    common.metadata = [["Runtime status", node.data.runtime_status], ["Runtime cell", node.data.runtime_cell_id]];
  } else if (node.type === "compaction") {
    common.input = itemsContent(trace, node.data.input_item_ids || []);
    common.output = itemsContent(trace, node.data.replacement_item_ids || []);
  }
  return common;
}

export function itemText(item) {
  return item?.body?.parts?.map((part) => part.text || part.source || part.summary || part.value || part.label || "").filter(Boolean).join("\n") || "";
}

function traceTitle(trace) {
  const first = firstUserItems(trace)[0];
  const text = itemText(trace.conversation_items?.[first]);
  return text ? truncate(text, 72) : trace.rollout_id;
}

function turnTitle(trace, turn) {
  const text = (turn.input_item_ids || []).map((id) => itemText(trace.conversation_items?.[id])).filter(isUserFacingText).join(" ");
  return text ? truncate(text, 72) : "Codex turn";
}

function toolTitle(tool) {
  if (tool.kind?.type === "mcp") return `${tool.kind.server}/${tool.kind.tool}`;
  return tool.summary?.label || tool.kind?.name || tool.kind?.type || "Tool call";
}

function toolSummary(tool, side) {
  if (tool.summary?.type === "generic") return side === "input" ? tool.summary.input_preview : tool.summary.output_preview;
  if (tool.summary?.type === "agent") return side === "input" ? tool.summary.message_preview : tool.summary.target_agent_path;
  return null;
}

function firstUserItems(trace) {
  const users = Object.values(trace.conversation_items || {}).filter((item) => item.role === "user").sort((a, b) => a.first_seen_at_unix_ms - b.first_seen_at_unix_ms);
  const preferred = users.find((item) => isUserFacingText(itemText(item)));
  return [preferred || users[0]].filter(Boolean).map((item) => item.item_id);
}

function isUserFacingText(value) {
  return Boolean(value) && !value.startsWith("<environment_context>") && !value.startsWith("<system>") && !value.startsWith("# AGENTS");
}

function finalAssistantItems(trace) {
  const assistants = Object.values(trace.conversation_items || {}).filter((item) => item.role === "assistant" && item.channel === "final").sort((a, b) => b.first_seen_at_unix_ms - a.first_seen_at_unix_ms);
  return assistants.slice(0, 1).map((item) => item.item_id);
}

function itemsContent(trace, ids) {
  const items = ids.map((id) => trace.conversation_items?.[id]).filter(Boolean);
  if (!items.length) return null;
  return items.map((item) => ({ role: item.role, channel: item.channel, kind: item.kind, content: itemText(item) || item.body })).filter((item) => item.content);
}

function compactPayloads(entries) {
  return entries.filter(([, id]) => id).map(([label, id]) => ({ label, id }));
}

function truncate(value, length) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > length ? `${normalized.slice(0, length - 1)}…` : normalized;
}

function byStart(a, b) {
  return (a.execution?.started_at_unix_ms || a.installed_at_unix_ms || 0) - (b.execution?.started_at_unix_ms || b.installed_at_unix_ms || 0);
}

function sortChildren(node) {
  node.children.sort((a, b) => (a.start || 0) - (b.start || 0));
  for (const child of node.children) sortChildren(child);
}
