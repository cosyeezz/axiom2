import assert from "node:assert/strict";
import { test } from "node:test";
import { processSlices } from "../src/shared/process-layout.js";
import { ordinaryToolStatus } from "../src/shared/tool-summary.js";
import { boundedMessage } from "../src/server/transcript.js";
import type { ChatMessage } from "../src/shared/agent.js";
const m = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, role: "assistant", text: "", ...extra });
const call = (id: string, name = "read") => ({ id, name, input: "{}" });

test("task cards and prose split ordinary process segments in call order", () => {
  const slices = processSlices([
    m("a", { thinking: "first", calls: [call("a1"), call("a2")] }),
    m("b", { text: " \n ", thinking: "second", calls: [call("b1")] }),
    m("c", { thinking: "check", text: "说明", calls: [call("c1"), call("task", "functions.append"), call("c2")] }),
    m("notice", { role: "notice", text: "结果已到达", taskNotice: "completed" }), m("d", { thinking: "next", calls: [call("d1")] }),
  ]);
  assert.deepEqual(slices.map(s => [s.kind, s.kind === "process" ? s.calls.map(c => c.callId) : s.id]), [
    ["process", ["a1", "a2", "b1"]], ["body", "c"], ["process", ["c1"]], ["task", "task"], ["process", ["c2", "d1"]],
  ]);
  assert.equal(slices[0].kind, "process");
  if (slices[0].kind === "process") assert.deepEqual(slices[0].entries.map(e => [e.kind, e.id]), [
    ["thinking", "a"], ["tool", "a1"], ["tool", "a2"], ["thinking", "b"], ["tool", "b1"], ["thinking", "c"],
  ]);
  if (slices[2].kind === "process") assert.deepEqual(slices[2].entries.map(e => [e.kind, e.id]), [["tool", "c1"]]);
  if (slices[4].kind === "process") assert.deepEqual(slices[4].entries.map(e => [e.kind, e.id]), [
    ["tool", "c2"], ["notice", "notice"], ["thinking", "d"], ["tool", "d1"],
  ]);
});
test("standalone task notices share a disclosure without an empty execution header", () => {
  const slices = processSlices([
    m("delegating", { calls: [call("delegate", "delegate")] }),
    m("notice", { role: "notice", text: "结果已到达", taskNotice: "completed" }),
    m("failed", { role: "notice", text: "子代理执行失败", taskNotice: "failed" }),
    m("reading", { calls: [call("result", "read_result"), call("ordinary")] }),
    m("notice2", { role: "notice", text: "另一个结果已到达", taskNotice: "completed" }),
  ]);
  assert.deepEqual(slices.map(s => [s.kind, s.id]), [
    ["task", "delegate"], ["task-notices", "notice"], ["task", "result"], ["process", "tool:ordinary"],
  ]);
  assert.deepEqual(slices[1], { kind: "task-notices", id: "notice", ids: ["notice", "failed"] });
  const last = slices.at(-1)!;
  if (last.kind === "process") assert.deepEqual(last.entries.map(e => e.kind), ["tool", "notice"]);
});
test("final thinking and calls-only slices never duplicate final text or preceding narration", () => {
  const messages = [m("final", { text: "答案", thinking: "检查", calls: [call("excluded")] }), m("calls", { text: "说明", thinking: "已有思考", calls: [call("tool")] })];
  assert.deepEqual(processSlices(messages, ["final"], ["calls"]), [
    { kind: "process", id: "thinking:final", calls: [{ messageId: "calls", callId: "tool" }], entries: [
      { kind: "thinking", id: "final" }, { kind: "tool", id: "tool", call: { messageId: "calls", callId: "tool" } },
    ] },
  ]);
});
test("streaming thoughts and later calls preserve segment identity and chronological details", () => {
  const initial = m("a", { thinking: "a", text: "b", calls: [call("c")] });
  assert.deepEqual(processSlices([initial]), processSlices([{ ...initial, thinking: "abc", text: "def", calls: [{ ...call("c"), input: '{"path":"test"}' }] }]));
  const slices = processSlices([initial, m("next", { thinking: "new thought", calls: [call("d")] })]);
  assert.equal(slices.at(-1)?.id, "tool:c");
  assert.deepEqual(slices.filter(s => s.kind === "process").map(s => s.calls.length), [0, 2]);
  const thinking = m("thinking", { thinking: "first" });
  assert.equal(processSlices([thinking])[0].id, processSlices([thinking, initial])[0].id, "first tool does not replace a thinking-only segment");
});
test("images, ordinary notices and cancelled/error bodies keep segment boundaries", () => {
  const slices = processSlices([m("a", { calls: [call("c")] }), m("error", { error: "error" }), m("b", { calls: [call("d")] }), m("notice", { role: "notice", text: "系统通知" }), m("thought", { thinking: "standalone" })]);
  assert.deepEqual(slices.map(s => [s.kind, s.id]), [["process", "tool:c"], ["body", "error"], ["process", "tool:d"], ["notice", "notice"], ["process", "thinking:thought"]]);
});
test("tool execution requires actual result events, with terminal failure/cancellation retained", () => {
  assert.equal(ordinaryToolStatus(m("a", { streaming: true }), null), "unknown");
  for (const status of ["running", "completed", "failed", "cancelled"] as const)
    assert.equal(ordinaryToolStatus(m("a"), m("r", { role: "toolResult", status })), status);
  assert.equal(ordinaryToolStatus(m("a", { status: "failed" }), null), "failed");
  assert.equal(ordinaryToolStatus(m("a", { status: "cancelled" }), null), "cancelled");
});
test("bounded live messages retain real execution timing metadata", () => {
  const result = boundedMessage(m("tool-a", { role: "toolResult", status: "running", toolStartedAt: 12345, text: "x".repeat(10000) }));
  assert.equal(result.toolStartedAt, 12345);
  assert.equal(result.durationMs, undefined);
});
