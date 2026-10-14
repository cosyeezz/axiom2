import assert from "node:assert/strict";
import { test } from "node:test";
import { getDraft, updateDraft } from "../src/client/drafts.js";
import { optimisticStart, pendingMessages, reconcileOptimistic } from "../src/client/chat/optimistic.js";
import { messageLengthError } from "../src/client/chat/message-limit.js";
import { rejectSubmission, submissionError } from "../src/client/chat/submission-feedback.js";

test("confirmed rejection restores once to its originating draft, merging concurrent typing and attachment references", () => {
  const scope = { workspaceId: "workspace", sessionId: crypto.randomUUID() };
  const other = { ...scope, sessionId: crypto.randomUUID() };
  const sent = { id: "imag1", kind: "image" as const, name: "sent.png", path: "C:/sent.png", text: "" };
  const next = { ...sent, name: "next.png", path: "C:/next.png" };
  optimisticStart(scope, "request", { text: "sent [imag1]", attachment: null, attachments: [sent] }, true);
  updateDraft(scope, { text: "next [imag1]", attachments: [next] });
  updateDraft(other, { text: "other session" });
  rejectSubmission(scope, "request", "MODEL_UNAVAILABLE");
  assert.equal(pendingMessages(scope).length, 0);
  const draft = getDraft(scope);
  assert.equal(draft.text, "sent [imag2]\n\nnext [imag1]");
  assert.deepEqual(draft.attachments, [next, { ...sent, id: "imag2" }]);
  assert.match(submissionError(scope), /MODEL_UNAVAILABLE.*内容已保留在输入框/);
  assert.equal(getDraft(other).text, "other session");
  assert.equal(submissionError(other), "");
  rejectSubmission(scope, "request", "late duplicate rejection");
  assert.deepEqual(getDraft(scope), draft, "late receipt/query cannot restore twice");
});

test("failed annotation recovery preserves literal references and full text when merging exceeds the sending limit", () => {
  const scope = { workspaceId: "workspace", sessionId: crypto.randomUUID() };
  const original = "> 原文引用 [file1]\n我的意见：" + "意见".repeat(3500);
  const current = "继续输入 [file1] " + "草稿".repeat(3500);
  optimisticStart(scope, "annotation-request", { text: original, attachment: null });
  const attachment = { id: "file1", name: "current.ts", kind: "file" as const, path: "C:/current.ts", text: "" };
  updateDraft(scope, { text: current, attachments: [attachment] });
  rejectSubmission(scope, "annotation-request", "发送失败");
  assert.equal(getDraft(scope).text, `${original}\n\n${current}`);
  assert.deepEqual(getDraft(scope).attachments, [attachment]);
  assert.match(messageLengthError(getDraft(scope).text), /超过 12,000 字上限.*完整保留/);
  assert.equal(pendingMessages(scope).length, 0);
  rejectSubmission(scope, "annotation-request", "迟到的重复失败");
  assert.equal(getDraft(scope).text, `${original}\n\n${current}`);
});
test("a consumed message is never restored by a late failure", () => {
  const scope = { workspaceId: "workspace", sessionId: crypto.randomUUID() };
  optimisticStart(scope, "request", { text: "already delivered", attachment: null });
  reconcileOptimistic(scope, [{ id: "native", role: "user", text: "already delivered", inputIds: ["request"] }]);
  rejectSubmission(scope, "request", "late failure");
  assert.equal(getDraft(scope).text, "");
  assert.equal(submissionError(scope), "");
});
