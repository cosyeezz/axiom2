import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Store } from "../src/server/storage.js";
import { Agents } from "../src/server/agents.js";
import { ModelService } from "../src/server/model-service.js";
import { TaskRecords, target } from "../src/server/tasks/records.js";
import { TaskDelivery } from "../src/server/tasks/delivery.js";
import { TaskScheduler } from "../src/server/tasks/scheduler.js";
import type { Run, Selection } from "../src/shared/agent.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const gate = () => { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); return { promise, release }; };
async function until(check: () => boolean) {
  const end = Date.now() + 10000;
  while (!check()) { assert.ok(Date.now() < end, "barrier timed out"); await new Promise(r => setTimeout(r, 10)); }
}
function fixture(real = false, count = 1) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "axiom-subagent-fixes-")));
  const pi = join(root, "pi"); mkdirSync(pi);
  const previous = process.env.AXIOM_PI_DIR;
  if (real) process.env.AXIOM_PI_DIR = pi;
  const selection: Selection = { provider: "subagent-fixes", id: "fixture", thinking: "off" };
  writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: { [selection.provider]: {
    api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", models: [{ id: "fixture", contextWindow: 32000, maxTokens: 1000 }],
  } } }));
  writeFileSync(join(pi, "auth.json"), JSON.stringify({ [selection.provider]: { type: "api_key", key: "loopback-only" } }));
  const store = new Store(root);
  const w = store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: root, authorized: true } }) as Workspace;
  const s = store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: w.id }) as Session;
  const scope = { workspaceId: w.id, sessionId: s.id }, models = new ModelService(root);
  const records = new TaskRecords(store), published: string[] = [];
  const ids = records.create(scope, "anchor", "context", Array.from({ length: count }, (_, i) => ({ task: `task${i}`, role: "" })), selection).taskIds;
  let live: Run | null = null;
  const agents = real ? new Agents(store, models, scope => published.push(scope)) : {
    store, info: () => ({ selection, run: live }), active: () => !!live && ["starting", "running", "stopping"].includes(live.status),
    thread: () => { throw Error("scheduler must not eagerly build history"); }, publish: (scope: string) => published.push(scope),
    signal: () => true, assertContinuation: () => {}, stop: async () => {}, recallIds: async () => [], setQueue: () => {},
  } as unknown as Agents;
  const delivery = new TaskDelivery(agents, records); delivery.pause();
  const scheduler = new TaskScheduler(agents, records, delivery);
  if (!real) scheduler.kick = () => {};
  const row = (id = ids[0]) => records.rows("WHERE id=?", id)[0];
  const activate = () => {
    live = { id: randomUUID(), sessionId: row().sessionId, status: "running", selection, startedAt: Date.now(), endedAt: null, error: null };
    store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,?,?,?)").run(live.id, live.sessionId, live.status, JSON.stringify(selection), live.startedAt);
    records.deliver(row(), records.inputs(row(), "queued").map(i => i.id));
    store.db.prepare("UPDATE tasks SET runId=?,status='running' WHERE id=?").run(live.id, ids[0]);
    return live;
  };
  const receipt = (id: string) => store.db.prepare("SELECT * FROM task_input_receipts WHERE inputId=?").get(id)!;
  let storeClosed = false;
  const closeStore = () => { if (!storeClosed) { store.close(); storeClosed = true; } };
  return { root, store, closeStore, scope, models, records, agents, delivery, scheduler, row, activate, receipt, ids, selection, published,
    close: async () => {
      scheduler.closing = true;
      for (const timer of (scheduler as any).timers.values()) clearTimeout(timer);
      await tick(); await tick();
      if (real) await agents.close();
      await delivery.close(); closeStore();
      if (real) { if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous; }
      rmSync(root, { recursive: true, force: true });
    } };
}

test("unknown input requires worker withdrawal and only acknowledged IDs restore drafts", async () => {
  const f = fixture();
  try {
    const run = f.activate();
    const first = await f.scheduler.append(f.row(), { text: "same text" }, true);
    const second = await f.scheduler.append(f.row(), { text: "same text" }, true);
    for (const input of [first, second]) f.scheduler.event(f.row(), run, { type: "input-error", id: input.inputId, uncertain: true });
    assert.equal(f.receipt(first.inputId).state, "unknown");
    assert.equal((f.scheduler as any).failedInputs.size, 0);
    f.scheduler.event(f.row(), run, { type: "input-accepted", id: first.inputId });
    assert.equal(f.receipt(first.inputId).state, "accepted");
    assert.equal((f.scheduler as any).failedInputs.size, 0);
    let asked: string[] = [];
    f.agents.recallIds = async (_scope, ids) => { asked = ids; return [second.inputId]; };
    const recalled = await f.scheduler.recall(f.row());
    assert.deepEqual(asked, [first.inputId, second.inputId]);
    assert.deepEqual(recalled.ids, [second.inputId]); assert.equal(recalled.drafts.length, 1);
    assert.equal(f.receipt(first.inputId).state, "accepted");
    assert.equal(f.receipt(second.inputId).state, "cancelled");
    f.agents.recallIds = async () => [];
    assert.equal((await f.scheduler.recall(f.row())).drafts.length, 0);
  } finally { await f.close(); }
});

test("late acceptance clears failed markers; delivery dominates errors and old-run events", async () => {
  const f = fixture();
  try {
    const run = f.activate(), input = await f.scheduler.append(f.row(), { text: "original" }, true);
    f.scheduler.event(f.row(), run, { type: "input-error", id: input.inputId, error: "rejected" });
    assert.equal((f.scheduler as any).failedInputs.size, 1);
    f.scheduler.event(f.row(), run, { type: "input-accepted", id: input.inputId });
    assert.equal((f.scheduler as any).failedInputs.size, 0);
    assert.equal(f.receipt(input.inputId).state, "accepted");
    f.scheduler.event(f.row(), run, { type: "input-error", id: input.inputId, uncertain: true });
    assert.equal(f.receipt(input.inputId).state, "accepted");
    let recalls = 0;
    f.agents.recallIds = async () => { recalls++; return []; };
    assert.equal((await f.scheduler.recall(f.row())).drafts.length, 0); assert.equal(recalls, 1);
    f.scheduler.event(f.row(), run, { type: "delivered", ids: [input.inputId] });
    for (const event of [{ type: "input-error", id: input.inputId }, { type: "input-error", id: input.inputId, uncertain: true }, { type: "input-accepted", id: input.inputId }])
      f.scheduler.event(f.row(), run, event);
    assert.equal(f.receipt(input.inputId).state, "delivered"); assert.equal(f.row().error, null);
    const next = await f.scheduler.append(f.row(), { text: "next" }, true);
    const budget = f.row().budgetRevision, deadline = f.row().workDeadlineAt;
    for (const type of ["input-error", "input-accepted", "delivered"])
      f.scheduler.event(f.row(), { ...run, id: "old-run" }, { type, id: next.inputId, ids: [next.inputId], uncertain: true });
    assert.equal(f.receipt(next.inputId).state, "queued");
    assert.equal(f.receipt(next.inputId).runId, run.id);
    assert.equal(f.row().budgetRevision, budget); assert.equal(f.row().workDeadlineAt, deadline); assert.equal(f.row().error, null);
  } finally { await f.close(); }
});

test("deleted noneditable input with late acceptance settles unknown, without poisoning the run", async () => {
  const f = fixture();
  try {
    const run = f.activate(), input = await f.scheduler.append(f.row(), { text: "late" });
    f.scheduler.event(f.row(), run, { type: "input-error", id: input.inputId, error: "old error" });
    assert.equal(f.records.inputs(f.row(), "inflight").length, 0);
    f.scheduler.event(f.row(), run, { type: "input-accepted", id: input.inputId });
    run.status = "completed"; run.endedAt = Date.now();
    f.scheduler.settle(f.row(), run);
    assert.equal(f.receipt(input.inputId).state, "unknown"); assert.equal(f.row().error, null);
    assert.equal(f.records.list(f.scope).tasks[0].results.length, 1);
    assert.equal((f.scheduler as any).handed.size, 0);
  } finally { await f.close(); }
});

for (const persisted of [false, true]) test(`restart retains unknown without replay; durable evidence=${persisted}`, async () => {
  const f = fixture(); let reopened: Store | undefined;
  try {
    const run = f.activate(), input = await f.scheduler.append(f.row(), { text: "pending" });
    f.scheduler.event(f.row(), run, { type: "input-error", id: input.inputId, uncertain: true });
    if (persisted) {
      const manager = SessionManager.create(f.root, join(f.root, "sessions"));
      manager.appendMessage({ role: "user", content: "initial", timestamp: 1 });
      manager.appendCustomMessageEntry("axiom-append", "pending", true, { axiomInput: input.inputId });
      manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "evidence" }], timestamp: 2, stopReason: "stop", axiomRunId: run.id } as any);
      f.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET file=excluded.file").run(run.sessionId, manager.getSessionFile()!);
    }
    for (const timer of (f.scheduler as any).timers.values()) clearTimeout(timer);
    await tick(); f.closeStore();
    reopened = new Store(f.root);
    const records = new TaskRecords(reopened);
    const agents = { store: reopened } as Agents;
    const delivery = new TaskDelivery(agents, records);
    const row = records.rows("WHERE id=?", f.ids[0])[0];
    delivery.reconcileInputs(row);
    assert.equal(reopened.db.prepare("SELECT state FROM task_input_receipts WHERE inputId=?").get(input.inputId)!.state, persisted ? "delivered" : "unknown");
    assert.equal(reopened.db.prepare("SELECT COUNT(*) AS n FROM task_inputs").get()!.n, 0);
    assert.equal(reopened.db.prepare("SELECT COUNT(*) AS n FROM runs").get()!.n, 1);
  } finally {
    reopened?.close();
    await f.close();
  }
});

test("input validation precedes budget refresh; confirmed send failure keeps the accepted clock", async () => {
  const f = fixture();
  try {
    f.activate(); const initial = f.row().budgetRevision;
    const before = { deadline: f.row().workDeadlineAt, status: f.row().status, count: f.store.db.prepare("SELECT COUNT(*) AS n FROM task_inputs").get()!.n };
    for (const params of [{ text: "x", mode: "followUp" }, { text: "x".repeat(12001) }, { text: "x", images: [{ invalid: true }] }]) {
      await assert.rejects(f.scheduler.append(f.row(), params));
      assert.equal(f.row().budgetRevision, initial);
      assert.deepEqual({ deadline: f.row().workDeadlineAt, status: f.row().status, count: f.store.db.prepare("SELECT COUNT(*) AS n FROM task_inputs").get()!.n }, before);
    }
    let sends = 0;
    f.agents.signal = (_scope, _run, input) => { if (input.type === "input") sends++; return false; };
    const path = join(f.root, "attachment.txt"); writeFileSync(path, "fixture");
    await assert.rejects(f.scheduler.append(f.row(), { text: "accepted then rejected [file1]", attachments: [{ id: "file1", name: "attachment.txt", kind: "file", path, text: "" }] }, true), { code: "INPUT_NOT_DELIVERED" });
    assert.ok(f.row().budgetRevision! > initial!); assert.ok(f.row().workDeadlineAt! > Date.now());
    assert.equal(f.row().status, "running"); assert.equal(f.row().error, null);
    const result = await f.scheduler.recall(f.row());
    assert.equal(result.drafts[0].text, "accepted then rejected [file1]");
    assert.equal(result.drafts[0].attachments?.[0].path, path);
    assert.equal((await f.scheduler.recall(f.row())).drafts.length, 0);
    assert.equal(sends, 1);
    assert.equal((f.scheduler as any).handed.size, 0); assert.equal((f.scheduler as any).failedInputs.size, 0); assert.equal(f.records.drafts.size, 0);
  } finally { await f.close(); }
});

for (const action of ["capacity", "cancel", "parent-stop", "recall"] as const)
  test(`real pool resource wait preserves scheduler ownership through ${action}`, async () => {
    const f = fixture(true, 4), pool = f.agents.pool;
    pool.limits.maxLiveProcesses = 2; pool.limits.nestedLeafReserve = 1;
    pool.limits.targetReadyTotal = 0;
    const environment = (f.agents as any).profiles.prepare({ entry: "agent", cwd: f.root,
      modelDir: join(f.root, "pi"), modelsRaw: readFileSync(join(f.root, "pi", "models.json"), "utf8"),
      selection: f.selection, taskRole: "resource blocker", mode: "managed" });
    const blocker = await pool.acquire({ environment, kind: "agent", signal: new AbortController().signal,
      requestStartedAtMonoMs: performance.now() });
    const launches: string[] = [];
    (f.agents as any).runs.launchWorker = async (_scope: unknown, run: Run, input: any, lease: any) => {
      launches.push(run.sessionId);
      assert.equal(input.task.budget.deadlineAt, run.startedAt + 600000, "work budget starts at activation, before cold binding");
      await pool.retire(lease.ref, "admission_test");
    };
    const settings = (concurrency: number) => f.store.db.prepare("INSERT OR REPLACE INTO task_settings VALUES(1,?)")
      .run(JSON.stringify({ concurrency, workMs: 600000 }));
    try {
      settings(4);
      const head = f.row(), firstInput = f.records.inputs(head, "queued")[0];
      if (action === "recall") f.records.drafts.set(firstInput.id, { text: "withdraw before binding", attachment: null });
      f.scheduler.kick();
      await until(() => pool.stats().queued === 4);
      assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM runs").get()!.n, 0);
      assert.ok(f.records.rows().every(row => row.status === "queued" && row.workStartedAt === null && row.workDeadlineAt === null));
      if (action === "capacity") { settings(1); f.scheduler.preferencesChanged(); }
      if (action === "cancel") f.scheduler.cancel(head, { reason: "cancel resource wait" });
      if (action === "parent-stop") { f.records.freeze(f.scope); await f.scheduler.stop(f.records.rows(), "stop resource wait"); }
      if (action === "recall") assert.deepEqual((await f.scheduler.recall(head)).ids, [firstInput.id]);
      await pool.retire(blocker.ref, "release_resource");
      await until(() => (f.scheduler as any).launching.size === 0 && (f.scheduler as any).jobs.size === 0);
      if (action === "capacity") {
        assert.deepEqual(launches, [head.sessionId]);
        assert.equal(f.records.rows("WHERE status='queued'").length, 3);
        assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM task_results").get()!.n, 0);
        assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM runs").get()!.n, 1);
        settings(4); f.scheduler.preferencesChanged();
        await until(() => launches.length === 4 && (f.scheduler as any).launching.size === 0);
        assert.deepEqual(launches, f.ids.map(id => f.row(id).sessionId));
      } else {
        assert.deepEqual(launches, action === "parent-stop" ? [] : f.ids.slice(1).map(id => f.row(id).sessionId));
        if (action === "recall") assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM runs WHERE sessionId=?").get(head.sessionId)!.n, 0);
      }
      assert.equal(pool.stats().total, 0); assert.equal(pool.stats().queued, 0);
      assert.equal((f.agents as any).starts.size, 0);
      assert.equal((f.agents as any).runs.pending.size, 0);
    } finally { await pool.retire(blocker.ref, "cleanup"); environment.release(); await f.close(); }
  });

test("final capacity gate preserves FIFO through 4→1→4 without failed pseudo-runs or spinning", async () => {
  const f = fixture(true, 4), barrier = gate();
  let reads = 0;
  const raw = f.models.raw.bind(f.models);
  f.models.raw = async () => { reads++; if (reads === 1) await barrier.promise; return raw(); };
  const launches: string[] = [];
  (f.agents as any).runs.launchWorker = async (_scope: unknown, run: Run) => { launches.push(run.sessionId); };
  const settings = (concurrency: number) => f.store.db.prepare("INSERT OR REPLACE INTO task_settings VALUES(1,?)").run(JSON.stringify({ concurrency, workMs: 600000 }));
  try {
    f.scheduler.kick(); await until(() => reads === 1);
    settings(1); f.scheduler.preferencesChanged(); barrier.release();
    await until(() => (f.scheduler as any).launching.size === 0);
    assert.deepEqual(launches, [f.row(f.ids[0]).sessionId]);
    assert.equal(f.records.rows("WHERE status='queued'").length, 3);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM task_results").get()!.n, 0);
    const stable = reads;
    for (let i = 0; i < 100; i++) f.scheduler.kick();
    await tick(); await tick(); assert.equal(reads, stable, "capacity deferral must not busy-loop");
    settings(4); f.scheduler.preferencesChanged();
    await until(() => launches.length === 4 && (f.scheduler as any).launching.size === 0);
    assert.deepEqual(launches, f.ids.map(id => f.row(id).sessionId));
    settings(1); f.scheduler.preferencesChanged();
    assert.equal(f.records.rows("WHERE status='starting'").length, 4, "decrease does not stop admitted tasks");
  } finally { barrier.release(); await f.close(); }
});

test("a slow append ACK does not hold the configuration lock; duplicate commands retain durable identity", async () => {
  const f = fixture(true, 2), barrier = gate(), runtime = (f.agents as any).runs;
  const first = target(f.row()), second = target(f.row(f.ids[1]));
  let enqueues = 0, launches = 0;
  runtime.active = (scope: any) => scope.sessionId === first.sessionId;
  runtime.enqueue = async () => { enqueues++; await barrier.promise; return { status: "queued" }; };
  runtime.launchWorker = async () => { launches++; };
  const command = { op: "prompt", requestId: randomUUID(), ...first, params: { text: "slow acknowledgement" } };
  try {
    const pending = f.agents.command(command); await until(() => enqueues === 1);
    assert.equal(f.store.receipt(command.requestId).status, "pending");
    await assert.rejects(f.agents.command(command), { code: "UNCERTAIN" });
    const next = f.agents.command({ op: "prompt", requestId: randomUUID(), ...second, params: { text: "independent" } }, { task: { id: f.ids[1], role: "", inputIds: [] } });
    await until(() => launches === 1); await next;
    assert.equal(enqueues, 1); barrier.release(); await pending;
    await f.agents.command(command); assert.equal(enqueues, 1);
  } finally { barrier.release(); await f.close(); }
});

test("pending startup is visible outside the configuration lock and stop prevents its handoff", async () => {
  const f = fixture(true, 2), barrier = gate(), runtime = (f.agents as any).runs;
  const first = target(f.row()), second = target(f.row(f.ids[1]));
  let entered = false, secondStarted = false;
  runtime.launchWorker = async (scope: any) => {
    const epoch = runtime.epoch(scope);
    if (scope.sessionId === first.sessionId) { entered = true; await barrier.promise; runtime.assertEpoch(scope, epoch); }
    else secondStarted = true;
  };
  try {
    const pending = f.agents.command({ op: "prompt", requestId: randomUUID(), ...first, params: { text: "first" } }, { task: { id: f.ids[0], role: "", inputIds: [] } });
    const rejected = assert.rejects(pending, { code: "AGENT_STOPPED" });
    await until(() => entered);
    assert.equal(runtime.pending.size, 1);
    await f.agents.command({ op: "prompt", requestId: randomUUID(), ...second, params: { text: "second" } }, { task: { id: f.ids[1], role: "", inputIds: [] } });
    assert.equal(secondStarted, true);
    const stopped = f.agents.stop(first); barrier.release(); await stopped; await rejected;
    assert.equal(runtime.pending.size, 0);
    assert.equal(f.agents.info(first).run?.status, "cancelled");
  } finally { barrier.release(); await f.close(); }
});

test("queue identity deduplicates repeats, preserves partitions/order/mode and coalesces current views", async () => {
  const f = fixture();
  try {
    const run = f.activate();
    const input = await f.scheduler.append(f.row(), { text: "draft" }, true);
    await tick(); f.published.length = 0;
    let queues = 0; f.agents.setQueue = () => { queues++; };
    const event = { type: "queue", queue: [{ id: input.inputId, mode: "steer" }], native: [] };
    for (let i = 0; i < 100; i++) f.scheduler.event(f.row(), run, event);
    assert.equal(queues, 1); await tick();
    assert.deepEqual(f.published, [`agent:${f.row().workspaceId}:${f.row().sessionId}`]);
    f.scheduler.event(f.row(), run, { ...event, queue: [], native: event.queue });
    f.scheduler.event(f.row(), run, { ...event, queue: [{ id: input.inputId, mode: "followUp" }] });
    assert.equal(queues, 3);
    for (const queue of [[], [{ id: "a", mode: "steer" }, { id: "b", mode: "steer" }], [{ id: "b", mode: "steer" }, { id: "a", mode: "steer" }]]) {
      const previous: number = queues;
      for (let i = 0; i < 100; i++) f.scheduler.event(f.row(), run, { type: "queue", queue, native: [] });
      assert.equal(queues, previous + 1, "empty/order projections change once and suppress subsequent repeats");
    }
    f.scheduler.event(f.row(), run, { type: "input-accepted", id: input.inputId });
    f.scheduler.event(f.row(), run, { type: "delivered", ids: [input.inputId] });
    await tick(); assert.equal(f.receipt(input.inputId).state, "delivered");
    assert.equal(f.published.filter(scope => scope.startsWith("tasks:")).length, 1);
    assert.equal((f.scheduler as any).pendingViews.size, 0);
    run.status = "completed"; run.endedAt = Date.now(); f.scheduler.settle(f.row(), run); await tick();
    assert.equal((f.scheduler as any).nativeQueues.size, 0);
    assert.equal((f.scheduler as any).nativePending.size, 0);
  } finally { await f.close(); }
});

for (const action of ["cancel", "parent-stop", "delete", "prepare-error", "recall"] as const)
  test(`prepared FIFO head ${action} cannot start stale work or block the next candidate`, async () => {
    const f = fixture(true, 2), barrier = gate(); let entered = false;
    const raw = f.models.raw.bind(f.models), launches: string[] = [];
    f.models.raw = async () => {
      if (!entered) { entered = true; await barrier.promise; if (action === "prepare-error") throw Error("preparation fixture failure"); }
      return raw();
    };
    (f.agents as any).runs.launchWorker = async (_scope: unknown, run: Run) => { launches.push(run.sessionId); };
    try {
      const head = f.row(), input = f.records.inputs(head, "queued")[0];
      if (action === "recall") f.records.drafts.set(input.id, { text: "withdraw before handoff", attachment: null });
      f.scheduler.kick(); await until(() => entered);
      for (let i = 0; i < 20; i++) f.scheduler.kick();
      if (action === "cancel" || action === "delete") f.scheduler.cancel(head, { reason: "cancel prepared head" });
      if (action === "delete") f.store.execute({ op: "session.delete", requestId: randomUUID(), ...target(head), params: { confirmed: true } });
      let stopping: Promise<void> | undefined;
      if (action === "parent-stop") { f.records.freeze(f.scope); stopping = f.scheduler.stop(f.records.rows(), "parent stop"); }
      if (action === "recall") assert.deepEqual((await f.scheduler.recall(head)).ids, [input.id]);
      barrier.release(); await stopping;
      await until(() => (f.scheduler as any).launching.size === 0 && (f.scheduler as any).jobs.size === 0);
      assert.deepEqual(launches, action === "parent-stop" ? [] : [f.row(f.ids[1]).sessionId]);
      assert.equal((f.agents as any).runs.pending.size, 0);
      assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM task_results WHERE taskId=?").get(head.id)!.n, action === "recall" ? 0 : 1);
      const savedRuns = f.store.db.prepare("SELECT status FROM runs WHERE sessionId=?").all(head.sessionId);
      assert.equal(savedRuns.length, action === "recall" ? 0 : 1, "unstarted cancellation/failure keeps one terminal report record");
      assert.ok(savedRuns.every(run => ["cancelled", "failed"].includes(String(run.status))), "no live execution is admitted");
    } finally { barrier.release(); await f.close(); }
  });

for (const stop of ["stop", "shutdown", "provider"] as const)
  test(`resource wait frees the config lock and ${stop} prevents pending fork`, async () => {
    const f = fixture(true, 2), barrier = gate(), runtime = (f.agents as any).runs;
    const first = target(f.row()), second = target(f.row(f.ids[1]));
    const acquire = f.agents.pool.acquire.bind(f.agents.pool);
    f.agents.pool.acquire = async request => {
      if (request.affinity?.sessionId === first.sessionId) await barrier.promise;
      return acquire(request);
    };
    let firstDone = false;
    try {
      const firstCommand = { op: "prompt", requestId: randomUUID(), ...first, params: { text: "pending behind retirement" } };
      const pending = f.agents.command(firstCommand, { task: { id: f.ids[0], role: "", inputIds: [] } }).finally(() => { firstDone = true; });
      const rejected = assert.rejects(pending, { code: "AGENT_STOPPED" });
      await until(() => (f.agents as any).starts.has(first.sessionId));
      const pendingStart = (f.agents as any).starts.get(first.sessionId);
      assert.equal(f.agents.info(first).run, null, "resource wait has no activated Run");
      assert.ok(f.agents.affected([f.selection.provider]).some(item => item.sessionId === first.sessionId));
      await f.agents.command({ op: "prompt", requestId: randomUUID(), ...second, params: { text: "independent startup" } }, { task: { id: f.ids[1], role: "", inputIds: [] } });
      assert.ok(runtime.live.get(second.sessionId)?.child.pid, "independent session really forks before retirement releases");
      assert.equal(firstDone, false); assert.equal(runtime.live.has(first.sessionId), false);
      let stopCompleted = false;
      const stopping = (stop === "stop" ? f.agents.stop(first) : stop === "shutdown" ? f.agents.close() : f.agents.stopProviders([f.selection.provider], true))
        .then(() => { stopCompleted = true; });
      await until(() => pendingStart.controller.signal.aborted);
      await tick(); await tick();
      assert.equal(stopCompleted, false, "stop must await preparation cleanup, not merely abort its signal");
      barrier.release(); await stopping; await rejected;
      assert.equal((f.agents as any).starts.has(first.sessionId), false); assert.equal(runtime.live.has(first.sessionId), false);
      assert.equal(f.agents.info(first).run, null);
      assert.equal(readdirSync(join(f.root, "run-models")).length, 0);
    } finally { barrier.release(); await f.close(); }
  });

test("provider stop cancels queued preparation without waiting for the configuration writer", async () => {
  const f = fixture(true), barrier = gate(), scope = target(f.row());
  let writerEntered = false;
  const writer = f.models.serial(async () => { writerEntered = true; await barrier.promise; });
  let rejected: Promise<void> | undefined;
  try {
    await until(() => writerEntered);
    const command = { op: "prompt", requestId: randomUUID(), ...scope, params: { text: "queued behind logout writer" } };
    rejected = assert.rejects(f.agents.command(command, { task: { id: f.ids[0], role: "", inputIds: [] } }), { code: "AGENT_STOPPED" });
    await until(() => (f.agents as any).starts.has(scope.sessionId));
    let stopped = false;
    const stopping = f.agents.stopProviders([f.selection.provider], true).then(() => { stopped = true; });
    await until(() => stopped);
    await stopping; await rejected;
    assert.equal((f.agents as any).starts.size, 0);
    assert.equal(f.agents.pool.stats().total, 0);
    assert.equal(f.store.receipt(command.requestId, scope).status, "failed");
    assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM runs").get()!.n, 0);
    barrier.release(); await writer;
    await f.models.serial(async () => {});
    assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM runs").get()!.n, 0, "cancelled callback cannot later activate a Run");
  } finally { barrier.release(); await writer; await rejected; await f.close(); }
});

test("configuration changes during snapshot preparation reject without a run or retained snapshot", async () => {
  const f = fixture(true), barrier = gate(); let entered = false, launches = 0;
  const raw = f.models.raw.bind(f.models);
  f.models.raw = async () => { entered = true; await barrier.promise; return raw(); };
  (f.agents as any).runs.launchWorker = async () => { launches++; };
  try {
    const pending = f.agents.command({ op: "prompt", requestId: randomUUID(), ...target(f.row()), params: { text: "configuration consistency" } }, { task: { id: f.ids[0], role: "", inputIds: [] } });
    const rejected = assert.rejects(pending, { code: "REVISION_CONFLICT" });
    await until(() => entered);
    const path = join(f.root, "pi", "models.json"), config = JSON.parse(readFileSync(path, "utf8"));
    config.providers[f.selection.provider].models[0].name = "changed behind preparation";
    writeFileSync(path, JSON.stringify(config)); barrier.release(); await rejected;
    assert.equal(launches, 0); assert.equal((f.agents as any).runs.pending.size, 0);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM runs").get()!.n, 0);
    assert.equal(readdirSync(join(f.root, "run-models")).length, 0);
  } finally { barrier.release(); await f.close(); }
});

test("child input queries expose unknown and confirmed delivery using persisted task ownership", async () => {
  const f = fixture(true);
  try {
    const run = f.activate(), scope = target(f.row()), ids = [randomUUID(), randomUUID(), randomUUID()];
    for (const [index, id] of ids.entries()) {
      f.records.queue(f.row().id, "private original body", "steer", [], id);
      await f.store.external({ op: "prompt", requestId: id, ...scope }, async () => ({ inputId: id, runId: run.id }));
      f.records.receipt(id, (["unknown", "failed", "delivered"] as const)[index], "delivery evidence", run.id, f.row().id);
    }
    const before = f.store.db.prepare("SELECT COUNT(*) AS n FROM external_requests").get()!.n;
    const result = await f.agents.command({ op: "agent.inputs", requestId: randomUUID(), ...scope, params: { ids } }) as any[];
    assert.deepEqual(result.map(item => [item.receipt.status, item.consumed]), [["uncertain", false], ["failed", false], ["committed", true]]);
    assert.doesNotMatch(JSON.stringify(result), /private original body/);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM external_requests").get()!.n, before, "queries do not create command receipts");
  } finally { await f.close(); }
});
