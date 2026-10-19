import assert from "node:assert/strict";
import test from "node:test";
import { boundedMessage } from "../src/server/transcript.js";
import { messagePart } from "../src/server/message-part.js";
import { toolPreview, toolSummary } from "../src/shared/tool-summary.js";
import type { ChatMessage } from "../src/shared/agent.js";

test("collapsed tool snapshots keep exact summaries without transferring hidden bodies", () => {
  const message: ChatMessage = { id: "a", role: "assistant", text: "visible reply", thinking: "thought ".repeat(10000),
    calls: [{ id: "write", name: "write", input: JSON.stringify({ path: "src/a.ts", content: "line\n".repeat(40000) }) }] };
  const preview = boundedMessage(message);
  assert.equal(preview.text, message.text);
  assert.deepEqual(toolSummary(preview.calls![0]), toolSummary(message.calls![0]));
  assert.equal(preview.calls![0].inputLength, message.calls![0].input.length);
  assert.ok(JSON.stringify(preview).length < 2000);
  assert.equal(preview.thinkingLength, message.thinking!.length);
  assert.equal(message.calls![0].input.length > 200000, true, "native input is unchanged");
  const changed = structuredClone(message); changed.thinking = message.thinking!.slice(0, -1) + "X";
  assert.notEqual(boundedMessage(changed).detailsRevision, preview.detailsRevision, "same-length hidden changes invalidate detail reads");
  const replyDelta = boundedMessage({ ...message, text: "new streamed reply" });
  assert.equal(replyDelta.thinkingRevision, preview.thinkingRevision, "reply deltas do not invalidate thinking pages");
  assert.equal(replyDelta.calls![0].inputRevision, preview.calls![0].inputRevision, "reply deltas do not invalidate tool input pages");
});

test("compact results preserve failures occurring after the preview", () => {
  const result: ChatMessage = { id: "tool-a", role: "toolResult", text: "log\n".repeat(10000) + "Error: missing file", status: "failed" };
  const preview = boundedMessage(result);
  assert.equal(preview.text.length, 320);
  assert.equal(toolPreview(preview), toolPreview(result));
  assert.match(preview.preview!, /missing file/);
});

test("message detail pages reconstruct exact Unicode content and bind revision", () => {
  const message: ChatMessage = { id: "m", role: "toolResult", text: "x".repeat(15999) + "😀" + "中".repeat(20000) };
  let page = messagePart(message, { id: message.id, field: "text" });
  assert.equal(page.text.length, 15999);
  let text = page.text;
  while (page.nextOffset !== null) {
    page = messagePart(message, { id: message.id, field: "text", offset: page.nextOffset, revision: page.revision });
    text += page.text;
  }
  assert.equal(text, message.text);
  assert.throws(() => messagePart({ ...message, text: message.text + "!" }, { field: "text", offset: 1, revision: page.revision }), /已更新/);
  assert.throws(() => messagePart({ ...message, text: "short" }, { field: "text", offset: 16000, revision: page.revision }),
    (error: any) => error.code === "REVISION_CONFLICT", "shortened records report a revision conflict before checking old offsets");
  for (const offset of [-1, 0.5, NaN, 16000, message.text.length + 1])
    assert.throws(() => messagePart(message, { field: "text", offset, revision: page.revision }));
  assert.throws(() => messagePart(message, { field: "text", offset: 1 }));
});

test("input and thinking pages never include unrelated message fields", () => {
  const message: ChatMessage = { id: "m", role: "assistant", text: "reply", thinking: "thought", calls: [
    { id: "a", name: "read", input: "first input" }, { id: "b", name: "write", input: "secret unrelated input" }] };
  assert.equal(messagePart(message, { field: "input", callId: "a" }).text, "first input");
  assert.equal(messagePart(message, { field: "thinking" }).text, "thought");
  assert.throws(() => messagePart(message, { field: "input", callId: "other" }), /不属于/);
  assert.throws(() => messagePart(null, { field: "text" }), /不属于/);
  assert.throws(() => messagePart(message, { field: "text", callId: "a" }));
  assert.throws(() => messagePart(message, { field: "text", path: "/etc/passwd" }));
});
