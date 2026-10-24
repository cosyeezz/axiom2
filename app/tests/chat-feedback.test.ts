import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { chatMessage, transcriptMessages } from "../src/server/transcript.js";
import { thinkingDisplay } from "../src/server/thinking-display.js";
import { optimisticStart, optimisticState, pendingMessages, reconcileOptimistic, clearOptimistic } from "../src/client/chat/optimistic.js";

test("internal task notifications stay native but never project into live or historical UI", () => {
  const manager = SessionManager.inMemory();
  const payloads: string[] = [];
  for (const status of ["completed", "cancelled", "failed", "interrupted", "future-state"]) {
    for (const identity of [{}, { notice: "内部子代理结果通知，并非用户输入或新的任务请求" }]) {
      const content = JSON.stringify({ ...identity, taskId: "private-task", runId: "private-run", resultId: status, status });
      const native = { role: "custom", customType: "axiom-result", display: true, content };
      const original = structuredClone(native);
      assert.equal(chatMessage(native, status), null);
      assert.deepEqual(native, original);
      assert.equal(chatMessage({ role: "user", content }, "user")!.text, content);
      manager.appendCustomMessageEntry("axiom-result", content, true);
      payloads.push(content);
    }
  }
  assert.deepEqual(transcriptMessages(manager), []);
  assert.deepEqual(transcriptMessages(manager, true), []);
  assert.deepEqual(manager.getEntries().filter(e => e.type === "custom_message").map(e => e.content), payloads);
  for (const content of ["not JSON", "null", '{"status":"__proto__"}'])
    assert.equal(chatMessage({ role: "custom", customType: "axiom-result", display: true, content }, "bad"), null);
  assert.equal(chatMessage({ role: "custom", customType: "extension-notice", display: true, content: "ordinary notice" }, "other")!.text, "ordinary notice");
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
