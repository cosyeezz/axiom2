import assert from "node:assert/strict";
import { test } from "node:test";
import { processSlices } from "../src/shared/process-layout.js";
import { ordinaryToolStatus } from "../src/shared/tool-summary.js";
import { boundedMessage } from "../src/server/transcript.js";
import { mergeThinkingPreview } from "../src/shared/thinking-preview.js";
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
    ["tool", "c2"], ["thinking", "d"], ["tool", "d1"],
  ]);
});
test("legacy task notifications are ignored, including consecutive and trailing results", () => {
  const slices = processSlices([
    m("delegating", { calls: [call("delegate", "delegate")] }),
    m("notice", { role: "notice", text: "结果已到达", taskNotice: "completed" }),
    m("failed", { role: "notice", text: "子代理执行失败", taskNotice: "failed" }),
    m("reading", { calls: [call("result", "read_result"), call("ordinary")] }),
    m("notice2", { role: "notice", text: "另一个结果已到达", taskNotice: "completed" }),
  ]);
  assert.deepEqual(slices.map(s => [s.kind, s.id]), [
    ["task", "delegate"], ["task", "result"], ["process", "tool:ordinary"],
  ]);
  assert.deepEqual(processSlices([m("only-notice", { role: "notice", taskNotice: "completed" })]), []);
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
test("terminal outcomes join adjacent process details while prose, images and notices remain boundaries", () => {
  const slices = processSlices([m("a", { calls: [call("c")] }), m("error", { error: "error" }), m("b", { calls: [call("d")] }), m("notice", { role: "notice", text: "系统通知" }), m("thought", { thinking: "standalone" })]);
  assert.deepEqual(slices.map(s => [s.kind, s.id]), [["process", "tool:c"], ["notice", "notice"], ["process", "thinking:thought"]]);
  if (slices[0].kind === "process") assert.deepEqual(slices[0].entries.map(e => [e.kind, e.id]), [["tool", "c"], ["outcome", "error"], ["tool", "d"]]);
  for (const status of ["failed", "cancelled"] as const) {
    const [segment] = processSlices([m("a", { thinking: "检查" }), m("outcome", { status }), m("b", { thinking: "恢复", status: "running" })]);
    assert.equal(segment.kind, "process");
    if (segment.kind === "process") assert.deepEqual(segment.entries.map(e => e.kind), ["thinking", "outcome", "thinking"]);
  }
  assert.deepEqual(processSlices([m("e", { error: "错误", text: "保留错误说明" })]).map(s => s.kind), ["body"]);
});
test("tool execution requires actual result events, with terminal failure/cancellation retained", () => {
  assert.equal(ordinaryToolStatus(m("a", { streaming: true }), null), "unknown");
  for (const status of ["running", "completed", "failed", "cancelled"] as const)
    assert.equal(ordinaryToolStatus(m("a"), m("r", { role: "toolResult", status })), status);
  assert.equal(ordinaryToolStatus(m("a", { status: "failed" }), null), "failed");
  assert.equal(ordinaryToolStatus(m("a", { status: "cancelled" }), null), "cancelled");
});
test("live thinking previews carry a bounded advancing tail without changing history prefixes", () => {
  const text = "首行不变\n" + "较早的思考内容。".repeat(300) + "最新进展。";
  const message = m("thought", { thinking: text, thinkingActive: true, streaming: true, status: "running" });
  const bounded = boundedMessage(message);
  assert.equal(bounded.thinking, text.slice(0, 320));
  assert.equal(bounded.thinkingLength, text.length);
  assert.ok(bounded.thinkingTail!.endsWith("最新进展。"));
  assert.ok(bounded.thinkingTail!.length <= 767);
  const next = boundedMessage({ ...message, thinking: text + "继续。" });
  assert.ok(next.thinkingTail!.endsWith("最新进展。继续。"));
  assert.equal(next.thinkingTail!.slice(0, 20), bounded.thinkingTail!.slice(0, 20), "tail starts stay stable between chunk boundaries");
  assert.notEqual(next.thinkingRevision, bounded.thinkingRevision);
  for (const state of [{ streaming: false }, { thinkingActive: false }, { streaming: false, status: "failed" as const }]) {
    assert.equal(boundedMessage({ ...message, ...state }).thinkingTail, undefined);
  }
  const short = boundedMessage({ ...message, thinking: "短思考" });
  assert.equal(short.thinkingTail, undefined, "short thinking reuses the existing prefix");
});
test("thinking tail chunk boundaries preserve the continuous preview buffer", () => {
  const full = "first line\n" + "连续的长段落。".repeat(2000);
  let buffer = { start: 0, text: "" };
  for (const length of [319, 320, 321, 767, 768, 1023, 1024, 8192, 8193, 9000]) {
    const source = full.slice(0, length);
    const message = boundedMessage(m("thought", { thinking: source, thinkingActive: true, streaming: true }));
    const text = message.thinkingTail ?? message.thinking!;
    const next = { start: message.thinkingLength! - text.length, text };
    const previous = buffer;
    buffer = mergeThinkingPreview(buffer, next);
    assert.equal(buffer.text, source.slice(buffer.start));
    if (next.start <= previous.start + previous.text.length) assert.equal(buffer.start, previous.start);
    assert.ok(buffer.text.length <= 8192);
  }
  assert.deepEqual(mergeThinkingPreview(buffer, { start: 0, text: "重写的思考" }), { start: 0, text: "重写的思考" });
  const large = { start: 0, text: "x".repeat(9000) };
  const trimmed = mergeThinkingPreview(large, large);
  assert.equal(trimmed.text.length, 2048);
  assert.equal(trimmed.start, 6952);
  const unicode = "x".repeat(255) + "😀" + "y".repeat(511);
  const tail = boundedMessage(m("unicode", { thinking: unicode, thinkingActive: true, streaming: true })).thinkingTail!;
  assert.equal(tail, "y".repeat(511), "server tails never start inside a surrogate pair");
  const unicodeLarge = { start: 0, text: "x".repeat(6951) + "😀" + "y".repeat(2047) };
  assert.equal(mergeThinkingPreview(unicodeLarge, unicodeLarge).text, "y".repeat(2047));
});
test("bounded live messages retain real execution timing metadata", () => {
  const result = boundedMessage(m("tool-a", { role: "toolResult", status: "running", toolStartedAt: 12345, text: "x".repeat(10000) }));
  assert.equal(result.toolStartedAt, 12345);
  assert.equal(result.durationMs, undefined);
});
