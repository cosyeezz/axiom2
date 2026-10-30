import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { captureTaskWindow } from "../src/server/task-window-source.js";
import { taskWindowFixture } from "./fixtures/task-window.js";

const unavailable = (error: unknown) => error instanceof Error && "code" in error && error.code === "UNAVAILABLE";

test("task SQL cut preserves authoritative task, receipt and result ordering without report bodies", t => {
  const f = taskWindowFixture(t), a = f.task("a", 20), b = f.task("b", 10), c = f.task("c", 20);
  f.input(a, "i-a", 20); f.input(a, "i-b", 10, "delivered"); f.input(a, "i-c", 20, "failed");
  f.result(a, "r-a", "failed", "PRIVATE_REPORT_PAYLOAD".repeat(20_000)); f.result(a, "r-b");
  f.store.db.prepare("UPDATE runs SET startedAt=40,endedAt=10 WHERE id='run-r-b'").run();
  f.store.db.prepare("INSERT INTO task_model_refs(taskId) VALUES(?)").run(b.id);
  f.store.db.prepare("INSERT INTO task_parents(sessionId,frozen) VALUES(?,1)").run(f.scope.sessionId);
  const source = captureTaskWindow(f.store, f.scope);
  assert.deepEqual(source.tasks.map(task => task.id), [b.id, a.id, c.id]);
  assert.deepEqual(source.tasks[1].inputs.map(input => input.inputId), ["i-b", "i-a", "i-c"]);
  assert.deepEqual(source.tasks[1].results.map(result => result.id), ["r-a", "r-b"]);
  assert.equal(source.tasks[1].elapsedMs, 20);
  assert.deepEqual(source.tasks[1].budgets, { concurrency: 4, workMs: 600_000 });
  assert.match(source.tasks[0].ref!, /^t\d+$/); assert.equal(source.tasks[1].ref, undefined);
  assert.equal(source.frozen, true); assert.equal(source.run, null);
  assert.equal(JSON.stringify(source).includes("PRIVATE_REPORT_PAYLOAD"), false);
  assert.equal(source.resultVersion, 0); assert.equal(source.readVersion, 0); assert.deepEqual(source.resultRefs, []);
});

test("immutable SQL cuts preserve old task state and bind new resultRefs to one watermark and run", t => {
  const f = taskWindowFixture(t), a = f.task("a"), r1 = f.result(a, "r1");
  f.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES('parent-1',?,'running','{}',10)").run(f.scope.sessionId);
  f.store.recordResult(f.scope.sessionId, r1.id, "task");
  const first = captureTaskWindow(f.store, f.scope);
  f.store.db.prepare("UPDATE tasks SET title='new title',status='running' WHERE id=?").run(a.id);
  f.input(a, "later-input", 1, "accepted"); const r2 = f.result(a, "r2");
  f.store.recordResult(f.scope.sessionId, r2.id, "task");
  f.store.db.prepare("UPDATE task_results SET delivery='discarded' WHERE id=?").run(r1.id);
  f.store.db.prepare("UPDATE sessions SET readVersion=1 WHERE id=?").run(f.scope.sessionId);
  f.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES('parent-2',?,'completed','{}',10)").run(f.scope.sessionId);
  const next = captureTaskWindow(f.store, f.scope);
  assert.equal(first.tasks[0].title, "title"); assert.equal(first.tasks[0].status, "completed");
  assert.equal(first.tasks[0].inputs.length, 0); assert.equal(first.tasks[0].results.length, 1);
  assert.deepEqual(first.resultRefs, [{ taskId: a.id, resultId: r1.id, runId: r1.runId, version: 1 }]);
  assert.deepEqual(first.run, { id: "parent-1", status: "running" });
  assert.equal(next.tasks[0].title, "new title"); assert.equal(next.tasks[0].inputs[0].state, "accepted");
  assert.equal(next.tasks[0].results.length, 2); // Discarding notifications does NOT erase historical deliveries.
  assert.equal(next.resultVersion, 2); assert.equal(next.readVersion, 1);
  assert.deepEqual(next.resultRefs, [{ taskId: a.id, resultId: r2.id, runId: r2.runId, version: 2 }]);
  assert.deepEqual(next.run, { id: "parent-2", status: "completed" });
  for (const value of [next, next.tasks, next.tasks[0], next.tasks[0].budgets, next.tasks[0].inputs,
    next.tasks[0].inputs[0], next.tasks[0].results, next.tasks[0].results[0], next.resultRefs, next.resultRefs[0], next.run]) assert.ok(Object.isFrozen(value));
});

test("task SQL source enforces parent scope, authorization, deleted owners and archive boundaries", t => {
  const f = taskWindowFixture(t), a = f.task("a"), other = f.session(), foreign = f.task("foreign", 1, other);
  f.input(foreign, "foreign-input", 1); f.result(foreign, "foreign-result");
  const own = captureTaskWindow(f.store, f.scope);
  assert.deepEqual(own.tasks.map(task => task.id), [a.id]);
  assert.equal(JSON.stringify(own).includes("foreign"), false);
  assert.throws(() => captureTaskWindow(f.store, { ...f.scope, workspaceId: "wrong-workspace" }));
  f.store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id=?").run(f.scope.workspaceId);
  assert.throws(() => captureTaskWindow(f.store, f.scope), unavailable);
  f.store.db.prepare("UPDATE workspaces SET authorized=1,archived=1 WHERE id=?").run(f.scope.workspaceId);
  assert.throws(() => captureTaskWindow(f.store, f.scope));
  f.store.db.prepare("UPDATE workspaces SET archived=0 WHERE id=?").run(f.scope.workspaceId);
  f.store.db.prepare("UPDATE sessions SET deletedAt=1 WHERE id=?").run(f.scope.sessionId);
  assert.throws(() => captureTaskWindow(f.store, f.scope));
  f.store.db.prepare("UPDATE sessions SET deletedAt=NULL WHERE id=?").run(f.scope.sessionId);
  assert.equal(captureTaskWindow(f.store, f.scope).tasks.length, 1); // Every failed read released its savepoint.
});

test("task capture neither repairs aliases nor writes, and preserves an enclosing transaction on success and failure", t => {
  const f = taskWindowFixture(t), changes = () => f.store.db.prepare("SELECT total_changes() AS n").get()!.n;
  f.store.db.exec("SAVEPOINT caller");
  const a = f.task("uncommitted");
  let before = changes();
  assert.equal(captureTaskWindow(f.store, f.scope).tasks[0].ref, undefined);
  assert.equal(changes(), before);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM task_model_refs WHERE taskId=?").get(a.id)!.n, 0);
  f.store.db.prepare("UPDATE tasks SET budgets='broken JSON' WHERE id=?").run(a.id);
  before = changes();
  assert.throws(() => captureTaskWindow(f.store, f.scope)); assert.equal(changes(), before);
  assert.equal(f.store.db.prepare("SELECT budgets FROM tasks WHERE id=?").get(a.id)!.budgets, "broken JSON");
  f.store.db.prepare("UPDATE tasks SET budgets='{}' WHERE id=?").run(a.id);
  assert.equal(captureTaskWindow(f.store, f.scope).tasks.length, 1);
  f.store.db.exec("ROLLBACK TO caller; RELEASE caller");
  assert.equal(captureTaskWindow(f.store, f.scope).tasks.length, 0);
});

test("the read savepoint prevents a concurrent SQLite writer from mixing owner watermarks and task state", t => {
  const f = taskWindowFixture(t); f.task("a");
  const writer = new DatabaseSync(join(f.root, "axiom.sqlite")), session = f.store.session.bind(f.store);
  f.store.session = (workspaceId, sessionId) => {
    const owner = session(workspaceId, sessionId); // Pins the read snapshot before the other connection commits.
    writer.exec("BEGIN IMMEDIATE");
    writer.prepare("UPDATE tasks SET status='running',title='after writer' WHERE id='a'").run();
    writer.prepare("UPDATE sessions SET resultVersion=1,readVersion=1 WHERE id=?").run(f.scope.sessionId);
    writer.prepare("INSERT INTO task_parents(sessionId,frozen) VALUES(?,1)").run(f.scope.sessionId);
    writer.exec("COMMIT");
    return owner;
  };
  try {
    const old = captureTaskWindow(f.store, f.scope);
    assert.equal(old.resultVersion, 0); assert.equal(old.readVersion, 0);
    assert.equal(old.tasks[0].status, "completed"); assert.equal(old.tasks[0].title, "title"); assert.equal(old.frozen, false);
  } finally { f.store.session = session; writer.close(); }
  const next = captureTaskWindow(f.store, f.scope);
  assert.equal(next.resultVersion, 1); assert.equal(next.readVersion, 1);
  assert.equal(next.tasks[0].status, "running"); assert.equal(next.tasks[0].title, "after writer"); assert.equal(next.frozen, true);
});

test("dangling, foreign and future task result events fail closed instead of certifying empty coverage", t => {
  const f = taskWindowFixture(t), a = f.task("a"), foreign = f.task("foreign", 1, f.session());
  const ownResult = f.result(a, "own-result"), foreignResult = f.result(foreign, "foreign-result");
  f.store.recordResult(f.scope.sessionId, foreignResult.id, "task");
  assert.throws(() => captureTaskWindow(f.store, f.scope), unavailable);
  f.store.db.prepare("DELETE FROM session_results WHERE sessionId=?").run(f.scope.sessionId);
  f.store.recordResult(f.scope.sessionId, "missing-result", "task");
  assert.throws(() => captureTaskWindow(f.store, f.scope), unavailable);
  f.store.db.prepare("DELETE FROM session_results WHERE sessionId=?").run(f.scope.sessionId);
  f.store.recordResult(f.scope.sessionId, ownResult.id, "task");
  f.store.db.prepare("UPDATE sessions SET resultVersion=2 WHERE id=?").run(f.scope.sessionId);
  assert.throws(() => captureTaskWindow(f.store, f.scope), unavailable);
  f.store.db.prepare("UPDATE sessions SET resultVersion=3 WHERE id=?").run(f.scope.sessionId);
  f.store.db.prepare("UPDATE task_results SET delivery='discarded' WHERE id=?").run(ownResult.id);
  assert.deepEqual(captureTaskWindow(f.store, f.scope).resultRefs, []);
  f.store.db.prepare("UPDATE sessions SET readVersion=4 WHERE id=?").run(f.scope.sessionId);
  assert.throws(() => captureTaskWindow(f.store, f.scope), unavailable);
});
