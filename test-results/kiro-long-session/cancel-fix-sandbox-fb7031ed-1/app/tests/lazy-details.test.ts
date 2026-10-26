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

test("message details return the exact full field in one response", () => {
  const message: ChatMessage = { id: "m", role: "toolResult", text: "x".repeat(15999) + "😀" + "中".repeat(20000) };
  const part = messagePart(message, { id: message.id, field: "text" });
  assert.equal(part.text, message.text, "no 16,000-unit page split");
  assert.equal(part.totalLength, message.text.length);
  assert.notEqual(messagePart({ ...message, text: message.text + "!" }, { field: "text" }).revision, part.revision);
  for (const key of ["offset", "revision", "limit"])
    assert.throws(() => messagePart(message, { field: "text", [key]: 0 }), (error: any) => error.code === "INVALID_INPUT", `${key} is not a paging parameter`);
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
