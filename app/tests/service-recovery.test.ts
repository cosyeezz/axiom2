// Local SQLite and loopback model only; never uses personal model credentials.
import assert from "node:assert/strict";
import { test } from "node:test";
import { replyToFixtureTitle } from "./model-request-fixture.js";
import { createServer, type ServerResponse } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "./temporary.js";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/storage.js";
import { TaskRecords } from "../src/server/tasks/records.js";
import { TaskScheduler } from "../src/server/tasks/scheduler.js";
import { TaskDelivery } from "../src/server/tasks/delivery.js";
import { ServiceRecoveryCoordinator } from "../src/server/service-recovery.js";
import { startServer } from "../src/server/index.js";
import type { Agents } from "../src/server/agents.js";
import type { ExecutionPool, ExecutionLease, AcquireRequest } from "../src/server/execution-pool.js";
import type { PreparedEnvironment } from "../src/server/execution-profile.js";
import type { Tasks } from "../src/server/tasks.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check: () => boolean, message: string, ms = 45000) => {
  const end = Date.now() + ms;
  while (!check()) { if (Date.now() > end) throw Error(message); await delay(25); }
};
const selection = { provider: "recovery-fixture", id: "fixture", thinking: "off" as const };
function owner(store: Store, root: string) {
  const w = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: root, authorized: true } }) as Workspace;
  const s = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: w.id }) as Session;
  return { workspaceId: w.id, sessionId: s.id };
}

test("restart retains only undispatched task inputs, FIFO and deadlines across repeated crashes", async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "axiom-recovery-queue-")));
  let store = new Store(root);
  let scheduler: TaskScheduler | undefined;
  try {
    const scope = owner(store, root), records = new TaskRecords(store);
    const ids = records.create(scope, "anchor", "context", [{ task: "first" }, { task: "second" }], selection).taskIds;
    const row = records.rows("WHERE id=?", ids[0])[0];
    const inputs = records.inputs(row, "queued");
    store.db.prepare("UPDATE tasks SET workDeadlineAt=12345,summaryDeadlineAt=23456 WHERE id=?").run(row.id);
    store.db.prepare("INSERT INTO task_input_images VALUES(?,?)").run(inputs[0].id, JSON.stringify([{ data: "fixture", mimeType: "image/png" }]));
    store.db.prepare("INSERT INTO task_input_skills VALUES(?,?)").run(inputs[0].id, JSON.stringify([{ name: "fixture", path: "/fixture/SKILL.md" }]));
    const uncertain = records.queue(row.id, "must not replay", "steer");
    store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES('unknown-run',?,'failed',?,?)").run(row.sessionId, JSON.stringify(selection), Date.now());
    store.db.prepare("UPDATE task_inputs SET state='inflight',runId='unknown-run' WHERE id=?").run(uncertain);
    const order = store.db.prepare("SELECT * FROM task_queue_order ORDER BY seq").all();
    store.close(); store = new Store(root);
    const first = store.recoveries.get(row.sessionId)!;
    assert.equal(first.kind, "queue");
    assert.equal(JSON.parse(first.payload).length, 1);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM task_inputs").get()!.n, 0);
    store.close(); store = new Store(root); // Crash before coordinator dispatch.
    assert.equal(store.recoveries.get(row.sessionId)!.payload, first.payload);
    const restored = new TaskRecords(store);
    const agents = { store, publish: () => {}, info: () => ({ selection, run: null }), active: () => false, executing: () => false, stop: async () => {}, assertContinuation: () => {} } as unknown as Agents;
    const delivery = new TaskDelivery(agents, restored); delivery.pause();
    scheduler = new TaskScheduler(agents, restored, delivery); scheduler.kick = () => {};
    const recovery = store.recoveries.get(row.sessionId)!;
    scheduler.recover(restored.rows("WHERE id=?", row.id)[0], recovery);
    scheduler.recover(restored.rows("WHERE id=?", row.id)[0], recovery);
    const current = restored.rows("WHERE id=?", row.id)[0];
    assert.equal(current.status, "queued");
    assert.equal(current.workDeadlineAt, 12345); assert.equal(current.summaryDeadlineAt, 23456);
    assert.deepEqual(store.db.prepare("SELECT * FROM task_queue_order ORDER BY seq").all(), order);
    assert.equal(restored.inputs(current, "queued").length, 1, "same intention does not duplicate an input");
    assert.equal(restored.inputs(current, "queued")[0].id, inputs[0].id);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM task_input_images").get()!.n, 1);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM task_input_skills").get()!.n, 1);
    scheduler.cancel(current, {}, "user");
    assert.equal(store.recoveries.get(row.sessionId), undefined, "user stop cancels durable intention");
  } finally {
    if (scheduler) { scheduler.closing = true; await delay(20); }
    store.close(); rmSync(root, { recursive: true, force: true });
  }
});

test("startup excludes stopping and failed runs, and blocks unauthorized recovery without dispatch", async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "axiom-recovery-boundary-")));
  let store = new Store(root);
  let coordinator: ServiceRecoveryCoordinator | undefined;
  try {
    const scope = owner(store, root);
    const createRun = (status: string) => {
      const s = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: scope.workspaceId }) as Session;
      const id = randomUUID();
      store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,?,?,?)").run(id, s.id, status, JSON.stringify(selection), Date.now());
      return { ...scope, sessionId: s.id };
    };
    const active = createRun("running"), stopping = createRun("stopping"), failed = createRun("failed"), completed = createRun("completed");
    store.close(); store = new Store(root);
    assert.equal(store.recoveries.get(active.sessionId)?.kind, "resume");
    for (const item of [stopping, failed, completed]) assert.equal(store.recoveries.get(item.sessionId), undefined);
    store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id=?").run(scope.workspaceId);
    let dispatched = 0;
    const agents = { store, publish: () => {} } as unknown as Agents;
    const tasks = { command: () => { dispatched++; }, recover: () => { dispatched++; } } as unknown as Tasks;
    coordinator = new ServiceRecoveryCoordinator(agents, tasks);
    (coordinator as unknown as { tick(): void }).tick();
    assert.equal(dispatched, 0);
    assert.equal(store.recoveries.get(active.sessionId)?.state, "blocked");
    assert.match(store.recoveries.get(active.sessionId)!.error!, /授权/);
  } finally {
    await coordinator?.close(); store.close(); rmSync(root, { recursive: true, force: true });
  }
});

test("ten interrupted sessions reconnect serially without an active-run cap; stopped and terminal runs stay stopped", { timeout: 240000 }, async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "axiom-service-recovery-"))), project = join(root, "project");
  const previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi"); mkdirSync(project); mkdirSync(join(root, "pi"));
  let hold = true, hits = 0;
  const requests: any[] = [];
  const pending = new Set<ServerResponse>();
  const reply = (res: ServerResponse) => {
    pending.delete(res); if (res.destroyed) return;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const [delta, finish_reason] of [[{ role: "assistant", content: "fixture recovered" }, null], [{}, "stop"]])
      res.write(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  };
  const fixture = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (replyToFixtureTitle(body, res)) return;
    hits++; requests.push(body);
    if (JSON.stringify(body.messages).includes("fixture-fail-auth")) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "invalid api key", type: "authentication_error" } })); return;
    }
    if (hold) { pending.add(res); res.on("close", () => pending.delete(res)); }
    else reply(res);
  });
  await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
  writeFileSync(join(root, "pi", "models.json"), JSON.stringify({ providers: { "recovery-fixture": { api: "openai-completions", baseUrl: `http://127.0.0.1:${(fixture.address() as any).port}/v1`, models: [{ id: "fixture", name: "Fixture", contextWindow: 32000, maxTokens: 1000 }] } } }));
  writeFileSync(join(root, "pi", "auth.json"), JSON.stringify({ "recovery-fixture": { type: "api_key", key: "local-only" } }));
  writeFileSync(join(root, "pi", "settings.json"), JSON.stringify({ retry: { enabled: false, provider: { maxRetries: 0 } }, compaction: { enabled: false }, cacheWarming: "off" }));
  let app: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    app = await startServer({ root, port: 0 });
    const workspace = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
    const create = async (text: string) => {
      const s = app!.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
      const scope = { workspaceId: workspace.id, sessionId: s.id };
      await app!.tasks.command({ requestId: randomUUID(), op: "agent.model", ...scope, params: { selection } });
      const receipt = await app!.tasks.command({ requestId: randomUUID(), op: "prompt", ...scope, params: { text } }) as { runId: string };
      return { scope, runId: receipt.runId };
    };
    // Ten genuine in-flight workers; shutdown must persist their recovery intent.
    const batch: Array<{ scope: Scope; runId: string }> = [];
    for (let i = 0; i < 10; i++) batch.push(await create(`fixture interrupted ${i}`));
    await until(() => pending.size === 10, "initial workers did not reach fixture");
    const stopped = await create("fixture user stopped");
    await app.tasks.command({ requestId: randomUUID(), op: "agent.stop", ...stopped.scope, params: { runId: stopped.runId } });
    const failed = await create("fixture-fail-auth");
    await until(() => app!.agents.info(failed.scope).run?.status === "failed", "auth failure not terminal");
    hold = false;
    const completed = await create("fixture already complete");
    await until(() => app!.agents.info(completed.scope).run?.status === "completed", "completion missing");
    hold = true;
    await app.close(); app = undefined;
    const before = hits;
    app = await startServer({ root, port: 0 });
    assert.equal(app.store.recoveries.pending().length, 10);
    await app.close(); app = undefined; // A second restart before the delay must retain all ten.
    assert.equal(hits, before);
    app = await startServer({ root, port: 0 });
    await until(() => hits >= before + 10, "automatic recovery stopped before reconnecting all ten held sessions", 90000);
    assert.equal(hits, before + 10, "running recovered sessions must not consume recovery slots");
    hold = false; for (const res of [...pending]) reply(res);
    await until(() => batch.every(item => app!.agents.info(item.scope).run?.status === "completed"), "batch did not finish automatically", 90000);
    assert.equal(hits, before + 10, "one request per recovered session, no duplicate dispatch");
    for (const item of batch) {
      assert.equal(app.agents.info(item.scope).run?.resumedFromRunId, item.runId);
      assert.equal(app.store.recoveries.get(item.scope.sessionId), undefined);
      assert.equal(app.agents.messages(item.scope).filter(m => m?.role === "user").length, 1);
    }
    for (const item of [stopped, failed, completed]) assert.equal(app.agents.info(item.scope).run?.id, item.runId);
    assert.equal(app.agents.info(stopped.scope).run?.status, "cancelled");
    await app.close(); app = await startServer({ root, port: 0 });
    await delay(2500); assert.equal(hits, before + 10, "completed recovery cannot revive on another restart");

    // Real child scheduling: one running child, one untouched queued child and
    // one additional requirement accepted but provably never handed off.
    hold = true;
    const parent = await create("fixture parent waiting for children");
    const records = new TaskRecords(app.store);
    app.store.db.prepare("INSERT INTO task_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(JSON.stringify({ concurrency: 1, workMs: 60000 }));
    const children = records.create(parent.scope, "recovery-children", "fixture child context", [{ task: "fixture running child" }, { task: "fixture queued child" }], selection).taskIds;
    const first = records.rows("WHERE id=?", children[0])[0];
    await app.tasks.command({ requestId: randomUUID(), op: "prompt", workspaceId: first.workspaceId, sessionId: first.sessionId, params: { text: "fixture child extra before launch" } });
    await until(() => app!.tasks.child({ workspaceId: first.workspaceId, sessionId: first.sessionId })?.status === "running" && pending.size === 2, "parent and child did not start");
    const childRun = app.agents.info({ workspaceId: first.workspaceId, sessionId: first.sessionId }).run!.id;
    const deadline = records.rows("WHERE id=?", first.id)[0].workDeadlineAt;
    const additions = [
      records.queue(first.id, "fixture undispatched requirement survives restart", "steer"),
      records.queue(first.id, "fixture second undispatched requirement survives restart", "followUp"),
    ];
    await app.close(); app = undefined;
    const restartRequest = requests.length;
    app = await startServer({ root, port: 0 });
    await until(() => pending.size === 3, "both children and parent must reconnect despite concurrency=1 and unfinished child work", 90000);
    assert.equal(app.agents.info(parent.scope).run?.resumedFromRunId, parent.runId);
    hold = false; for (const res of [...pending]) reply(res);
    await until(() => children.every(id => app!.store.db.prepare("SELECT status FROM tasks WHERE id=?").get(id)?.status === "completed") && app!.agents.info(parent.scope).run?.status === "completed", "child queue and parent did not recover automatically", 90000);
    assert.equal(app.agents.info({ workspaceId: first.workspaceId, sessionId: first.sessionId }).run?.resumedFromRunId, childRun);
    assert.equal(app.store.db.prepare("SELECT workDeadlineAt FROM tasks WHERE id=?").get(first.id)!.workDeadlineAt, deadline, "recovery does not extend the original child budget");
    assert.ok(app.store.db.prepare("SELECT 1 FROM runs WHERE sessionId=? AND resumedFromRunId=?").get(parent.scope.sessionId, parent.runId));
    const recovered = requests.slice(restartRequest).filter(request => JSON.stringify(request.messages).includes("fixture running child"));
    assert.equal(recovered.length, 1, "recovery must include all saved additions in its first request, not send a later turn");
    const text = JSON.stringify(recovered[0].messages);
    const requirements = ["fixture undispatched requirement survives restart", "fixture second undispatched requirement survives restart"];
    assert.ok(text.indexOf(requirements[0]) >= 0 && text.indexOf(requirements[1]) > text.indexOf(requirements[0]), "saved additions must remain FIFO");
    for (const requirement of requirements) assert.equal(text.split(requirement).length - 1, 1);
    for (const id of additions) assert.equal(app.store.db.prepare("SELECT state FROM task_input_receipts WHERE inputId=?").get(id)?.state, "delivered");
    assert.equal(app.store.recoveries.pending().length, 0);

    // Real worker loss uses the same durable queue without restarting the service.
    hold = true;
    const runtime = await create("fixture runtime disconnect");
    await until(() => pending.size === 1, "runtime worker did not reach fixture");
    const runtimeHits = hits;
    const oldWorker = (app.agents as any).runs.live.get(runtime.scope.sessionId).child;
    const pool = (app.agents as any).pool as ExecutionPool;
    await pool.trim();
    const held: ExecutionLease[] = [];
    let vacancy: Promise<ExecutionLease> | undefined;
    try {
      // Reserve capacity without spawning fixture workers. A queued ordinary
      // waiter fills the old worker's slot before recovery can acquire it.
      const environment = { profileHash: "capacity-fixture", entry: "memory", reuse: "single-use", prewarmAllowed: false,
        current: () => true, snapshotValid: () => true, retain() {}, release() {} } as unknown as PreparedEnvironment;
      const acquire = (extra: Partial<AcquireRequest> = {}) => pool.acquire({ environment, kind: "agent",
        signal: new AbortController().signal, requestStartedAtMonoMs: performance.now(), ...extra });
      for (let i = 1; i < pool.limits.maxLiveProcesses - pool.limits.nestedLeafReserve; i++) held.push(await acquire());
      held.push(await acquire({ kind: "memory-query", parentLease: held[0].ref }));
      vacancy = acquire(); void vacancy.catch(() => {});
      // Parent-side disconnect() lacks Node 22's IPC EOF close accounting.
      // Kill the real worker instead: the owner must actually exit before reuse.
      oldWorker.kill("SIGKILL");
      held.push(await vacancy); vacancy = undefined;
      assert.equal(pool.stats().total, pool.limits.maxLiveProcesses);
      const runCount = app.store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE sessionId=?").get(runtime.scope.sessionId)!.n;
      await until(() => !!app!.store.recoveries.get(runtime.scope.sessionId)?.error?.includes("执行资源暂不可用"),
        "full capacity must return the current recovery attempt to pending", 15000);
      assert.equal(app.agents.active(runtime.scope), false, "busy recovery releases its startup owner");
      assert.equal(app.store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE sessionId=?").get(runtime.scope.sessionId)!.n, runCount,
        "busy recovery must not create a durable run");
      assert.equal(pool.stats().queued, 0, "busy recovery must not remain in the physical wait queue");
      assert.equal(hits, runtimeHits, "capacity busy must not dispatch another model request");
      const idle = app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: runtime.scope.workspaceId }) as Session;
      app.store.db.prepare("INSERT INTO service_recoveries(sessionId,runId,kind,createdAt) VALUES(?,NULL,'notify',?)").run(idle.id, Date.now());
      await until(() => !app!.store.recoveries.get(idle.id), "a busy recovery must not hold the coordinator's only slot", 15000);
      assert.ok(app.store.recoveries.get(runtime.scope.sessionId), "the busy intention remains available for retry");
    } finally {
      await Promise.all(held.map(lease => pool.retire(lease.ref, "fixture_release")));
      if (vacancy) await vacancy.then(lease => pool.retire(lease.ref, "fixture_release"), () => {});
    }
    await until(() => app!.agents.info(runtime.scope).run?.resumedFromRunId === runtime.runId && pending.size === 1 && hits === runtimeHits + 1,
      "disconnected worker did not reconnect automatically");
    assert.notEqual(oldWorker.exitCode ?? oldWorker.signalCode, null, "old owner exits before replacement");
    assert.equal(hits, runtimeHits + 1, "runtime interruption starts exactly one continuation");
    hold = false; for (const res of [...pending]) reply(res);
    await until(() => app!.agents.info(runtime.scope).run?.status === "completed", "runtime continuation did not finish");
    assert.equal(app.agents.messages(runtime.scope).filter(m => m?.role === "user").length, 1);
    assert.equal(app.store.recoveries.get(runtime.scope.sessionId), undefined);
  } finally {
    await app?.close(); fixture.closeAllConnections(); await new Promise<void>(resolve => fixture.close(() => resolve()));
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
