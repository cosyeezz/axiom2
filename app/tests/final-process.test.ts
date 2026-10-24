import assert from "node:assert/strict";
import { test } from "node:test";
import { chatMessage } from "../src/server/transcript.js";
import { threadGroups } from "../src/shared/thread-layout.js";
import type { ChatMessage } from "../src/shared/agent.js";
import { processSlices } from "../src/shared/process-layout.js";
import { unarchivedGroups } from "../src/shared/history.js";

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
  assert.deepEqual(threadGroups([...prior, { ...final, text: "增量", streaming: false }]),
    groups.map(group => group.activity || group.id !== "answer" ? group : { ...group, delivery: true }));
  assert.ok(!threadGroups([...prior, { ...final, phase: undefined }]).some(g => g.folded));
});
test("archived narration on both sides joins a real outer process without crossing boundaries", () => {
  const before = m("before", { phase: "commentary" }), after = m("after");
  const tools = m("tools", { text: "", calls: [{ id: "c", name: "read", input: "{}" }] });
  const groups = threadGroups([before, tools, after], { archived: true });
  assert.deepEqual(groups.map(g => [g.ids, g.activity, g.folded]), [[["before", "tools", "after"], true, true]]);
  assert.deepEqual(processSlices([before, tools, after]).map(s => s.kind), ["body", "process", "body"], "wrapping must retain original inner hierarchy");
  assert.ok(!threadGroups([before, tools, after]).some(g => g.folded), "live grouping is unchanged");
  assert.deepEqual(threadGroups([before], { archived: true }).map(g => [g.activity, g.folded]), [[true, true]], "explicit archived commentary is process even without a tool");
  assert.deepEqual(threadGroups([after], { archived: true }).map(g => g.activity), [false], "unmarked isolated prose stays outside");
  for (const boundary of [m("boundary", { role: "user" }), m("boundary", { role: "notice" }), m("boundary", { phase: "final_answer" })]) {
    const split = threadGroups([before, tools, boundary, after], { archived: true });
    assert.ok(!split.find(g => g.folded)?.ids.includes("boundary"));
    assert.ok(!split.find(g => g.folded)?.ids.includes("after"));
  }
  const splitRun = threadGroups([before, tools, m("new-run", { runId: "new" })], { archived: true });
  assert.deepEqual(splitRun.find(g => g.folded)?.ids, ["before", "tools"]);
});
test("commentary-only archives fold without borrowing a later delivery or unrelated prose", () => {
  for (const runId of ["run", undefined]) {
    const before = m("before", { phase: "commentary", runId });
    const after = m("after", { phase: "commentary", runId });
    const prose = m("prose", { runId });
    const answer = m("answer", { phase: "final_answer", runId: "other-run" });
    const archived = threadGroups([before, after], { archived: true });
    assert.deepEqual(archived.map(g => [g.ids, g.activity, g.folded]), [[["before", "after"], true, true]]);
    assert.deepEqual(threadGroups([before]).map(g => g.activity), [false], "live commentary stays readable");
    const split = threadGroups([before, prose, after], { archived: true });
    assert.deepEqual(split.map(g => [g.ids, g.activity]), [[["before"], true], [["prose"], false], [["after"], true]]);
    assert.deepEqual(threadGroups([before, answer], { archived: true }).map(g => [g.ids, g.activity]), [[["before"], true], [["answer"], false]]);
    for (const boundary of [m("b", { role: "user" }), m("b", { role: "notice" }), m("b", { phase: "final_answer" })]) {
      const groups = threadGroups([before, boundary, after], { archived: true });
      assert.ok(!groups.some(g => g.ids.includes("before") && g.ids.includes("after")));
      assert.equal(groups.find(g => g.ids.includes("b"))?.activity, false);
    }
  }
  const selectionChange: NonNullable<ChatMessage["selectionChange"]> = { from: { provider: "p", id: "a", thinking: "high" }, to: { provider: "p", id: "b", thinking: "low" } };
  const groups = threadGroups([m("a", { phase: "commentary" }), m("b", { phase: "commentary", selectionChange })], { archived: true });
  assert.equal(groups.length, 2); assert.deepEqual(groups[1].selectionChange, selectionChange);
});
test("retained live suffix rebases identity and removes archived thinking/call masks", () => {
  const groups = [{ id: "calls:old", ids: ["old", "new"], activity: true, callsOnlyIds: ["old"], thinkingOnlyIds: ["old", "new"] }];
  const [live] = unarchivedGroups(groups, new Set(["old"]));
  assert.equal(live.id, "process:new"); assert.deepEqual(live.ids, ["new"]);
  assert.deepEqual(live.callsOnlyIds, []); assert.deepEqual(live.thinkingOnlyIds, ["new"]);
  assert.deepEqual(groups[0].ids, ["old", "new"], "source index is not mutated");
  assert.deepEqual(unarchivedGroups(groups, new Set(["old", "new"])), []);
});
test("folding preserves user, compaction, prose ownership and prior answers while merging adjacent processes", () => {
  const final = m("answer", { phase: "final_answer" });
  for (const boundary of [m("boundary", { role: "user" }), m("boundary", { role: "notice" }), m("boundary", { compression: { number: 1, title: "压缩", before: 20, after: 10 } }), m("boundary", { phase: "final_answer" })]) {
    const groups = threadGroups([m("before"), boundary, m("after"), final]);
    assert.deepEqual(groups.find(g => g.folded && g.ids.includes("after"))?.ids, ["after"]);
  }
  assert.deepEqual(threadGroups([m("old", { runId: "old" }), m("after"), final]).find(g => g.folded)?.ids, ["after"]);
  const thought = m("old-thought", { text: "", thinking: "旧运行", runId: "old" });
  const notice = m("notice", { role: "notice", text: "子任务已完成", taskNotice: "completed", runId: undefined });
  const current = m("current", { text: "", thinking: "当前运行" });
  assert.deepEqual(threadGroups([notice]), []);
  assert.deepEqual(threadGroups([thought, notice, current]), threadGroups([thought, current]));
  assert.deepEqual(threadGroups([thought, notice, current, final]).find(g => g.folded)?.ids, ["old-thought", "current"]);
  assert.deepEqual(threadGroups([notice, thought, current, final]).find(g => g.folded)?.ids, ["old-thought", "current"]);
});
test("adjacent completed, running and final-process cards share one container with ordered parts", () => {
  const old = m("old", { text: "", runId: "old-run", calls: [{ id: "c", name: "read", input: "{}" }], status: "completed" });
  const current = m("current", { text: "", thinking: "当前思考", status: "running", streaming: true });
  const answer = m("answer", { phase: "final_answer", thinking: "最终核对" });
  for (const archived of [false, true]) {
    const [merged] = threadGroups([old, current], { archived });
    assert.deepEqual(merged.ids, ["old", "current"]);
    assert.equal(threadGroups([old, current], { archived }).length, 1);
    assert.equal(merged.id, threadGroups([old], { archived })[0].id, "continuation retains the left identity");
    const groups = threadGroups([old, current, answer], { archived });
    assert.equal(groups.length, 2);
    assert.equal(groups[0].folded, true);
    assert.deepEqual(groups[0].ids, ["old", "current", "answer"]);
    assert.deepEqual(groups[0].thinkingOnlyIds, ["answer"]);
    assert.deepEqual(groups[1].ids, ["answer"]);
    assert.deepEqual(processSlices([old, current, answer], groups[0].thinkingOnlyIds).map(s => s.kind), ["process"]);
  }
});
test("process coalescing retains calls-only masks and all visible hard boundaries", () => {
  const mixed = m("mixed", { runId: "old", text: "独立说明", calls: [{ id: "c", name: "read", input: "{}" }] });
  const current = m("current", { text: "", thinking: "新运行" });
  const groups = threadGroups([mixed, current]);
  assert.deepEqual(groups.map(g => g.ids), [["mixed"], ["mixed", "current"]]);
  assert.deepEqual(groups[1].callsOnlyIds, ["mixed"]);
  assert.ok(!processSlices([mixed, current], [], groups[1].callsOnlyIds).some(s => s.kind === "body"));
  for (const boundary of [m("b", { role: "user" }), m("b", { role: "notice" }), m("b", { phase: "final_answer" }), m("b", { compression: { number: 1, title: "压缩", before: 20, after: 10 } })]) {
    const split = threadGroups([m("a", { text: "", thinking: "旧" }), boundary, current], { archived: true });
    assert.ok(!split.some(g => g.ids.includes("a") && g.ids.includes("current")));
  }
  const selectionChange: NonNullable<ChatMessage["selectionChange"]> = { from: { provider: "p", id: "a", thinking: "high" }, to: { provider: "p", id: "b", thinking: "low" } };
  const changed = threadGroups([m("a", { text: "", thinking: "旧", runId: "old" }), { ...current, selectionChange }]);
  assert.equal(changed.length, 2);
  assert.deepEqual(changed[1].selectionChange, selectionChange);
});
