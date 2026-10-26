import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/server/storage.js";
import { sessionState } from "../src/shared/session-state.js";
import { executionOutcome } from "../src/server/execution-outcome.js";
import { chatMessage } from "../src/server/transcript.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

test("activity wins every unread combination, including stopping, retry and remaining children", () => {
  for (const unread of [false, true]) {
    for (const runStatus of ["starting", "running", "stopping"] as const) {
      const value = sessionState({ runStatus, unread, activeTaskCount: 2 });
      assert.equal(value.active, true); assert.equal(value.indicator, "running");
    }
    assert.equal(sessionState({ runStatus: "completed", activeTaskCount: 1, unread }).indicator, "running");
  }
  assert.equal(sessionState({ runStatus: "completed", unread: true }).indicator, "unread");
  assert.equal(sessionState({ runStatus: "failed", reasonCode: "OUTPUT_TRUNCATED" }).label, "输出截断，可继续处理");
  assert.match(sessionState({ runStatus: "running", phase: "retry_wait", unread: true }).label, /等待重试/);
});

test("execution outcome uses only this run, distinguishes truncation/abort and does not borrow history", () => {
  const assistant = (stopReason: string) => ({ role: "assistant", content: [], stopReason, errorMessage: "503 unavailable; api_key=sk-secret" }) as any;
  assert.equal(executionOutcome([], false, false).reasonCode, "HANDLED_WITHOUT_REPLY");
  assert.equal(executionOutcome([], false, false, true).status, "interrupted");
  for (const reason of ["aborted", "toolUse"]) assert.equal(executionOutcome([assistant(reason)], false, false).status, "interrupted");
  assert.equal(executionOutcome([assistant("error")], true, false).status, "cancelled");
  assert.equal(executionOutcome([assistant("length")], false, false).reasonCode, "OUTPUT_TRUNCATED");
  assert.equal(chatMessage(assistant("length"), "a")?.status, "failed");
  assert.equal(executionOutcome([assistant("error"), assistant("stop")], false, false).status, "completed");
  assert.doesNotMatch(executionOutcome([assistant("error")], false, false).error!, /sk-secret/);
});

test("result versions are atomic, monotonic, deduplicated, survive restart, and old reads cannot consume new results", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-result-version-"));
  let store = new Store(root);
  try {
    const workspace = store.execute({ requestId: "workspace", op: "workspace.open", params: { path: root, authorized: true } }) as Workspace;
    const session = store.execute({ requestId: "session", op: "session.create", workspaceId: workspace.id }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    const current = () => store.session(scope.workspaceId, scope.sessionId);
    store.recordResult(session.id, "first", "run");
    assert.equal(store.recordResult(session.id, "first", "run"), false);
    const first = current().resultVersion!;
    store.recordResult(session.id, "second", "task");
    store.readSession(scope, first);
    assert.equal(current().unread, true);
    assert.equal(current().readVersion, first);
    store.readSession(scope, 0);
    assert.equal(current().readVersion, first);
    assert.throws(() => store.readSession(scope, undefined), { code: "INVALID_INPUT" });
    store.readSession(scope, current().resultVersion);
    assert.equal(current().unread, false);
    store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES('run',?,'running','{}',1)").run(session.id);
    store.close(); store = new Store(root);
    assert.equal(current().unread, true);
    assert.equal(current().resultVersion, first + 2);
    assert.equal(store.db.prepare("SELECT status FROM runs WHERE id='run'").get()!.status, "interrupted");
    assert.equal(store.finishRun("run", "completed", null), false);
    store.close(); store = new Store(root);
    assert.equal(current().resultVersion, first + 2, "restarting twice produces one interruption result");
    store.db.exec("BEGIN IMMEDIATE");
    store.recordResult(session.id, "rollback", "run");
    store.db.exec("ROLLBACK");
    assert.equal(current().resultVersion, first + 2);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("legacy unread migrates once without losing attention", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-read-migration-"));
  const db = new DatabaseSync(join(root, "axiom.sqlite"));
  db.exec(`CREATE TABLE workspaces(id TEXT PRIMARY KEY,path TEXT NOT NULL,pathKey TEXT NOT NULL UNIQUE,name TEXT NOT NULL,authorized INTEGER NOT NULL);
    CREATE TABLE sessions(id TEXT PRIMARY KEY,workspaceId TEXT NOT NULL REFERENCES workspaces(id),title TEXT NOT NULL,pinned INTEGER NOT NULL DEFAULT 0,unread INTEGER NOT NULL DEFAULT 0,updatedAt INTEGER NOT NULL,UNIQUE(workspaceId,id));`);
  db.prepare("INSERT INTO workspaces VALUES('w',?,?,'workspace',1)").run(root, root);
  db.exec("INSERT INTO sessions VALUES('unread','w','unread',0,1,1); INSERT INTO sessions VALUES('read','w','read',0,0,1)"); db.close();
  const store = new Store(root);
  try {
    assert.equal(store.session("w", "unread").resultVersion, 1);
    assert.equal(store.session("w", "unread").readVersion, 0);
    assert.equal(store.session("w", "read").resultVersion, 0);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
