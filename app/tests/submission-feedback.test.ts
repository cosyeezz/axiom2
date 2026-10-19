import assert from "node:assert/strict";
import { test } from "node:test";
import { getDraft, updateDraft } from "../src/client/drafts.js";
import { optimisticStart, optimisticState, pendingMessages, pendingMessageStatus, reconcileOptimistic } from "../src/client/chat/optimistic.js";
import { rejectSubmission, submissionError } from "../src/client/chat/submission-feedback.js";

test("confirmed rejection stays with the submitted message and never changes current drafts or attachments", () => {
  const scope = { workspaceId: "workspace", sessionId: crypto.randomUUID() };
  const other = { ...scope, sessionId: crypto.randomUUID() };
  const sent = { id: "imag1", kind: "image" as const, name: "sent.png", path: "C:/sent.png", text: "" };
  const next = { ...sent, name: "next.png", path: "C:/next.png" };
  optimisticStart(scope, "request", { text: "sent [imag1]", attachment: null, attachments: [sent] }, true);
  updateDraft(scope, { text: "next [imag1]", attachments: [next] });
  updateDraft(other, { text: "other session" });
  const draft = getDraft(scope);
  rejectSubmission(scope, "request", "MODEL_UNAVAILABLE");
  const pending = pendingMessages(scope);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].state, "failed");
  assert.equal(pending[0].draft.text, "sent [imag1]");
  assert.deepEqual(pending[0].draft.attachments, [sent]);
  assert.match(pendingMessageStatus(pending[0]), /MODEL_UNAVAILABLE.*原消息已保留/);
  assert.deepEqual(getDraft(scope), draft);
  assert.equal(submissionError(scope), "", "failure is attached to its message, not the composer");
  assert.equal(getDraft(other).text, "other session");
  rejectSubmission(scope, "request", "late duplicate rejection");
  assert.deepEqual(pendingMessages(scope), pending);
  assert.deepEqual(getDraft(scope), draft);
});

test("failed annotations keep full original text separate from new typing, without renumbering references", () => {
  const scope = { workspaceId: "workspace", sessionId: crypto.randomUUID() };
  const original = "> 原文引用 [file1]\n我的意见：" + "意见".repeat(3500);
  const current = "继续输入 [file1] " + "草稿".repeat(3500);
  optimisticStart(scope, "annotation-request", { text: original, attachment: null });
  const attachment = { id: "file1", name: "current.ts", kind: "file" as const, path: "C:/current.ts", text: "" };
  updateDraft(scope, { text: current, attachments: [attachment] });
  rejectSubmission(scope, "annotation-request", "发送失败");
  assert.equal(getDraft(scope).text, current);
  assert.deepEqual(getDraft(scope).attachments, [attachment]);
  assert.equal(pendingMessages(scope)[0].draft.text, original);
  rejectSubmission(scope, "annotation-request", "迟到的重复失败");
  assert.equal(pendingMessages(scope).length, 1);
  assert.equal(getDraft(scope).text, current);
});
test("restored failed submission receives its durable failure detail without changing the draft", () => {
  const scope = { workspaceId: "workspace", sessionId: crypto.randomUUID() };
  optimisticStart(scope, "restored", { text: "saved submission", attachment: null });
  optimisticState(scope, "restored", "failed");
  updateDraft(scope, { text: "new typing" });
  rejectSubmission(scope, "restored", "original failure detail");
  assert.match(pendingMessageStatus(pendingMessages(scope)[0]), /original failure detail/);
  assert.equal(getDraft(scope).text, "new typing");
});

test("consumed evidence removes a failed placeholder and late failure cannot recreate it", () => {
  const scope = { workspaceId: "workspace", sessionId: crypto.randomUUID() };
  optimisticStart(scope, "request", { text: "already delivered", attachment: null });
  rejectSubmission(scope, "request", "early failure");
  reconcileOptimistic(scope, [{ id: "native", role: "user", text: "already delivered", inputIds: ["request"] }]);
  rejectSubmission(scope, "request", "late failure");
  assert.equal(pendingMessages(scope).length, 0);
  assert.equal(getDraft(scope).text, "");
  assert.equal(submissionError(scope), "");
});
