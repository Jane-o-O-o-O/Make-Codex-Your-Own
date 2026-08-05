import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildTraceTree,
  findTraceNode,
  flattenTree,
  nodeDetails,
} from "./public/trace-detail.js";

const trace = JSON.parse(
  await readFile(new URL("./fixtures/sample/state.json", import.meta.url), "utf8"),
);

test("builds a trace, turn, generation, and tool hierarchy", () => {
  const root = buildTraceTree(trace);

  assert.equal(root.id, "trace:trace-sample");
  assert.equal(root.children[0].id, "turn:turn-1");
  assert.equal(root.children[0].children[0].id, "generation:inference-1");
  assert.equal(root.children[0].children[0].children[0].id, "tool:tool-1");
});

test("generation details expose usage and raw payload references", () => {
  const root = buildTraceTree(trace);
  const generation = findTraceNode(root, "generation:inference-1");
  const details = nodeDetails(trace, generation);

  assert.deepEqual(details.payloads, [
    { label: "Request", id: "payload-request" },
    { label: "Response", id: "payload-response" },
  ]);
  assert.ok(details.metadata.some(([label, value]) => label === "Input tokens" && value === 1420));
  assert.equal(details.input[0].content, "检查项目并总结关键风险");
  assert.equal(details.output[0].content, "已完成检查，发现两个需要优先处理的问题。");
});

test("turn details separate user input from generated output", () => {
  const root = buildTraceTree(trace);
  const turn = findTraceNode(root, "turn:turn-1");
  const details = nodeDetails(trace, turn);

  assert.equal(details.input[0].role, "user");
  assert.equal(details.output[0].role, "assistant");
});

test("flattening omits descendants of collapsed nodes", () => {
  const root = buildTraceTree(trace);
  const rows = flattenTree(root, new Set(["turn:turn-1"]));

  assert.deepEqual(rows.map(({ node }) => node.id), ["trace:trace-sample", "turn:turn-1"]);
});
