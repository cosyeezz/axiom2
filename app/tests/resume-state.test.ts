import assert from "node:assert/strict";
import { test } from "node:test";
import { beginResume, clearResume, finishResume, pendingResume, resumeAttempt } from "../src/client/chat/resume-state.js";

test("retry stays hidden across receipt/snapshot ordering and rejects duplicate admission", () => {
  const scope = { workspaceId: "w", sessionId: "retry-order" };
  assert.equal(beginResume(scope, "request-1", "failed-run"), true);
  assert.equal(pendingResume(scope), true);
  assert.equal(beginResume(scope, "duplicate", "failed-run"), false);
  finishResume(scope, "request-1", true);
  assert.equal(pendingResume(scope), false);
  assert.equal(resumeAttempt(scope)?.expectedRunId, "failed-run", "late old snapshot stays suppressed after successful receipt");
  assert.equal(beginResume(scope, "duplicate-after-receipt", "failed-run"), false);
  finishResume(scope, "request-1", false);
  assert.equal(resumeAttempt(scope)?.accepted, true, "late reconciliation cannot undo confirmed acceptance");
  assert.equal(beginResume(scope, "request-2", "new-failed-run"), true);
  finishResume(scope, "request-1", true);
  assert.equal(resumeAttempt(scope)?.requestId, "request-2", "old receipt cannot settle a new attempt");
  assert.equal(pendingResume(scope), true);
  finishResume(scope, "request-2", false);
  assert.equal(resumeAttempt(scope), undefined, "definite rejection restores the action");
  clearResume(scope);
});

test("a newer run supersedes an unknown retry without accepting late receipts", () => {
  const scope = { workspaceId: "w", sessionId: "superseded" };
  beginResume(scope, "unknown-request", "old-run");
  assert.equal(pendingResume(scope, "old-run"), true);
  assert.equal(pendingResume(scope, "new-run"), false);
  assert.equal(beginResume(scope, "new-request", "new-run"), true);
  finishResume(scope, "unknown-request", false);
  assert.equal(resumeAttempt(scope)?.requestId, "new-request");
  assert.equal(pendingResume(scope, "new-run"), true);
  clearResume(scope);
});

test("retry state is isolated by both workspace and session and can be cleared", () => {
  const scope = { workspaceId: "w", sessionId: "isolation" };
  const other = { workspaceId: "other", sessionId: "isolation" };
  const child = { workspaceId: "w", sessionId: "child" };
  beginResume(scope, "parent", "run");
  assert.equal(pendingResume(other), false);
  assert.equal(pendingResume(child), false);
  beginResume(child, "child", "run");
  clearResume(scope);
  finishResume(scope, "parent", true);
  assert.equal(resumeAttempt(scope), undefined, "late receipt cannot resurrect a deleted scope");
  assert.equal(pendingResume(child), true);
  clearResume(child);
});
