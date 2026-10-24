import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "./temporary.js";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/storage.js";
import { TaskRecords } from "../src/server/tasks/records.js";
import { TaskScheduler } from "../src/server/tasks/scheduler.js";
import { TaskDelivery } from "../src/server/tasks/delivery.js";
import { ServiceRecoveryCoordinator } from "../src/server/service-recovery.js";
import type { Agents } from "../src/server/agents.js";
import { Tasks } from "../src/server/tasks.js";
import type { Scope, Workspace, Session } from "../src/shared/protocol.js";
const selection = { provider: "fixture", id: "fixture", thinking: "off" as const };
function fixture() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "axiom-recovery-windows-")));
  const store = new Store(root);
  const w = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: root, authorized: true } }) as Workspace;
  const s = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: w.id }) as Session;
  const scope = { workspaceId: w.id, sessionId: s.id }, records = new TaskRecords(store);
  return { root, store, scope, records };
}

test("running child resumes before its undispatched additions, including a crash after requeue", async () => {
  const f = fixture(); let store = f.store, scheduler: TaskScheduler | undefined;
  try {
    const id = f.records.create(f.scope, "anchor", "context", [{ task: "already handed off" }], selection).taskIds[0];
    const row = f.records.rows("WHERE id=?", id)[0], runId = randomUUID();
    store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'running',?,?)").run(runId, row.sessionId, JSON.stringify(selection), Date.now());
    store.db.prepare("UPDATE tasks SET status='running',runId=? WHERE id=?").run(runId, id);
    store.db.prepare("UPDATE task_inputs SET state='inflight',runId=? WHERE taskId=?").run(runId, id);
    const append = f.records.queue(id, "accepted but never handed to worker", "steer");
    store.close(); store = new Store(f.root);
    assert.equal(store.recoveries.get(row.sessionId)?.kind, "resume");
    assert.deepEqual(JSON.parse(store.recoveries.get(row.sessionId)!.payload).map((i: any) => i.id), [append]);
    const recover = () => {
      const records = new TaskRecords(store);
      const agents = { store, publish: () => {}, assertContinuation: () => {} } as unknown as Agents;
      const delivery = new TaskDelivery(agents, records); delivery.pause();
      scheduler = new TaskScheduler(agents, records, delivery); scheduler.kick = () => {};
      scheduler.recover(records.rows("WHERE id=?", id)[0], store.recoveries.get(row.sessionId)!);
      return records;
    };
    let records = recover();
    assert.deepEqual(records.inputs(records.rows("WHERE id=?", id)[0], "queued").map(i => i.mode), ["resume", "steer"]);
    scheduler!.closing = true; await new Promise(resolve => setImmediate(resolve));
    store.close(); store = new Store(f.root); // Control item already had a durable receipt.
    records = recover();
    scheduler!.recover(records.rows("WHERE id=?", id)[0], store.recoveries.get(row.sessionId)!);
    assert.deepEqual(records.inputs(records.rows("WHERE id=?", id)[0], "queued").map(i => i.mode), ["resume", "steer"]);
    assert.equal(records.inputs(records.rows("WHERE id=?", id)[0], "queued")[1].id, append);
  } finally {
    if (scheduler) { scheduler.closing = true; await new Promise(resolve => setImmediate(resolve)); }
    store.close(); rmSync(f.root, { recursive: true, force: true });
  }
});

test("the final committed child result still revives its idle parent notification", () => {
  const f = fixture(); let store = f.store;
  try {
    const id = f.records.create(f.scope, "anchor", "context", [{ task: "finished" }], selection).taskIds[0];
    const row = f.records.rows("WHERE id=?", id)[0], runId = randomUUID();
    store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,endedAt) VALUES(?,?,'completed',?,?,?)").run(runId, row.sessionId, JSON.stringify(selection), 10, 20);
    store.db.prepare("UPDATE tasks SET status='completed',runId=? WHERE id=?").run(runId, id);
    store.db.prepare("DELETE FROM task_inputs WHERE taskId=?").run(id);
    store.db.prepare("INSERT INTO task_results(id,taskId,runId,body,delivery) VALUES(?,?,?,'{}','inflight')").run(randomUUID(), id, runId);
    store.close(); store = new Store(f.root);
    assert.equal(store.recoveries.get(f.scope.sessionId)?.kind, "notify");
    assert.equal(store.recoveries.get(row.sessionId), undefined, "completed child must not restart");
  } finally { store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("a child already stopping cannot be revived even while its run still says running", () => {
  const f = fixture(); let store = f.store;
  try {
    const id = f.records.create(f.scope, "anchor", "context", [{ task: "stopping" }], selection).taskIds[0];
    const row = f.records.rows("WHERE id=?", id)[0], runId = randomUUID();
    store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'running',?,?)").run(runId, row.sessionId, JSON.stringify(selection), Date.now());
    store.db.prepare("UPDATE tasks SET status='stopping',runId=? WHERE id=?").run(runId, id);
    store.close(); store = new Store(f.root);
    assert.equal(store.recoveries.get(row.sessionId), undefined);
  } finally { store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("an old notification completion cannot erase the new run's shutdown recovery", async () => {
  const f = fixture(); let finish!: () => void;
  try {
    f.store.db.prepare("INSERT INTO service_recoveries(sessionId,kind,createdAt) VALUES(?,'notify',?)").run(f.scope.sessionId, Date.now());
    const recovery = f.store.recoveries.get(f.scope.sessionId)!;
    let runId: string | undefined;
    // Execute the real recover method, holding just the notification's async boundary.
    const tasks = Object.assign(Object.create(Tasks.prototype), {
      store: f.store, records: f.records,
      agents: { info: () => ({ run: runId ? { id: runId } : null }) },
      delivery: { reconcilePending: () => {}, notify: () => new Promise<void>(resolve => { finish = resolve; }) },
    }) as Tasks;
    const job = tasks.recover(f.scope, recovery);
    runId = randomUUID();
    f.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'running',?,?)")
      .run(runId, f.scope.sessionId, JSON.stringify(selection), Date.now());
    f.store.recoveries.capture(); // Shutdown captures the new owner while notify is returning.
    finish(); assert.equal(await job, runId);
    assert.equal(f.store.recoveries.get(f.scope.sessionId)?.kind, "resume");
    assert.equal(f.store.recoveries.get(f.scope.sessionId)?.runId, runId);
    f.store.recoveries.remove(f.scope.sessionId, recovery);
    assert.equal(f.store.recoveries.get(f.scope.sessionId)?.runId, runId, "repeated old completion is harmless");
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("shutdown cancellation during recovery preparation preserves a pending intention", async () => {
  const f = fixture(); let coordinator: ServiceRecoveryCoordinator | undefined, reject!: (error: Error) => void;
  try {
    const runId = randomUUID();
    f.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'interrupted',?,?)")
      .run(runId, f.scope.sessionId, JSON.stringify(selection), Date.now());
    f.store.db.prepare("INSERT INTO service_recoveries(sessionId,runId,kind,createdAt) VALUES(?,?,'resume',?)")
      .run(f.scope.sessionId, runId, Date.now());
    const agents = { store: f.store, publish: () => {}, active: () => false,
      info: () => ({ run: { id: runId, status: "interrupted" }, activeTaskCount: 0 }) } as unknown as Agents;
    const tasks = { command: () => new Promise((_resolve, fail) => { reject = fail; }) } as unknown as Tasks;
    coordinator = new ServiceRecoveryCoordinator(agents, tasks);
    (coordinator as unknown as { tick(): void }).tick();
    coordinator.pause(); reject(new Error("service is shutting down")); await coordinator.close();
    assert.equal(f.store.recoveries.get(f.scope.sessionId)?.state, "pending");
    assert.equal(f.store.recoveries.get(f.scope.sessionId)?.error, null);
  } finally { await coordinator?.close(); f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("missing parent transcript keeps an undeliverable pending result visibly blocked", async () => {
  const f = fixture(); let coordinator: ServiceRecoveryCoordinator | undefined;
  try {
    const id = f.records.create(f.scope, "anchor", "context", [{ task: "finished" }], selection).taskIds[0];
    const row = f.records.rows("WHERE id=?", id)[0], runId = randomUUID();
    f.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,endedAt) VALUES(?,?,'completed',?,?,?)")
      .run(runId, row.sessionId, JSON.stringify(selection), 10, 20);
    f.store.db.prepare("UPDATE tasks SET status='completed',runId=? WHERE id=?").run(runId, id);
    f.store.db.prepare("DELETE FROM task_inputs WHERE taskId=?").run(id);
    f.store.db.prepare("INSERT INTO task_results(id,taskId,runId,body,delivery) VALUES(?,?,?,'{}','pending')").run(randomUUID(), id, runId);
    f.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(f.scope.sessionId, join(f.root, "missing.jsonl"));
    f.store.recoveries.capture();
    let commands = 0;
    const agents = { store: f.store, publish: () => {}, active: () => false, reloads: { active: () => false },
      info: () => ({ run: null, activeTaskCount: 0 }), command: () => { commands++; throw new Error("must not start"); } } as unknown as Agents;
    const delivery = new TaskDelivery(agents, f.records);
    const tasks = Object.assign(Object.create(Tasks.prototype), { store: f.store, records: f.records, agents, delivery }) as Tasks;
    coordinator = new ServiceRecoveryCoordinator(agents, tasks);
    (coordinator as unknown as { tick(): void }).tick();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(commands, 0);
    assert.equal(f.store.db.prepare("SELECT delivery FROM task_results WHERE taskId=?").get(id)?.delivery, "pending");
    assert.equal(f.store.recoveries.get(f.scope.sessionId)?.state, "blocked");
    assert.match(f.store.recoveries.get(f.scope.sessionId)?.error ?? "", /子任务结果通知未能确认启动/);
  } finally { await coordinator?.close(); f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("notification recovery shares the main-session admission bound", async () => {
  const f = fixture(); let coordinator: ServiceRecoveryCoordinator | undefined;
  const jobs: Array<() => void> = [];
  try {
    for (let i = 0; i < 10; i++) {
      const s = f.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: f.scope.workspaceId }) as Session;
      f.store.db.prepare("INSERT INTO service_recoveries(sessionId,kind,createdAt) VALUES(?,'notify',?)").run(s.id, Date.now());
    }
    const agents = { store: f.store, info: () => ({ run: null, activeTaskCount: 0 }), active: () => false, publish: () => {} } as unknown as Agents;
    const tasks = { recover: (_scope: Scope) => new Promise<void>(resolve => jobs.push(resolve)) } as unknown as Tasks;
    coordinator = new ServiceRecoveryCoordinator(agents, tasks);
    (coordinator as unknown as { tick(): void }).tick();
    assert.equal(jobs.length, 3);
    (coordinator as unknown as { tick(): void }).tick();
    assert.equal(jobs.length, 3, "pending notification preflight must retain its slot");
    coordinator.pause(); jobs.forEach(resolve => resolve());
  } finally { await coordinator?.close(); f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
});
