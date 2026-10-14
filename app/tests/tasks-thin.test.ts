import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/storage.js";
import type { Agents } from "../src/server/agents.js";
import { TaskRecords, target } from "../src/server/tasks/records.js";
import { TaskScheduler } from "../src/server/tasks/scheduler.js";
import { TaskDelivery } from "../src/server/tasks/delivery.js";
import { taskTools } from "../src/server/task-tools.js";
import type { Run, Selection } from "../src/shared/agent.js";
import type { Session, Workspace } from "../src/shared/protocol.js";
import { defaultBudgets, taskActive } from "../src/shared/tasks.js";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-thin-tasks-"));
  const store = new Store(root);
  const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: root, authorized: true } }) as Workspace;
  const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const selection: Selection = { provider: "fixture", id: "fixture", thinking: "off" };
  const records = new TaskRecords(store);
  const taskId = records.create(scope, "anchor", "context", [{ task: "task", role: "" }], selection).taskIds[0];
  let run: Run | null = null;
  const stops: unknown[][] = [], signals: any[] = [];
  let releaseStop: () => void = () => {};
  const agents = {
    store,
    info: () => ({ selection, run }),
    thread: () => ({ ids: [] }),
    active: () => !!run && ["running", "starting", "stopping"].includes(run.status),
    publish: () => {},
    signal: (_scope: unknown, _runId: string, event: unknown) => { signals.push(event); return true; },
    stop: (...args: unknown[]) => {
      stops.push(args);
      return new Promise<void>((resolve) => { releaseStop = resolve; });
    },
  } as unknown as Agents;
  const delivery = new TaskDelivery(agents, records);
  // Tests focus on the child scheduler; no parent model should be started.
  delivery.pause();
  const scheduler = new TaskScheduler(agents, records, delivery);
  const row = () => records.rows("WHERE id=?", taskId)[0];
  const activate = () => {
    run = { id: randomUUID(), sessionId: row().sessionId, status: "running", selection, startedAt: Date.now(), endedAt: null, error: null };
    store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,?,?,?)").run(run.id, run.sessionId, run.status, JSON.stringify(selection), run.startedAt);
    store.db.prepare("UPDATE tasks SET status='running',runId=? WHERE id=?").run(run.id, taskId);
    store.db.prepare("DELETE FROM task_inputs WHERE taskId=?").run(taskId);
    return run;
  };
  return { store, scope, records, taskId, row, scheduler, delivery, stops, signals, activate,
    release: () => releaseStop(),
    dispose: async () => { scheduler.closing = true; releaseStop(); await tick(); await tick(); store.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

test("thin task contract exposes only work budget and direct cancellation", () => {
  assert.deepEqual(defaultBudgets, { concurrency: 4, workMs: 600_000 });
  assert.equal(taskActive("wrapping" as any), false);
  assert.equal(taskActive("summarizing" as any), false);
  const cancel = taskTools(async () => ({})).find((tool) => tool.name === "cancel_task")!;
  assert.deepEqual(Object.keys((cancel.parameters as any).properties), ["taskId", "reason"]);
});

test("queued cancellation creates one result without a worker or cleanup state", async () => {
  const f = fixture();
  try {
    assert.deepEqual(f.scheduler.cancel(f.row(), { reason: "stop" }), { taskId: f.taskId, status: "cancelled" });
    f.scheduler.cancel(f.row(), {});
    assert.equal(f.stops.length, 0);
    assert.equal(f.records.inputs(f.row(), "queued").length, 0);
    const result = f.records.list(f.scope).tasks[0].results;
    assert.equal(result.length, 1);
    const body = f.delivery.result(f.scope, f.taskId, result[0].id);
    assert.equal(body.reason, "stop");
    assert.equal("cleanup" in body, false);
    assert.equal("pending" in f.records.list(f.scope).tasks[0], false);
    assert.match(body.sideEffects, /未回滚/);
  } finally { await f.dispose(); }
});

test("running cancellation calls stop(scope) once and rejects stopping-time input", async () => {
  const f = fixture();
  try {
    const run = f.activate();
    f.records.queue(f.taskId, "do not replay", "followUp");
    assert.throws(() => f.scheduler.cancel(f.row(), { mode: "summary" }), { code: "INVALID_INPUT" });
    f.scheduler.cancel(f.row(), { reason: "stop now" });
    f.scheduler.cancel(f.row(), {});
    assert.deepEqual(f.stops, [[target(f.row())]]);
    assert.equal(f.signals.length, 0, "stop never sends a summary prompt");
    await assert.rejects(f.scheduler.append(f.row(), { text: "late" }), { code: "TASK_STOPPED" });
    f.scheduler.settle(f.row(), { ...run, status: "cancelled", endedAt: Date.now() });
    assert.equal(f.row().status, "cancelled");
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM task_inputs").get()!.n, 0);
    f.release(); await tick();
    f.scheduler.closing = true;
  } finally { await f.dispose(); }
});

test("work deadline directly stops without wrapping or a second model request", async () => {
  const f = fixture();
  try {
    const run = f.activate();
    f.store.db.prepare("UPDATE tasks SET budgets=? WHERE id=?").run(JSON.stringify({ concurrency: 1, workMs: 5 }), f.taskId);
    (f.scheduler as any).arm(f.row(), run);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(f.stops, [[target(f.row())]]);
    assert.equal(f.signals.length, 0);
    assert.equal(f.row().status, "stopping");
    assert.match(f.row().error!, /工作预算/);
  } finally { await f.dispose(); }
});

test("live concurrency changes fill existing FIFO slots and never stop active tasks on decrease", async () => {
  const f = fixture();
  try {
    const selection: Selection = { provider: "fixture", id: "fixture", thinking: "off" };
    f.records.create(f.scope, "more", "context", [{ task: "second", role: "" }, { task: "third", role: "" }], selection);
    const launched: string[] = [];
    (f.scheduler as any).start = async (row: { id: string }) => {
      launched.push(row.id);
      f.store.db.prepare("UPDATE tasks SET status='starting' WHERE id=?").run(row.id);
    };
    f.store.db.prepare("INSERT INTO task_settings VALUES(1,?)").run(JSON.stringify({ concurrency: 1, workMs: 600000 }));
    f.scheduler.preferencesChanged(); await tick(); await tick();
    assert.equal(launched.length, 1);
    assert.equal(launched[0], f.taskId);
    f.store.db.prepare("UPDATE task_settings SET body=?").run(JSON.stringify({ concurrency: 3, workMs: 600000 }));
    f.scheduler.preferencesChanged(); await tick(); await tick();
    assert.equal(launched.length, 3);
    f.store.db.prepare("UPDATE task_settings SET body=?").run(JSON.stringify({ concurrency: 1, workMs: 600000 }));
    f.records.create(f.scope, "last", "context", [{ task: "fourth", role: "" }], selection);
    f.scheduler.preferencesChanged(); await tick(); await tick();
    assert.equal(launched.length, 3);
    assert.equal(f.stops.length, 0);
    assert.equal(f.records.rows("WHERE status='queued'").length, 1);
  } finally { await f.dispose(); }
});

test("live budget updates keep the original start and expire overdue running tasks", async () => {
  const f = fixture();
  try {
    const run = f.activate();
    run.startedAt = Date.now() - 2000;
    f.store.db.prepare("INSERT INTO task_settings VALUES(1,?)").run(JSON.stringify({ concurrency: 2, workMs: 1000 }));
    f.scheduler.preferencesChanged();
    assert.deepEqual(f.records.list(f.scope).tasks[0].budgets, { concurrency: 2, workMs: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(f.stops.length, 1, "does not restart the deadline from preference save time");
    assert.equal(f.row().status, "stopping");
    assert.equal(f.signals.length, 0);
  } finally { await f.dispose(); }
});

test("live budget extension replaces the old timer without resetting elapsed work", async () => {
  const f = fixture();
  try {
    const run = f.activate();
    run.startedAt = Date.now() - 50;
    f.store.db.prepare("UPDATE tasks SET budgets=? WHERE id=?").run(JSON.stringify({ concurrency: 1, workMs: 70 }), f.taskId);
    (f.scheduler as any).arm(f.row(), run);
    f.store.db.prepare("INSERT INTO task_settings VALUES(1,?)").run(JSON.stringify({ concurrency: 1, workMs: 1000 }));
    f.scheduler.preferencesChanged();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(f.stops.length, 0);
    f.scheduler.settle(f.row(), { ...run, status: "completed", endedAt: Date.now() });
  } finally { await f.dispose(); }
});

test("native live input modes survive, but unacknowledged inputs are not replayed", async () => {
  const f = fixture();
  try {
    const run = f.activate();
    await f.scheduler.append(f.row(), { text: "steer", mode: "steer" });
    await f.scheduler.append(f.row(), { text: "follow", mode: "followUp" });
    assert.deepEqual(f.signals.map((event) => event.mode), ["steer", "followUp"]);
    f.records.freeze(f.scope);
    f.scheduler.settle(f.row(), { ...run, status: "completed", endedAt: Date.now() });
    assert.equal(f.row().status, "completed");
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM task_inputs").get()!.n, 0);
    assert.equal(f.records.list(f.scope).frozen, true);
    // A new explicit child follow-up is allowed without thawing the parent.
    await f.scheduler.append(f.row(), { text: "new work" });
    assert.equal(f.row().status, "queued");
    assert.equal(f.records.inputs(f.row(), "queued")[0].body, "new work");
    assert.equal(f.records.list(f.scope).frozen, true);
    f.scheduler.closing = true;
  } finally { await f.dispose(); }
});

test("legacy saved budgets are projected to the current two-field contract", async () => {
  const f = fixture();
  try {
    const old = JSON.stringify({ concurrency: 2, workMs: 9000, wrapMs: 50, summaryMs: 30, cleanupMs: 10 });
    f.store.db.prepare("INSERT INTO task_settings VALUES(1,?)").run(old);
    f.store.db.prepare("UPDATE tasks SET budgets=? WHERE id=?").run(old, f.taskId);
    assert.deepEqual(f.records.preferences(), { concurrency: 2, workMs: 9000 });
    assert.deepEqual(f.records.list(f.scope).tasks[0].budgets, { concurrency: 2, workMs: 9000 });
  } finally { await f.dispose(); }
});
