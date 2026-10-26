import assert from "node:assert/strict";
import { test } from "node:test";
import { getDraft, updateDraft } from "../src/client/drafts.js";
import { optimisticStart, optimisticState, pendingMessages, pendingMessageStatus, reconcileOptimistic } from "../src/client/chat/optimistic.js";
import { rejectSubmission, restoreFailedSubmission, submissionError } from "../src/client/chat/submission-feedback.js";

test("confirmed failure can be recovered once with newer typing, attachments and skills intact", () => {
  const scope = { workspaceId: "workspace", sessionId: crypto.randomUUID() };
  const sent = { id: "img1", kind: "image" as const, name: "sent.png", path: "/sent.png", text: "" };
  const next = { ...sent, name: "next.png", path: "/next.png" };
  const skill = { id: "a".repeat(64), name: "skill", description: "恢复技能引用" };
  optimisticStart(scope, "failed", { text: "修复 [img1]", attachment: null, attachments: [sent], skills: [skill] }, true);
  rejectSubmission(scope, "failed", "CAPABILITY_UNAVAILABLE");
  updateDraft(scope, { text: "新草稿 [img1]", attachments: [next] });
  assert.equal(restoreFailedSubmission(scope, "failed"), true);
  assert.equal(getDraft(scope).text, "修复 [img2]\n\n新草稿 [img1]");
  assert.deepEqual(getDraft(scope).attachments, [next, { ...sent, id: "img2" }]);
  assert.deepEqual(getDraft(scope).skills, [skill]);
  assert.equal(pendingMessages(scope).length, 0);
  assert.equal(restoreFailedSubmission(scope, "failed"), false);
  rejectSubmission(scope, "failed", "late receipt");
  assert.equal(pendingMessages(scope).length, 0);
});

test("recovery keeps both drafts intact when their combined contents cannot be persisted", () => {
  const attachment = (index: number) => ({ id: `file${index}`, kind: "file" as const, name: `${index}.txt`, path: `/files/${index}.txt`, text: "" });
  const image = (index: number) => ({ id: `img${index}`, name: `${index}.png`, mimeType: "image/png", data: "iVBORw0KGgo=" });
  for (const [current, failed] of [
    [{ text: "current", attachment: null, attachments: Array.from({ length: 50 }, (_, i) => attachment(i + 1)) },
      { text: "failed", attachment: null, attachments: [attachment(51)] }],
    [{ text: "current", attachment: null, images: [1, 2, 3, 4].map(image) },
      { text: "failed", attachment: null, images: [image(5)] }],
    [{ text: "a".repeat(200_000), attachment: null }, { text: "failed", attachment: null }],
  ]) {
    const scope = { workspaceId: "workspace", sessionId: crypto.randomUUID() };
    updateDraft(scope, current);
    const before = getDraft(scope);
    optimisticStart(scope, "failed", failed);
    rejectSubmission(scope, "failed", "unavailable");
    assert.equal(restoreFailedSubmission(scope, "failed"), false);
    assert.deepEqual(getDraft(scope), before);
    assert.equal(pendingMessages(scope).length, 1);
    assert.match(submissionError(scope), /先处理当前草稿.*原消息已保留/);
    updateDraft(scope, { text: "", attachment: null, attachments: [], images: [] });
    assert.equal(restoreFailedSubmission(scope, "failed"), true);
    assert.equal(getDraft(scope).text, "failed");
  }
});

test("sending, accepted and uncertain messages cannot be recovered for replay", () => {
  const scope = { workspaceId: "workspace", sessionId: crypto.randomUUID() };
  for (const state of ["sending", "accepted", "uncertain"] as const) {
    optimisticStart(scope, state, { text: state, attachment: null });
    optimisticState(scope, state, state);
    assert.equal(restoreFailedSubmission(scope, state), false);
  }
  assert.equal(getDraft(scope).text, "");
  assert.equal(pendingMessages(scope).length, 3);
});

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
