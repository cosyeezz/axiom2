import assert from "node:assert/strict";
import { test } from "node:test";
import { getEventListeners } from "node:events";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "./temporary.js";
import { ExecutionPool, type ExecutionLease } from "../src/server/execution-pool.js";
import type { PreparedEnvironment } from "../src/server/execution-profile.js";
import { Store } from "../src/server/storage.js";
import { TaskRecords } from "../src/server/tasks/records.js";
import { Tasks } from "../src/server/tasks.js";
import type { Agents } from "../src/server/agents.js";
import { AppError, type Scope, type Session, type Workspace } from "../src/shared/protocol.js";

const selection = { provider: "fixture", id: "fixture", thinking: "off" as const };

test("full physical capacity rejects only the current recovery attempt without holding the serial queue", { timeout: 5000 }, async () => {
  const pool = new ExecutionPool({ maxLiveProcesses: 2, maxIdleRetained: 0, targetReadyTotal: 0 });
  const environment = {
    profileHash: "fixture", entry: "agent", reuse: "same-session", environmentWarm: false,
    current: () => true, snapshotValid: () => true, retain() {}, release() {},
  } as unknown as PreparedEnvironment;
  const acquire = (extra = {}) => pool.acquire({ environment, kind: "agent", signal: new AbortController().signal,
    requestStartedAtMonoMs: performance.now(), ...extra });
  let normal: Promise<ExecutionLease> | undefined;
  try {
    const first = await acquire();
    const leaf = await acquire({ kind: "memory-query", parentLease: first.ref });
    assert.equal(pool.stats().total, pool.limits.maxLiveProcesses, "ordinary and nested reservations fill every physical slot");
    normal = acquire(); void normal.catch(() => {});
    assert.equal(pool.stats().queued, 1);
    const controller = new AbortController();
    await assert.rejects(acquire({ wait: false, signal: controller.signal, deadlineAt: Date.now() + 1000 }), { code: "EXECUTION_BUSY" });
    assert.equal(getEventListeners(controller.signal, "abort").length, 0, "failed recovery leaves no abort listener or waiter");
    assert.equal(pool.stats().queued, 1, "the ordinary waiter remains queued");
    assert.equal(pool.isActive(first.ref), true, "capacity exhaustion does not preempt another execution");
    controller.abort();
    await pool.retire(leaf.ref, "fixture_release");
    await pool.retire(first.ref, "fixture_release");
    const ordinary = await normal;
    assert.equal(pool.isActive(ordinary.ref), true);
    assert.equal(pool.stats().queued, 0);
    await pool.retire(ordinary.ref, "fixture_release");
    const retried = await acquire({ wait: false });
    assert.equal(pool.isActive(retried.ref), true, "the later recovery attempt can start after capacity frees");
    assert.equal(pool.stats().live, 0, "the test never starts a real worker");
    assert.ok(pool.stats().peak <= pool.limits.maxLiveProcesses);
    await pool.retire(retried.ref, "fixture_release");
  } finally { await pool.close(); await normal?.catch(() => {}); }
});

test("notification recovery returns pending on physical busy and hands off exactly once on retry", async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "axiom-recovery-capacity-")));
  const store = new Store(root);
  let tasks: Tasks | undefined;
  try {
    const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: root, authorized: true } }) as Workspace;
    const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    const records = new TaskRecords(store);
    const child = records.rows("WHERE id=?", records.create(scope, "capacity", "context", [{ task: "done" }], selection).taskIds[0])[0];
    const parentRun = randomUUID(), childRun = randomUUID(), resultId = randomUUID();
    for (const [runId, sessionId] of [[parentRun, scope.sessionId], [childRun, child.sessionId]])
      store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'completed',?,?)")
        .run(runId, sessionId, JSON.stringify(selection), Date.now() - 1000);
    store.db.prepare("UPDATE tasks SET status='completed',runId=? WHERE id=?").run(childRun, child.id);
    store.db.prepare("INSERT INTO task_results(id,taskId,runId,body,delivery) VALUES(?,?,?,?,'pending')")
      .run(resultId, child.id, childRun, JSON.stringify({ id: resultId, taskId: child.id }));
    store.db.prepare("INSERT INTO service_recoveries(sessionId,runId,kind,createdAt) VALUES(?,?,'notify',?)")
      .run(scope.sessionId, parentRun, Date.now());
    let busy = true, attempts = 0;
    const newRun = randomUUID();
    const agents = {
      store, reloads: { active: () => false }, active: () => false, publish() {}, close: async () => {},
      info: (owner: Scope) => ({ run: store.db.prepare("SELECT * FROM runs WHERE sessionId=? ORDER BY startedAt DESC,rowid DESC LIMIT 1").get(owner.sessionId) }),
      command: async (_command: unknown, internal: any) => {
        attempts++;
        assert.equal(internal.serviceRecovery, true, "notification recovery must also request nonblocking capacity");
        if (busy) throw new AppError("EXECUTION_BUSY", "fixture full pool");
        internal.beforeStart();
        store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'starting',?,?)")
          .run(newRun, scope.sessionId, JSON.stringify(selection), Date.now());
        internal.onStart({ id: newRun });
        return { runId: newRun };
      },
    } as unknown as Agents;
    tasks = new Tasks(agents);
    const recovery = store.recoveries.get(scope.sessionId)!;
    await assert.rejects(tasks.recover(scope, recovery), { code: "RECOVERY_BLOCKED" });
    assert.equal(store.recoveries.get(scope.sessionId)?.runId, parentRun, "busy does not consume the recovery intention");
    assert.equal(store.db.prepare("SELECT delivery FROM task_results WHERE id=?").get(resultId)?.delivery, "pending");
    assert.equal(store.db.prepare("SELECT state FROM task_notification_attempts ORDER BY rowid DESC LIMIT 1").get()?.state, "pending");
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE sessionId=?").get(scope.sessionId)?.n, 1, "busy has no new durable run");
    busy = false;
    assert.equal(await tasks.recover(scope, recovery), newRun);
    assert.equal(store.recoveries.get(scope.sessionId), undefined);
    agents.reloads.onReleased?.(scope);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(attempts, 2, "another lifecycle notification does not dispatch the in-flight result again");
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE sessionId=?").get(scope.sessionId)?.n, 2);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM task_notification_attempts WHERE runId=?").get(newRun)?.n, 1);
    assert.equal(store.db.prepare("SELECT delivery FROM task_results WHERE id=?").get(resultId)?.delivery, "inflight");
  } finally { await tasks?.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});
