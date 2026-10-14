import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { chatMessage, transcriptMessages } from "../src/server/transcript.js";
import { thinkingDisplay } from "../src/server/thinking-display.js";
import { optimisticStart, optimisticState, pendingMessages, reconcileOptimistic, clearOptimistic } from "../src/client/chat/optimistic.js";

test("task notices project terminal states without changing native payloads or user JSON", () => {
  const manager = SessionManager.inMemory();
  for (const [status, label] of Object.entries({ completed: "子代理已完成", cancelled: "子代理已取消", failed: "子代理执行失败", interrupted: "子代理执行中断" })) {
    const content = JSON.stringify({ taskId: "private-task", runId: "private-run", resultId: status, status });
    const native = { role: "custom", customType: "axiom-result", display: true, content };
    const original = structuredClone(native);
    const view = chatMessage(native, status)!;
    assert.equal(view.text, label); assert.equal(view.taskNotice, status);
    assert.deepEqual(native, original);
    assert.equal(chatMessage({ role: "user", content }, "user")!.text, content);
    manager.appendCustomMessageEntry("axiom-result", content, true);
  }
  assert.deepEqual(transcriptMessages(manager).map((m) => m.text), ["子代理已完成", "子代理已取消", "子代理执行失败", "子代理执行中断"]);
  assert.ok(JSON.stringify(manager.getEntries()).includes("private-task"));
  for (const content of ["not JSON", "null", '{"status":"__proto__"}', '{"status":"future-state"}'])
    assert.equal(chatMessage({ role: "custom", customType: "axiom-result", display: true, content }, "bad")!.text, "收到子代理状态通知");
});

test("thinking projection handles native, leading tagged, partial and historical blocks", () => {
  assert.deepEqual(thinkingDisplay("<thinking>first</thinking>\n<thinking>second</thinking>\nanswer", false), { text: "answer", thinking: "first\n\nsecond", active: false });
  assert.deepEqual(thinkingDisplay("<thinking>partial</thi", true), { text: "", thinking: "partial", active: true });
  assert.equal(thinkingDisplay("<think", true).active, true);
  assert.equal(thinkingDisplay("<thinking>stopped", false).active, false);
  for (const text of ["```xml\n<thinking>example</thinking>\n```", "Explain <thinking>example</thinking>", "`<thinking>` example"])
    assert.equal(thinkingDisplay(text, true).text, text);
  const native = { role: "assistant", content: [{ type: "thinking", thinking: "native reasoning" }, { type: "text", text: "<thinking>tagged reasoning</thinking>answer" }] };
  const view = chatMessage(native, "id", true)!;
  assert.equal(view.text, "answer"); assert.equal(view.thinking, "native reasoning\n\ntagged reasoning");
  assert.equal(view.thinkingActive, undefined, "text answer ends thinking animation");
  assert.equal(chatMessage({ role: "assistant", content: [{ type: "thinking", thinking: "live" }] }, "id", true)!.thinkingActive, true);
  assert.equal(chatMessage({ role: "assistant", content: [{ type: "thinking", thinking: "done" }] }, "id")!.thinkingActive, undefined);
  assert.equal(chatMessage({ role: "user", content: "<thinking>user text</thinking>" }, "u")!.text, "<thinking>user text</thinking>");
});

test("queued steering stays pending until consumed, even after accepted receipt", () => {
  const scope = { workspaceId: "feedback", sessionId: "queue" };
  try {
    optimisticStart(scope, "request", { text: "steer later", attachment: null }, true);
    optimisticState(scope, "request", "accepted", "input", true);
    assert.equal(pendingMessages(scope)[0].queued, true);
    assert.equal(pendingMessages(scope).filter((m) => !m.queued).length, 0);
    reconcileOptimistic(scope, [{ id: "other", role: "assistant", text: "working" }]);
    assert.equal(pendingMessages(scope).length, 1);
    reconcileOptimistic(scope, [{ id: "input-input", role: "user", text: "steer later", inputIds: ["input"] }]);
    assert.equal(pendingMessages(scope).length, 0);
    optimisticState(scope, "request", "accepted", "input", true);
    assert.equal(pendingMessages(scope).length, 0, "late receipt cannot resurrect consumed input");
  } finally { clearOptimistic(scope); }
});
