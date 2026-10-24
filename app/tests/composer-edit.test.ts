import assert from "node:assert/strict";
import { test } from "node:test";
import type { Session } from "../src/shared/protocol.js";
import { sessionFamilies } from "../src/client/workspaces/session-order.js";
import { getDraft, updateDraft, restoreDraft } from "../src/client/drafts.js";
import { startComposerEdit, cancelComposerEdit, getComposerDraft, getComposerEdit, updateComposerDraft, beginComposerEditLoad, finishComposerEditLoad, revealComposerEdit, captureComposerDraft } from "../src/client/chat/composer-edit.js";
import { optimisticStart, optimisticState, pendingMessages } from "../src/client/chat/optimistic.js";
import { rejectSubmission, restoreFailedSubmission } from "../src/client/chat/submission-feedback.js";

const session = (id: string, fields: Partial<Session> = {}): Session => ({ id, workspaceId: "w", title: id, pinned: false, unread: false, updatedAt: 1, ...fields });
test("fork families stay contiguous through activity, pins, nested forks, missing parents and cycles", () => {
  const root = session("root", { pinned: true });
  const old = session("old", { forkParentSessionId: "root", updatedAt: 2 });
  const newest = session("new", { forkParentSessionId: "root", updatedAt: 9 });
  const nested = session("nested", { forkParentSessionId: "new", updatedAt: 10, unread: true });
  const other = session("other", { updatedAt: 11 });
  const rows = [old, nested, other, root, newest];
  assert.deepEqual(sessionFamilies(rows).map(f => f.map(s => s.id)), [["root", "new", "nested", "old"], ["other"]]);
  assert.deepEqual(rows.map(s => s.id), ["old", "nested", "other", "root", "new"]);
  assert.equal(newest.pinned, false);
  assert.deepEqual(sessionFamilies([newest, other]).flat().map(s => s.id), ["other", "new"]);
  assert.equal(sessionFamilies([root, { ...newest, workspaceId: "foreign" }]).length, 2);
  const cycle = [session("a", { forkParentSessionId: "b" }), session("b", { forkParentSessionId: "a" }), session("self", { forkParentSessionId: "self" })];
  assert.deepEqual(sessionFamilies(cycle).flat().map(s => s.id).sort(), ["a", "b", "self"]);
});

test("editing preserves normal draft, late persistence hydration, attachments and independent scopes", () => {
  const scope = { workspaceId: "w", sessionId: crypto.randomUUID() };
  const other = { ...scope, sessionId: crypto.randomUUID() };
  const file = { id: "file1", name: "notes.txt", text: "", path: "/notes.txt" };
  const target = { messageId: "message", revision: "revision" };
  updateDraft(scope, { text: "ordinary" });
  startComposerEdit(scope, target, { text: "original [file1]", attachment: null, attachments: [file] });
  updateComposerDraft(scope, { text: "edited [file1]" });
  updateComposerDraft(other, { text: "other session" });
  restoreDraft(scope, { text: "hydrated normal draft", attachment: null });
  assert.equal(getComposerDraft(scope).text, "edited [file1]");
  assert.deepEqual(getComposerDraft(scope).attachments, [file]);
  assert.equal(getDraft(scope).text, "hydrated normal draft");
  assert.equal(getComposerDraft(other).text, "other session");
  cancelComposerEdit(scope);
  assert.equal(getComposerDraft(scope).text, "hydrated normal draft");
});

test("failed rewrite restores its target separately; uncertain submissions cannot be recovered", () => {
  const scope = { workspaceId: "w", sessionId: crypto.randomUUID() };
  const target = { messageId: "message", revision: "revision" };
  updateDraft(scope, { text: "ordinary" });
  optimisticStart(scope, "request", { text: "edit", attachment: null }, false, target);
  optimisticState(scope, "request", "uncertain");
  assert.equal(restoreFailedSubmission(scope, "request"), false);
  rejectSubmission(scope, "request", "conflict");
  assert.equal(restoreFailedSubmission(scope, "request"), true);
  assert.deepEqual(getComposerEdit(scope)?.target, target);
  assert.equal(getComposerDraft(scope).text, "edit");
  assert.equal(getDraft(scope).text, "ordinary");
  assert.equal(pendingMessages(scope).length, 0);
  optimisticStart(scope, "second", { text: "second edit", attachment: null }, false, target);
  rejectSubmission(scope, "second", "rejected");
  assert.equal(restoreFailedSubmission(scope, "second"), false, "another active edit must not be overwritten");
  assert.equal(getComposerDraft(scope).text, "edit");
  cancelComposerEdit(scope);
});

test("late edit loads cannot overwrite a newer selection and revealing preserves typing", () => {
  const scope = { workspaceId: "w", sessionId: crypto.randomUUID() };
  const a = beginComposerEditLoad(scope), b = beginComposerEditLoad(scope);
  finishComposerEditLoad(scope, b, { messageId: "b", revision: "b" }, { text: "B", attachment: null });
  updateComposerDraft(scope, { text: "typed B" });
  finishComposerEditLoad(scope, a, { messageId: "a", revision: "a" }, { text: "A", attachment: null });
  const before = getComposerEdit(scope)!;
  revealComposerEdit(scope);
  assert.equal(getComposerDraft(scope).text, "typed B");
  assert.equal(getComposerEdit(scope)?.target.messageId, "b");
  assert.equal(getComposerEdit(scope)?.token, before.token);
  assert.notEqual(getComposerEdit(scope)?.revision, before.revision);
  cancelComposerEdit(scope);
});

test("uploads finish in their captured slot even after switching to edit mode", () => {
  const scope = { workspaceId: "w", sessionId: crypto.randomUUID() };
  const normal = captureComposerDraft(scope);
  normal.update({ text: "[img1]" });
  startComposerEdit(scope, { messageId: "m", revision: "r" }, { text: "editing", attachment: null });
  const file = { id: "img1", name: "image.png", path: "/image.png", text: "" };
  normal.update({ attachments: [file] });
  assert.equal(getComposerDraft(scope).text, "editing");
  assert.equal(getComposerDraft(scope).attachments?.length, 0);
  const editing = captureComposerDraft(scope);
  cancelComposerEdit(scope);
  editing.update({ text: "late cancelled upload" });
  assert.equal(getComposerDraft(scope).text, "[img1]");
  assert.deepEqual(getComposerDraft(scope).attachments, [file]);
});
