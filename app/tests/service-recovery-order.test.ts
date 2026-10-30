import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "./temporary.js";
import { Store } from "../src/server/storage.js";
import { TaskRecords } from "../src/server/tasks/records.js";
import { TaskScheduler } from "../src/server/tasks/scheduler.js";
import { TaskDelivery } from "../src/server/tasks/delivery.js";
import { ServiceRecoveryCoordinator, serviceRecoveryDelayMs } from "../src/server/service-recovery.js";
import type { Agents } from "../src/server/agents.js";
import { Tasks } from "../src/server/tasks.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";

const selection = { provider: "fixture", id: "fixture", thinking: "off" as const };
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "axiom-recovery-order-")));
  const store = new Store(root);
  const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: root, authorized: true } }) as Workspace;
  const session = () => {
    const s = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    return { workspaceId: workspace.id, sessionId: s.id };
  };
  const interrupted = (scope: Scope, state = "pending") => {
    const id = randomUUID();
    store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,reasonCode) VALUES(?,?,'interrupted',?,?,'SERVICE_INTERRUPTED')")
      .run(id, scope.sessionId, JSON.stringify(selection), Date.now());
    store.db.prepare("INSERT INTO service_recoveries(sessionId,runId,kind,state,createdAt) VALUES(?,?,'resume',?,?)")
      .run(scope.sessionId, id, state, Date.now());
    return id;
  };
  const agents = { store, publish: () => {}, active: () => false,
    info: (scope: Scope) => ({
      run: store.db.prepare("SELECT * FROM runs WHERE sessionId=? ORDER BY startedAt DESC,rowid DESC LIMIT 1").get(scope.sessionId),
      task: store.db.prepare("SELECT * FROM tasks WHERE sessionId=?").get(scope.sessionId),
      selection: JSON.parse(String(store.db.prepare("SELECT selection FROM agent_sessions WHERE sessionId=?").get(scope.sessionId)?.selection ?? JSON.stringify(selection))),
      activeTaskCount: 100,
    }),
  } as unknown as Agents;
  return { root, store, session, interrupted, agents };
}

test("children reconnect first; exactly 3 seconds after each acceptance; running models impose no cap", async t => {
  const f = fixture();
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 10000 });
  let coordinator: ServiceRecoveryCoordinator | undefined;
  const launches: string[] = [], releases: Array<() => void> = [];
  try {
    const main = f.session(); f.interrupted(main);
    const records = new TaskRecords(f.store);
    const children = records.create(main, "order", "context", [{ task: "child one" }, { task: "child two" }], selection).taskIds
      .map(id => records.rows("WHERE id=?", id)[0]);
    for (const child of children) f.interrupted({ workspaceId: child.workspaceId, sessionId: child.sessionId });
    f.store.db.prepare("UPDATE tasks SET status='interrupted'").run();
    const others = Array.from({ length: 4 }, () => { const scope = f.session(); f.interrupted(scope); return scope; });
    const launch = (scope: Scope) => {
      launches.push(scope.sessionId);
      return new Promise<void>(resolve => releases.push(() => { f.store.recoveries.remove(scope.sessionId); resolve(); }));
    };
    coordinator = new ServiceRecoveryCoordinator(f.agents, {
      recover: launch, command: (command: Scope) => launch(command),
    } as unknown as Tasks);
    coordinator.start(); t.mock.timers.tick(0);
    assert.deepEqual(launches, [children[0].sessionId]);
    t.mock.timers.tick(30000); await flush();
    assert.equal(launches.length, 1, "an unfinished reconnect cannot overlap another reconnect");
    const expected = [...children.map(child => child.sessionId), main.sessionId, ...others.map(scope => scope.sessionId)];
    for (let i = 1; i < expected.length; i++) {
      releases.at(-1)!(); await flush();
      t.mock.timers.tick(serviceRecoveryDelayMs - 1); await flush();
      assert.equal(launches.length, i);
      t.mock.timers.tick(1); await flush();
      assert.deepEqual(launches, expected.slice(0, i + 1));
    }
    releases.at(-1)!(); await flush();
    assert.equal(launches.length, 7, "neither activeTaskCount nor three already-reconnected models may stall the queue");
  } finally { coordinator?.pause(); releases.at(-1)?.(); await coordinator?.close(); f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("a newly interrupted child takes priority over remaining main sessions", async t => {
  const f = fixture();
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 10000 });
  let coordinator: ServiceRecoveryCoordinator | undefined;
  try {
    const first = f.session(), next = f.session();
    f.interrupted(first); f.interrupted(next);
    const launches: string[] = [];
    const accept = async (scope: Scope) => { launches.push(scope.sessionId); f.store.recoveries.remove(scope.sessionId); };
    coordinator = new ServiceRecoveryCoordinator(f.agents, { command: accept, recover: accept } as unknown as Tasks);
    coordinator.start(); t.mock.timers.tick(0); await flush();
    const records = new TaskRecords(f.store);
    const child = records.rows("WHERE id=?", records.create(first, "new-child", "context", [{ task: "new interruption" }], selection).taskIds[0])[0];
    f.interrupted({ workspaceId: child.workspaceId, sessionId: child.sessionId });
    t.mock.timers.tick(3000); await flush();
    assert.deepEqual(launches, [first.sessionId, child.sessionId]);
    t.mock.timers.tick(3000); await flush();
    assert.deepEqual(launches, [first.sessionId, child.sessionId, next.sessionId]);
  } finally { await coordinator?.close(); f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("restored file authorization retries blocked recovery without a service restart", async t => {
  const f = fixture();
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 10000 });
  let coordinator: ServiceRecoveryCoordinator | undefined;
  try {
    const scope = f.session(); f.interrupted(scope);
    f.store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id=?").run(scope.workspaceId);
    let launches = 0;
    coordinator = new ServiceRecoveryCoordinator(f.agents, { command: async () => { launches++; f.store.recoveries.remove(scope.sessionId); } } as unknown as Tasks);
    coordinator.start(); t.mock.timers.tick(0); await flush();
    assert.equal(launches, 0);
    assert.equal(f.store.recoveries.get(scope.sessionId)?.state, "blocked");
    f.store.db.prepare("UPDATE workspaces SET authorized=1 WHERE id=?").run(scope.workspaceId);
    t.mock.timers.tick(3000); await flush();
    assert.equal(launches, 1);
  } finally { await coordinator?.close(); f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("preflight failure is retryable after other sessions, including old blocked intentions", async t => {
  const f = fixture();
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 10000 });
  let coordinator: ServiceRecoveryCoordinator | undefined;
  try {
    const failed = f.session(), next = f.session();
    f.interrupted(failed, "blocked"); f.interrupted(next);
    const attempts: string[] = [], requestIds = new Set<string>();
    let fail = true;
    coordinator = new ServiceRecoveryCoordinator(f.agents, { command: async (command: Scope & { requestId: string }) => {
      attempts.push(command.sessionId); requestIds.add(command.requestId);
      if (command.sessionId === failed.sessionId && fail) throw Error("temporary configuration read failure");
      f.store.recoveries.remove(command.sessionId);
    } } as unknown as Tasks);
    coordinator.start(); t.mock.timers.tick(0); await flush();
    assert.equal(f.store.recoveries.get(failed.sessionId)?.state, "pending");
    assert.match(f.store.recoveries.get(failed.sessionId)?.error ?? "", /temporary/);
    t.mock.timers.tick(3000); await flush();
    assert.deepEqual(attempts, [failed.sessionId, next.sessionId]);
    fail = false; t.mock.timers.tick(3000); await flush();
    assert.deepEqual(attempts, [failed.sessionId, next.sessionId, failed.sessionId]);
    assert.equal(requestIds.size, 3, "a failed external request receipt must not poison the next preflight attempt");
    assert.equal(f.store.recoveries.pending().length, 0);
  } finally { await coordinator?.close(); f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("a coordinator read error cannot disable future recovery ticks", async t => {
  const f = fixture();
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 10000 });
  let coordinator: ServiceRecoveryCoordinator | undefined;
  try {
    const scope = f.session(); f.interrupted(scope);
    const info = f.agents.info.bind(f.agents);
    let broken = true, attempts = 0;
    f.agents.info = ((target: Scope) => { if (broken) throw Error("temporary read failure"); return info(target); }) as Agents["info"];
    t.mock.method(console, "warn", () => {});
    coordinator = new ServiceRecoveryCoordinator(f.agents, { command: async () => { attempts++; f.store.recoveries.remove(scope.sessionId); } } as unknown as Tasks);
    coordinator.start(); t.mock.timers.tick(0); await flush();
    broken = false; t.mock.timers.tick(3000); await flush();
    assert.equal(attempts, 1);
  } finally { await coordinator?.close(); f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("runtime settlement and recovery intent commit atomically and survive an immediate restart", t => {
  const f = fixture();
  try {
    const scope = f.session(), runId = randomUUID();
    f.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'running',?,?)")
      .run(runId, scope.sessionId, JSON.stringify(selection), Date.now());
    const capture = t.mock.method(f.store.recoveries, "interrupted", () => { throw Error("recovery write failed"); });
    assert.throws(() => f.store.finishRun(runId, "interrupted", "lost", "UNCERTAIN", undefined, true), /recovery write failed/);
    assert.equal(f.store.db.prepare("SELECT status FROM runs WHERE id=?").get(runId)?.status, "running", "failed recovery write rolls back run settlement");
    assert.equal(f.store.recoveries.get(scope.sessionId), undefined);
    capture.mock.restore();
    assert.equal(f.store.finishRun(runId, "interrupted", "lost", "UNCERTAIN", undefined, true), true);
    f.store.close(); f.store = new Store(f.root);
    assert.equal(f.store.recoveries.get(scope.sessionId)?.runId, runId, "no crash window between interrupted status and recovery intent");
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("recovery bypasses an earlier ordinary preflight admission turn", async () => {
  const f = fixture();
  let scheduler: TaskScheduler | undefined, release: (() => void) | undefined, job: Promise<void> | undefined;
  try {
    const scope = f.session(), records = new TaskRecords(f.store);
    const row = records.rows("WHERE id=?", records.create(scope, "admission", "context", [{ task: "recover" }], selection).taskIds[0])[0];
    f.interrupted({ workspaceId: row.workspaceId, sessionId: row.sessionId });
    f.store.db.prepare("UPDATE tasks SET status='interrupted' WHERE id=?").run(row.id);
    let accepted = false;
    Object.assign(f.agents, { assertContinuation() {}, command: async (_command: unknown, internal: any) => {
      if (internal.admission) await internal.admission.turn.wait(new AbortController().signal);
      internal.beforeStart(); accepted = true; f.store.recoveries.remove(row.sessionId);
    } });
    const delivery = new TaskDelivery(f.agents, records); delivery.pause();
    scheduler = new TaskScheduler(f.agents, records, delivery); scheduler.kick = () => {};
    const blocker = (scheduler as any).admission.reserve(); release = blocker.release;
    job = scheduler.recoverAndStart(row, f.store.recoveries.get(row.sessionId)!);
    await flush();
    assert.equal(accepted, true, "ordinary preflight cannot own the recovery queue's only in-flight slot");
    await job;
  } finally {
    release?.(); await job?.catch(() => {}); if (scheduler) scheduler.closing = true;
    await flush(); f.store.close(); rmSync(f.root, { recursive: true, force: true });
  }
});

test("confirmed provider stop cancels non-live main and interrupted child recovery only after confirmation", async () => {
  const f = fixture();
  try {
    const scope = f.session(), other = f.session(), records = new TaskRecords(f.store);
    f.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(scope.sessionId, JSON.stringify(selection));
    f.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(other.sessionId, JSON.stringify({ ...selection, provider: "unaffected" }));
    const child = records.rows("WHERE id=?", records.create(scope, "provider", "context", [{ task: "interrupted child" }], selection).taskIds[0])[0];
    f.interrupted(scope); f.interrupted(other); f.interrupted({ workspaceId: child.workspaceId, sessionId: child.sessionId });
    f.store.db.prepare("UPDATE tasks SET status='interrupted' WHERE id=?").run(child.id);
    Object.assign(f.agents, { reloads: {}, compressions: { checkProviders() {} }, affected: () => [], stopProviders: async () => {} });
    const tasks = new Tasks(f.agents);
    await assert.rejects(tasks.stopProviders([selection.provider], false), { code: "ACTIVE_RUNS_CONFIRMATION_REQUIRED" });
    assert.ok(f.store.recoveries.get(scope.sessionId)); assert.ok(f.store.recoveries.get(child.sessionId));
    await tasks.stopProviders([selection.provider], true);
    assert.equal(f.store.recoveries.get(scope.sessionId), undefined);
    assert.equal(f.store.recoveries.get(child.sessionId), undefined);
    assert.ok(f.store.recoveries.get(other.sessionId), "other providers retain their recovery intent");
    assert.equal(f.store.db.prepare("SELECT frozen FROM task_parents WHERE sessionId=?").get(scope.sessionId)?.frozen, 1);
  } finally { await flush(); f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("unexpected worker interruption records only undispatched input, not ordinary model failures", () => {
  const f = fixture();
  try {
    const scope = f.session(), records = new TaskRecords(f.store);
    const id = records.create(scope, "runtime", "context", [{ task: "original" }], selection).taskIds[0];
    const child = records.rows("WHERE id=?", id)[0];
    const runId = randomUUID();
    f.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'running',?,?)")
      .run(runId, child.sessionId, JSON.stringify(selection), Date.now());
    f.store.db.prepare("UPDATE tasks SET status='running',runId=? WHERE id=?").run(runId, id);
    f.store.db.prepare("UPDATE task_inputs SET state='inflight',runId=? WHERE taskId=?").run(runId, id);
    const queued = records.queue(id, "never dispatched", "steer");
    assert.equal(f.store.finishRun(runId, "interrupted", "IPC lost", "WORKER_INTERRUPTED", undefined, true), true);
    assert.deepEqual(JSON.parse(f.store.recoveries.get(child.sessionId)!.payload).map((input: { id: string }) => input.id), [queued]);
    f.store.recoveries.remove(child.sessionId);
    f.store.db.prepare("UPDATE runs SET status='running' WHERE id=?").run(runId);
    assert.equal(f.store.finishRun(runId, "failed", "model error", "MODEL_ERROR", undefined, true), true);
    assert.equal(f.store.recoveries.get(child.sessionId), undefined);
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
});
