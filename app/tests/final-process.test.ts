import assert from "node:assert/strict";
import { test } from "node:test";
import { chatMessage } from "../src/server/transcript.js";
import { threadGroups } from "../src/shared/thread-layout.js";
import type { ChatMessage } from "../src/shared/agent.js";

const text = (phase?: string) => ({ type: "text", text: "输出", textSignature: JSON.stringify({ v: 1, id: "provider-private-id", phase }) });
test("display phase allows only safe native phases and defers unsigned streams", () => {
  for (const phase of ["commentary", "final_answer"] as const) {
    const result = chatMessage({ role: "assistant", content: [text(phase)], stopReason: "stop" }, "m", true)!;
    assert.equal(result.phase, phase);
    assert.ok(!JSON.stringify(result).includes("provider-private-id"));
  }
  assert.equal(chatMessage({ role: "assistant", content: [text("unknown")] }, "m", true)?.phase, undefined);
  for (const stopReason of ["error", "aborted", "length", "toolUse"]) {
    assert.equal(chatMessage({ role: "assistant", content: [text()], stopReason }, "m")?.phase, undefined);
  }
  assert.equal(chatMessage({ role: "assistant", content: [text()], stopReason: "stop" }, "m")?.phase, "final_answer");
  assert.equal(chatMessage({ role: "assistant", content: [text("commentary")], stopReason: "stop" }, "m")?.phase, "commentary");
  assert.equal(chatMessage({ role: "assistant", content: [text("final_answer"), { type: "toolCall", id: "c", name: "read", arguments: {} }], stopReason: "stop" }, "m")?.phase, undefined);
});
test("Responses exposes explicit final phase at text start without leaking signatures", () => {
  const content = [{ type: "text", text: "" }];
  for (const api of ["openai-responses", "openai-codex-responses", "azure-openai-responses"]) {
    assert.equal(chatMessage({ role: "assistant", api, content, stopReason: "pending" }, "m", true)?.phase, undefined);
    assert.equal(chatMessage({ role: "assistant", api, content, stopReason: "stop" }, "m", true)?.phase, "final_answer");
  }
  assert.equal(chatMessage({ role: "assistant", api: "anthropic-messages", content, stopReason: "stop" }, "m", true)?.phase, undefined);
  for (const stopReason of ["error", "aborted", "length"]) {
    assert.equal(chatMessage({ role: "assistant", content: [text("final_answer")], stopReason }, "m")?.phase, undefined);
  }
  assert.equal(chatMessage({ role: "assistant", content: [text("commentary"), text("final_answer")] }, "m", true)?.phase, "final_answer");
});
const m = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, role: "assistant", text: "说明", runId: "run", ...extra });
test("final phase folds narration and process in order, with final thinking inside and answer outside", () => {
  const prior = [m("user", { role: "user" }), m("narration", { phase: "commentary" }), m("tools", { text: "", calls: [{ id: "c", name: "read", input: "{}" }] })];
  const final = m("answer", { thinking: "检查", phase: "final_answer", streaming: true });
  const groups = threadGroups([...prior, final]);
  assert.deepEqual(groups.map(g => [g.ids, g.activity, !!g.folded]), [
    [["user"], false, false], [["narration", "tools", "answer"], true, true], [["answer"], false, false],
  ]);
  assert.deepEqual(groups[1].thinkingOnlyIds, ["answer"]);
  assert.equal(groups[2].hideThinking, true);
  assert.deepEqual(threadGroups([...prior, { ...final, text: "增量", streaming: false }]), groups);
  assert.ok(!threadGroups([...prior, { ...final, phase: undefined }]).some(g => g.folded));
});
test("folding respects user, compaction, model/run changes and prior answers", () => {
  const final = m("answer", { phase: "final_answer" });
  for (const boundary of [m("boundary", { role: "user" }), m("boundary", { role: "notice" }), m("boundary", { compression: { number: 1, title: "压缩", before: 20, after: 10 } }), m("boundary", { phase: "final_answer" })]) {
    const groups = threadGroups([m("before"), boundary, m("after"), final]);
    assert.deepEqual(groups.find(g => g.folded && g.ids.includes("after"))?.ids, ["after"]);
  }
  assert.deepEqual(threadGroups([m("old", { runId: "old" }), m("after"), final]).find(g => g.folded)?.ids, ["after"]);
  const thought = m("old-thought", { text: "", thinking: "旧运行", runId: "old" });
  const notice = m("notice", { role: "notice", text: "子任务已完成", taskNotice: "completed", runId: undefined });
  const current = m("current", { text: "", thinking: "当前运行" });
  assert.deepEqual(threadGroups([thought, notice, current, final]).find(g => g.folded)?.ids, ["current"]);
  assert.deepEqual(threadGroups([notice, thought, current, final]).find(g => g.folded)?.ids, ["current"]);
});
