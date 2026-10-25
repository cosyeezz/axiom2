import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Store } from "../src/server/storage.js";
import { TaskRecords, target } from "../src/server/tasks/records.js";
import { TaskScheduler } from "../src/server/tasks/scheduler.js";
import { TaskDelivery } from "../src/server/tasks/delivery.js";
import { Agents } from "../src/server/agents.js";
import { ModelService } from "../src/server/model-service.js";
import type { Run, Selection } from "../src/shared/agent.js";
import { AppError, type Workspace, type Session } from "../src/shared/protocol.js";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture() {
  // Match Store's canonical workspace identity across macOS /var aliases and Windows short paths.
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "axiom-task-reliability-"))), store = new Store(root);
  const w = store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: root, authorized: true } }) as Workspace;
  const s = store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: w.id }) as Session;
  const scope = { workspaceId: w.id, sessionId: s.id }, records = new TaskRecords(store);
  const selection: Selection = { provider: "fixture", id: "fixture", thinking: "off" };
  const taskId = records.create(scope, "anchor", "context", [{ task: "first" }], selection).taskIds[0];
  let live: Run | null = null;
  const agents = { store, reloads: { active: () => false }, info: () => ({ selection, run: live }), active: () => !!live && ["starting", "running", "stopping"].includes(live.status),
    executing: () => !!live && ["starting", "running", "stopping"].includes(live.status),
    thread: () => ({ ids: [] }), publish: () => {}, signal: () => true, assertContinuation: () => {}, stop: async () => {},
  } as unknown as Agents;
  const delivery = new TaskDelivery(agents, records); delivery.pause();
  const scheduler = new TaskScheduler(agents, records, delivery);
  scheduler.kick = () => {}; // Drive deterministic transitions; integration tests exercise real launch.
  const row = () => records.rows("WHERE id=?", taskId)[0];
  const activate = () => {
    live = { id: randomUUID(), sessionId: row().sessionId, status: "running", selection, startedAt: Date.now(), endedAt: null, error: null };
    store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,?,?,?)").run(live.id, live.sessionId, live.status, JSON.stringify(selection), live.startedAt);
    records.deliver(row(), records.inputs(row(), "queued").map((input) => input.id));
    store.db.prepare("UPDATE tasks SET runId=?,status='running' WHERE id=?").run(live.id, taskId);
    return live;
  };
  const transcript = (sessionId: string) => {
    const manager = SessionManager.create(root, join(root, "sessions"));
    manager.appendMessage({ role: "user", content: "fixture", timestamp: Date.now() });
    store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET file=excluded.file")
      .run(sessionId, manager.getSessionFile()!);
    return manager;
  };
  return { root, store, scope, records, taskId, row, agents, scheduler, delivery, activate, transcript,
    dispose: async () => { scheduler.closing = true; await tick(); store.close(); rmSync(root, { recursive: true, force: true }); } };
}

function initialDenial(f: ReturnType<typeof fixture>, options: { witness?: boolean; accepted?: boolean; extra?: boolean } = {}) {
  const initial = f.records.inputs(f.row(), "queued")[0];
  const run: Run = { id: randomUUID(), sessionId: f.row().sessionId, status: "starting", selection: f.agents.info(target(f.row())).selection!, startedAt: Date.now(), endedAt: null, error: null };
  f.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,?,?,?)").run(run.id, run.sessionId, run.status, JSON.stringify(run.selection), run.startedAt);
  f.store.db.prepare("UPDATE tasks SET runId=?,status='starting' WHERE id=?").run(run.id, f.taskId);
  f.store.db.prepare("UPDATE task_inputs SET runId=?,state='starting' WHERE id=?").run(run.id, initial.id);
  f.records.receipt(initial.id, options.accepted ? "accepted" : "queued", null, run.id, f.taskId);
  if (options.extra) f.records.queue(f.taskId, "later append", "steer");
  if (options.witness !== false) f.store.rejectBinding(run.id, { check: "auth", secret: "PRIVATE_CANARY" });
  return { run, initial };
}
function initialFailure(f: ReturnType<typeof fixture>, options: Parameters<typeof initialDenial>[1] = {}) {
  const { run, initial } = initialDenial(f, options);
  run.status = "failed"; run.endedAt = Date.now(); run.reasonCode = "BINDING_REJECTED"; run.error = "binding rejected";
  f.store.finishRun(run.id, run.status, run.error, run.reasonCode);
  f.scheduler.settle(f.row(), run);
  return { run, initial };
}

test("coordinator-proven initial rejection resends the exact original delegation on explicit retry, never empty resume", async () => {
  const f = fixture();
  try {
    const { run, initial } = initialFailure(f);
    assert.equal(f.row().status, "failed");
    assert.equal(f.records.list(f.scope).tasks[0].inputs![0].state, "failed");
    assert.deepEqual(f.store.bindingRejection(run.id), { check: "auth" });
    assert.deepEqual({ ...f.records.initialRetry(f.row(), run.id) }, { inputId: initial.id, body: initial.body });
    assert.equal(f.records.inputs(f.row(), "queued").length, 0, "a rejection never schedules its own retry");
    const result = f.scheduler.resume(f.row(), run.id, randomUUID());
    assert.equal(result.inputId, initial.id);
    assert.equal(f.records.initialRetry(f.row(), run.id), undefined, "proof is consumed atomically");
    assert.deepEqual(f.records.inputs(f.row(), "queued").map(input => [input.id, input.mode, input.body, input.runId]), [[initial.id, "steer", initial.body, null]]);
    assert.throws(() => f.scheduler.resume(f.row(), run.id, randomUUID()), { code: "RUN_MISMATCH" });
    let command: any;
    f.agents.command = async (c, internal) => { command = { c, internal }; return {}; };
    await (f.scheduler as any).start(f.row());
    assert.equal(command.c.op, "prompt");
    assert.equal(command.internal.prompt, initial.body);
    assert.deepEqual(command.internal.task.inputIds, [initial.id]);
  } finally { await f.dispose(); }
});

for (const options of [{ witness: false }, { accepted: true }, { extra: true }]) test(`initial replay requires an authoritative denial with no accepted or additional input: ${JSON.stringify(options)}`, async () => {
  const f = fixture();
  try {
    const { run } = initialFailure(f, options);
    assert.equal(f.records.initialRetry(f.row(), run.id), undefined);
    f.agents.messages = () => [];
    assert.throws(() => f.scheduler.resume(f.row(), run.id, randomUUID()), { code: "NO_CONTINUATION" });
    assert.equal(f.records.inputs(f.row(), "queued").length, 0);
  } finally { await f.dispose(); }
});

for (const action of ["append", "cancel", "recall"] as const) test(`${action} invalidates a saved initial replay proof`, async () => {
  const f = fixture();
  try {
    const { run } = initialFailure(f);
    assert.ok(f.records.initialRetry(f.row(), run.id));
    if (action === "append") await f.scheduler.append(f.row(), { text: "new explicit work" });
    else if (action === "cancel") f.scheduler.cancel(f.row(), {});
    else await f.scheduler.recall(f.row());
    assert.equal(f.store.db.prepare("SELECT 1 FROM task_initial_retries WHERE taskId=?").get(f.taskId), undefined);
    if (action === "append") assert.deepEqual(f.records.inputs(f.row(), "queued").map(input => input.body), ["new explicit work"]);
  } finally { await f.dispose(); }
});

test("initial retry proof survives restart but cannot outlive its run, and capacity failure rolls back consumption", async () => {
  const f = fixture(); let reopened: Store | undefined, closed = false;
  try {
    const { run, initial } = initialFailure(f);
    f.scheduler.closing = true; await tick(); f.store.close(); closed = true;
    reopened = new Store(f.root);
    const records = new TaskRecords(reopened), row = () => records.rows("WHERE id=?", f.taskId)[0];
    const scheduler = new TaskScheduler({ ...f.agents, store: reopened } as Agents, records, new TaskDelivery(f.agents, records));
    scheduler.kick = () => {};
    assert.deepEqual({ ...records.initialRetry(row(), run.id) }, { inputId: initial.id, body: initial.body });
    assert.equal(records.initialRetry(row(), "stale-run"), undefined);
    for (let i=0; i<4; i++) records.create(f.scope, `capacity-${i}`, "context", Array.from({ length: 8 }, () => ({ task: "capacity" })), run.selection);
    assert.throws(() => scheduler.resume(row(), run.id, randomUUID()), { code: "TASK_LIMIT" });
    assert.ok(records.initialRetry(row(), run.id), "failed admission did not consume proof");
    assert.equal(records.inputs(row(), "queued").length, 0);
    assert.equal(row().status, "failed");
  } finally { await tick(); reopened?.close(); if (!closed) f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

for (const phase of ["starting", "finished", "receipt"] as const) test(`startup preserves a durable initial denial before settlement at ${phase}`, async () => {
  const f = fixture(); let reopened: Store | undefined, closed = false;
  try {
    const { run, initial } = initialDenial(f);
    if (phase !== "starting") f.store.finishRun(run.id, "failed", "binding rejected", "BINDING_REJECTED");
    if (phase === "receipt") f.records.receipt(initial.id, "failed", "binding rejected", run.id, f.taskId);
    f.scheduler.closing = true; await tick(); f.store.close(); closed = true;
    reopened = new Store(f.root);
    const records = new TaskRecords(reopened), row = () => records.rows("WHERE id=?", f.taskId)[0];
    const agents = { ...f.agents, store: reopened, messages: () => [] } as unknown as Agents;
    const delivery = new TaskDelivery(agents, records); delivery.pause();
    const scheduler = new TaskScheduler(agents, records, delivery); scheduler.kick = () => {};
    const terminal: Run = { ...run, status: "failed", reasonCode: "BINDING_REJECTED", error: "binding rejected", endedAt: Date.now() };
    assert.deepEqual({ ...reopened.db.prepare("SELECT status,reasonCode FROM runs WHERE id=?").get(run.id) }, { status: "failed", reasonCode: "BINDING_REJECTED" });
    assert.equal(row().status, "failed");
    assert.equal(reopened.recoveries.get(row().sessionId), undefined, "a denied initial task is not automatically resumed");
    assert.equal(records.inputs(row(), "queued").length, 0);
    assert.deepEqual({ ...records.initialRetry(row(), run.id) }, { inputId: initial.id, body: initial.body });
    scheduler.settle(row(), terminal, true); // Same startup reconciliation used by the Tasks facade.
    assert.deepEqual({ ...records.initialRetry(row(), run.id) }, { inputId: initial.id, body: initial.body }, "settlement must not erase the startup witness");
    assert.equal(scheduler.resume(row(), run.id, randomUUID()).inputId, initial.id);
    assert.equal(records.initialRetry(row(), run.id), undefined);
    assert.throws(() => scheduler.resume(row(), run.id, randomUUID()), { code: "RUN_MISMATCH" });
    let command: any;
    agents.command = async (c, internal) => { command = { c, internal }; return {}; };
    await (scheduler as any).start(row());
    assert.equal(command.c.op, "prompt"); assert.equal(command.internal.prompt, initial.body);
    assert.deepEqual(command.internal.task.inputIds, [initial.id]);
  } finally { await tick(); reopened?.close(); if (!closed) f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

for (const scenario of ["no_witness", "accepted", "delivered", "cancelled", "stopping", "extra", "images", "skills", "not_initial", "newer_run", "running"] as const)
  test(`startup cannot create initial retry authority for ${scenario}`, async () => {
    const f = fixture(); let reopened: Store | undefined, closed = false;
    try {
      const { run, initial } = initialDenial(f, { witness: scenario !== "no_witness", extra: scenario === "extra" });
      if (scenario === "no_witness") f.store.finishRun(run.id, "failed", "worker self-report", "BINDING_REJECTED");
      if (["accepted", "delivered", "cancelled"].includes(scenario)) f.records.receipt(initial.id, scenario as any, null, run.id, f.taskId);
      if (scenario === "stopping") f.store.db.prepare("UPDATE tasks SET status='stopping' WHERE id=?").run(f.taskId);
      if (scenario === "running") f.store.db.prepare("UPDATE runs SET status='running' WHERE id=?").run(run.id);
      if (scenario === "images") f.store.db.prepare("INSERT INTO task_input_images VALUES(?,?)").run(initial.id, "[{}]");
      if (scenario === "skills") f.store.db.prepare("INSERT INTO task_input_skills VALUES(?,?)").run(initial.id, "[{}]");
      if (scenario === "not_initial") f.store.db.prepare("UPDATE tasks SET initialInputId=? WHERE id=?").run(randomUUID(), f.taskId);
      if (scenario === "newer_run") f.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'completed',?,?)").run(randomUUID(), run.sessionId, JSON.stringify(run.selection), run.startedAt + 1);
      f.scheduler.closing = true; await tick(); f.store.close(); closed = true;
      reopened = new Store(f.root);
      const records = new TaskRecords(reopened), row = records.rows("WHERE id=?", f.taskId)[0];
      assert.equal(reopened.db.prepare("SELECT 1 FROM task_initial_retries WHERE taskId=?").get(f.taskId), undefined);
      assert.equal(records.initialRetry(row, run.id), undefined);
      assert.equal(records.inputs(row, "queued").length, 0);
    } finally { await tick(); reopened?.close(); if (!closed) f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
  });

test("startup never overwrites an already-unknown historical receipt with a service-restart explanation", async () => {
  const f = fixture(); let reopened: Store | undefined, closed = false;
  try {
    const run = f.activate();
    const id = randomUUID(), message = "执行已结束，输入送达未确认；未自动重发。";
    f.store.db.prepare("INSERT INTO task_input_receipts VALUES(?,?,?,'unknown',?,?)").run(id, f.taskId, run.id, message, 123);
    f.scheduler.closing = true; await tick(); f.store.close(); closed = true;
    reopened = new Store(f.root); new TaskRecords(reopened);
    assert.deepEqual({ ...reopened.db.prepare("SELECT state,error,updatedAt FROM task_input_receipts WHERE inputId=?").get(id) }, { state: "unknown", error: message, updatedAt: 123 });
  } finally { await tick(); reopened?.close(); if (!closed) f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("stopping appends survive old settlement, keep frozen parent and join FIFO once", async () => {
  const f = fixture();
  try {
    const run = f.activate(), old = f.row();
    f.records.freeze(f.scope);
    f.scheduler.cancel(old, { reason: "stop" });
    const one = await f.scheduler.append(f.row(), { text: "first new requirement" });
    const two = await f.scheduler.append(f.row(), { text: "second new requirement" });
    assert.equal(f.row().status, "stopping");
    assert.equal(f.records.inputs(f.row(), "waiting").length, 2);
    const second = f.records.create(f.scope, "next", "context", [{ task: "older queue entry" }], run.selection).taskIds[0];
    run.status = "cancelled"; run.endedAt = Date.now();
    f.scheduler.settle(f.row(), run);
    assert.equal(f.row().status, "queued");
    assert.deepEqual(f.records.inputs(f.row(), "queued").map((input) => input.id), [one.inputId, two.inputId]);
    assert.equal(f.records.list(f.scope).frozen, true);
    assert.deepEqual(f.records.rows("JOIN task_queue_order q ON q.taskId=tasks.id WHERE status='queued' ORDER BY q.seq").map((row) => row.id), [second, f.taskId]);
    const result = f.records.list(f.scope).tasks[0].results[0];
    assert.equal(f.delivery.result(f.scope, f.taskId, result.id).stop?.source, "user");
    f.scheduler.settle(old, run); // Duplicate callback must not consume next work.
    assert.equal(f.records.inputs(f.row(), "queued").length, 2);
    const next = f.activate();
    f.scheduler.event(old, run, { type: "input-error", id: one.inputId, error: "stale" });
    f.scheduler.settle(old, run);
    assert.equal(f.row().runId, next.id);
    assert.equal(f.row().status, "running");
    assert.equal(f.row().error, null);
  } finally { await f.dispose(); }
});

test("restart after result commit discards stopping-time inputs and settles their receipts without replay", async () => {
  const f = fixture();
  let reopened: Store | undefined, originalClosed = false;
  try {
    const run = f.activate();
    f.scheduler.cancel(f.row(), { reason: "stop" });
    await tick();
    const input = await f.scheduler.append(f.row(), { text: "waiting across the commit window" });
    run.status = "cancelled"; run.endedAt = Date.now();
    f.store.finishRun(run.id, "cancelled", "stop");
    f.delivery.save(f.row(), run); // Crash before scheduler promotes waiting inputs.
    assert.equal(f.records.inputs(f.row(), "waiting").length, 1);
    const resultId = f.records.list(f.scope).tasks[0].results[0].id;
    f.scheduler.closing = true;
    f.store.close(); originalClosed = true;
    reopened = new Store(f.root);
    const restored = new TaskRecords(reopened);
    assert.equal(reopened.db.prepare("SELECT COUNT(*) AS count FROM task_inputs").get()!.count, 0);
    const task = restored.list(f.scope).tasks[0];
    assert.equal(task.results[0].id, resultId);
    assert.equal(task.inputs!.find(receipt => receipt.inputId === input.inputId)!.state, "failed");
    assert.match(task.inputs!.find(receipt => receipt.inputId === input.inputId)!.error!, /重启.*未自动重放/);
    assert.equal(restored.rows("WHERE status='queued'").length, 0);
  } finally {
    f.scheduler.closing = true;
    await tick();
    reopened?.close();
    if (!originalClosed) f.store.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("a new active parent can retry an old owner's unpersisted notification on its first explicit operation", async () => {
  const f = fixture(), delivery = new TaskDelivery(f.agents, f.records);
  try {
    const run = f.activate(); run.status = "completed"; run.endedAt = Date.now();
    f.scheduler.settle(f.row(), run);
    const resultId = f.records.list(f.scope).tasks[0].results[0].id;
    f.store.db.prepare("UPDATE task_results SET delivery='unknown' WHERE id=?").run(resultId);
    f.store.db.prepare("INSERT INTO task_notification_attempts(id,sessionId,resultIds,state,createdAt,runId) VALUES(?,?,?,'unknown',?,?)")
      .run(randomUUID(), f.scope.sessionId, JSON.stringify([resultId]), Date.now(), "old-parent-run");
    f.agents.active = () => true;
    f.agents.info = () => ({ run: { ...run, id: "new-parent-run", status: "running", sessionId: f.scope.sessionId } }) as any;
    const signals: any[] = [];
    f.agents.signal = (_scope, _runId, input) => { signals.push(input); return true; };
    delivery.reconcilePending(f.scope);
    delivery.notify(f.scope); await tick();
    assert.equal(signals.length, 1);
    assert.equal(signals[0].notifications[0].id, resultId);
    assert.equal(f.store.db.prepare("SELECT runId FROM task_notification_attempts ORDER BY rowid DESC LIMIT 1").get()!.runId, "new-parent-run");
  } finally { await delivery.close(); await f.dispose(); }
});

test("all admissions share the 32-task capacity and failed admission leaves no new input", async () => {
  const f = fixture();
  try {
    const run = f.activate(); run.status = "completed"; run.endedAt = Date.now();
    f.scheduler.settle(f.row(), run);
    for (let i = 0; i < 4; i++) f.records.create(f.scope, String(i), "context", Array.from({ length: 8 }, (_, j) => ({ task: `${i}-${j}` })), run.selection);
    await assert.rejects(f.scheduler.append(f.row(), { text: "no capacity" }), { code: "TASK_LIMIT" });
    assert.throws(() => f.scheduler.resume(f.row(), run.id, randomUUID()), { code: "TASK_LIMIT" });
    assert.equal(f.records.inputs(f.row(), "queued").length, 0);
    assert.equal(f.records.rows("WHERE status='queued'").length, 32);
    const oldest = f.records.rows("WHERE status='queued'")[0];
    f.scheduler.cancel(oldest, {});
    await f.scheduler.append(f.row(), { text: "now allowed" });
    assert.equal(f.records.rows("WHERE status='queued'").length, 32);
    const order = f.records.rows("JOIN task_queue_order q ON q.taskId=tasks.id WHERE status='queued' ORDER BY q.seq");
    assert.equal(order.at(-1)!.id, f.taskId);
  } finally { await f.dispose(); }
});

test("input receipts distinguish send failure, worker acceptance, persistence and clear handoff memory", async () => {
  const f = fixture();
  try {
    const run = f.activate();
    f.agents.signal = () => false;
    await assert.rejects(f.scheduler.append(f.row(), { text: "must fail" }), { code: "INPUT_NOT_DELIVERED" });
    assert.equal(f.records.list(f.scope).tasks[0].inputs!.at(-1)!.state, "failed");
    assert.equal((f.scheduler as any).handed.size, 0);
    f.agents.signal = () => true;
    for (let i = 0; i < 40; i++) {
      const input = await f.scheduler.append(f.row(), { text: `round ${i}` });
      f.scheduler.event(f.row(), run, { type: "input-accepted", id: input.inputId });
      assert.equal(f.records.list(f.scope).tasks[0].inputs!.find((entry) => entry.inputId === input.inputId)!.state, "accepted");
      f.scheduler.event(f.row(), run, { type: "delivered", ids: [input.inputId] });
    }
    assert.equal((f.scheduler as any).handed.size, 0);
    assert.equal((f.scheduler as any).failedInputs.size, 0);
    assert.equal(f.records.drafts.size, 0);
    assert.equal(f.records.inputs(f.row(), "inflight").length, 0);
  } finally { await f.dispose(); }
});

test("immutable results return long reports in full; cancellation keeps persisted partial output", async () => {
  const f = fixture();
  try {
    const run = f.activate(), manager = f.transcript(run.sessionId);
    const report = "证据".repeat(20000) + "报告尾部";
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: report }], stopReason: "stop", axiomRunId: run.id, timestamp: Date.now() } as any);
    run.status = "completed"; run.endedAt = Date.now();
    f.scheduler.settle(f.row(), run);
    const id = f.records.list(f.scope).tasks[0].results[0].id;
    const first = f.delivery.result(f.scope, f.taskId, id);
    assert.equal(first.report, report);
    assert.equal(first.reportKind, "final");
    assert.equal("nextOffset" in first, false);
    assert.equal("truncated" in first, false);
    const other = f.records.create(f.scope, "other", "context", [{ task: "another task" }], run.selection).taskIds[0];
    assert.throws(() => f.delivery.result(f.scope, other, id), { code: "RESULT_SCOPE_MISMATCH" });
    await f.scheduler.append(f.row(), { text: "new work" });
    const second = f.activate();
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "已落盘发现" }], stopReason: "toolUse", axiomRunId: second.id, timestamp: Date.now() } as any);
    const consumed = await f.scheduler.append(f.row(), { text: "received before stop" });
    manager.appendCustomMessageEntry("axiom-append", "received before stop", true, { axiomInput: consumed.inputId });
    f.scheduler.cancel(f.row(), { reason: "time" }, "budget");
    assert.equal(f.records.list(f.scope).tasks[0].inputs!.find((input) => input.inputId === consumed.inputId)!.state, "delivered", "stop cannot withdraw a persisted input just because its acknowledgement was lost");
    assert.equal((f.scheduler as any).handed.size, 0);
    second.status = "cancelled"; second.endedAt = Date.now();
    f.scheduler.settle(f.row(), second);
    const partial = f.delivery.result(f.scope, f.taskId, f.records.list(f.scope).tasks[0].results[1].id);
    assert.equal(partial.reportKind, "partial"); assert.equal(partial.report, "已落盘发现");
    assert.equal(partial.stop?.source, "budget");
    assert.deepEqual(f.delivery.result(f.scope, f.taskId, id), first);
  } finally { await f.dispose(); }
});

test("notification keeps its identity when the parent becomes active behind the model lock", async () => {
  const f = fixture();
  try {
    const models = new ModelService(f.root);
    const agents = new Agents(f.store, models, () => {});
    const runtime = (agents as any).runs;
    let active = false;
    runtime.active = () => active;
    const run = { ...f.activate(), sessionId: f.scope.sessionId };
    agents.info = () => ({ run }) as any;
    const signals: any[] = [];
    runtime.signal = (_scope: unknown, _runId: string, input: unknown) => { signals.push(input); return true; };
    let release!: () => void;
    const lock = models.serial(() => new Promise<void>((resolve) => { release = resolve; }));
    await tick();
    const id = randomUUID();
    const request = agents.command({ op: "prompt", requestId: randomUUID(), ...f.scope, params: { text: "notification trigger" } },
      { notification: { id, content: "result identity", items: [{ id, content: "result identity" }] } });
    active = true;
    release(); await lock; await request;
    assert.equal(signals.length, 1);
    assert.equal(signals[0].notification, true);
    assert.equal(signals[0].mode, "steer");
    assert.equal(signals[0].notifications[0].id, id);
    assert.equal(signals[0].text, "result identity");
    await agents.close();
  } finally { await f.dispose(); }
});

test("notification retry uses fresh real Store.external receipt and lost ack reconciles without duplicate wake", async () => {
  const f = fixture();
  const delivery = new TaskDelivery(f.agents, f.records);
  try {
    const run = f.activate(); run.status = "completed"; run.endedAt = Date.now();
    f.scheduler.settle(f.row(), run);
    const id = f.records.list(f.scope).tasks[0].results[0].id;
    const manager = f.transcript(f.scope.sessionId);
    const requests: string[] = [];
    let available = false;
    f.agents.command = async (command, internal) => f.store.external(command, async () => {
      requests.push(command.requestId);
      if (!available) throw new AppError("MODEL_UNAVAILABLE", "model unavailable");
      internal?.beforeStart?.();
      for (const item of internal!.notification!.items!) {
        const payload = JSON.parse(item.content);
        assert.deepEqual(payload, { notice: "内部子代理结果通知，并非用户输入或新的任务请求", taskId: f.records.modelRef("task", f.row().id), resultId: f.records.modelRef("result", id), status: "completed" });
        assert.equal(f.records.modelId("task", payload.taskId), f.row().id);
        assert.equal(f.records.modelId("result", payload.resultId), id);
        assert.equal(item.id, id);
        manager.appendCustomMessageEntry("axiom-result", item.content, true, { axiomInput: item.id });
      }
      return { status: "accepted" };
    });
    delivery.notify(f.scope); await tick(); await tick();
    assert.equal(f.store.db.prepare("SELECT delivery FROM task_results WHERE id=?").get(id)!.delivery, "failed");
    delivery.notify(f.scope); await tick(); assert.equal(requests.length, 1, "no automatic failure loop");
    available = true;
    delivery.reconcilePending(f.scope); delivery.notify(f.scope); await tick(); await tick();
    assert.equal(requests.length, 2); assert.notEqual(requests[0], requests[1]);
    assert.equal(f.store.receipt(requests[0]).status, "failed");
    assert.equal(f.store.receipt(requests[1]).status, "committed");
    delivery.reconcilePending(f.scope); delivery.notify(f.scope); await tick();
    assert.equal(f.store.db.prepare("SELECT delivery FROM task_results WHERE id=?").get(id)!.delivery, "delivered");
    assert.equal(requests.length, 2, "persisted notice with lost IPC ack never wakes twice");
    assert.deepEqual(f.store.db.prepare("SELECT state FROM task_notification_attempts ORDER BY rowid").all().map((row) => row.state), ["failed", "delivered"]);
  } finally { await delivery.close(); await f.dispose(); }
});

test("settlement reconciles persisted input when its delivery acknowledgement was lost", async () => {
  const f = fixture();
  try {
    const run = f.activate(), manager = f.transcript(run.sessionId);
    const input = await f.scheduler.append(f.row(), { text: "persisted without acknowledgement" });
    assert.equal(input.runId, run.id);
    manager.appendCustomMessageEntry("axiom-append", "persisted without acknowledgement", true, { axiomInput: input.inputId });
    // Flush the new transcript through a conversation entry, as pi does in production.
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "received" }], stopReason: "stop", axiomRunId: run.id, timestamp: Date.now() } as any);
    run.status = "completed"; run.endedAt = Date.now();
    f.scheduler.settle(f.row(), run);
    assert.equal(f.records.list(f.scope).tasks[0].inputs!.find((receipt) => receipt.inputId === input.inputId)!.state, "delivered");
    assert.equal((f.scheduler as any).handed.size, 0);
    f.store.db.prepare("UPDATE task_input_receipts SET state='failed',error='服务重启后未自动重放输入' WHERE inputId=?").run(input.inputId);
    assert.equal(f.records.inputs(f.row(), "inflight").length, 0);
    f.delivery.reconcileInputs(f.row());
    assert.equal(f.records.list(f.scope).tasks[0].inputs!.find((receipt) => receipt.inputId === input.inputId)!.state, "delivered", "persisted identity can reconcile after restart discarded the queue body");
  } finally { await f.dispose(); }
});

test("late disk evidence after cancellation corrects only its own execution's input receipt", async () => {
  const f = fixture();
  try {
    const run = f.activate(), manager = f.transcript(run.sessionId);
    const input = await f.scheduler.append(f.row(), { text: "persisting during stop" });
    f.scheduler.cancel(f.row(), { reason: "stop while write finishes" });
    const receipt = () => f.records.list(f.scope).tasks[0].inputs!.find(item => item.inputId === input.inputId)!;
    assert.equal(receipt().state, "cancelled");
    assert.equal(f.records.inputs(f.row(), "inflight").length, 0);
    f.records.deliver(f.row(), [input.inputId], "delivered", "unrelated-run");
    assert.equal(receipt().state, "cancelled", "a different run cannot correct a discarded input");
    manager.appendCustomMessageEntry("axiom-append", "persisting during stop", true, { axiomInput: input.inputId });
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "persisted" }], stopReason: "stop", axiomRunId: run.id, timestamp: Date.now() } as any);
    run.status = "cancelled"; run.endedAt = Date.now();
    f.scheduler.settle(f.row(), run);
    assert.equal(receipt().state, "delivered");
    assert.equal(receipt().error, null);
    const resultId = f.records.list(f.scope).tasks[0].results[0].id;
    assert.equal(f.delivery.result(f.scope, f.taskId, resultId).stop?.source, "user", "delivery evidence does not erase the stop fact");
  } finally { await f.dispose(); }
});

test("parent settling during notification launch still drains the next batch", async () => {
  const f = fixture(), delivery = new TaskDelivery(f.agents, f.records);
  try {
    let lastRun!: Run;
    for (let i = 0; i < 9; i++) {
      if (i) await f.scheduler.append(f.row(), { text: `execution ${i}` });
      lastRun = f.activate(); lastRun.status = "completed"; lastRun.endedAt = Date.now();
      f.scheduler.settle(f.row(), lastRun);
    }
    let launches = 0;
    f.agents.command = async (_command, internal) => {
      launches++;
      delivery.acknowledge(f.scope, internal!.notification!.items!.map((item) => item.id));
      delivery.parentSettled(f.scope, lastRun);
      return { status: "accepted" };
    };
    delivery.notify(f.scope); await tick(); await tick();
    assert.equal(launches, 2);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS count FROM task_results WHERE delivery='delivered'").get()!.count, 9);
  } finally { await delivery.close(); await f.dispose(); }
});

test("batched Steering notifications preserve the current owner across older failed attempts and freezing", async () => {
  const f = fixture(), delivery = new TaskDelivery(f.agents, f.records);
  try {
    for (let i = 0; i < 10; i++) {
      if (i) await f.scheduler.append(f.row(), { text: `execution ${i}` });
      const run = f.activate(); run.status = "completed"; run.endedAt = Date.now();
      f.scheduler.settle(f.row(), run);
    }
    const parentRun = { ...f.activate(), sessionId: f.scope.sessionId };
    f.agents.info = () => ({ run: parentRun }) as any;
    f.agents.active = () => true;
    const signals: any[] = [];
    f.agents.signal = (_scope, _runId, input) => { signals.push(input); return true; };
    const firstId = f.records.list(f.scope).tasks[0].results[0].id;
    f.store.db.prepare("INSERT INTO task_notification_attempts(id,sessionId,resultIds,state,createdAt,runId) VALUES(?,?,?,'failed',?,?)")
      .run(randomUUID(), f.scope.sessionId, JSON.stringify([firstId]), Date.now(), randomUUID());
    f.records.freeze(f.scope);
    delivery.notify(f.scope); await tick(); assert.equal(signals.length, 0);
    f.store.db.prepare("UPDATE task_parents SET frozen=0 WHERE sessionId=?").run(f.scope.sessionId);
    delivery.notify(f.scope); await tick();
    assert.equal(signals[0].mode, "steer"); assert.equal(signals[0].notifications.length, 8);
    delivery.reconcilePending(f.scope);
    assert.equal(f.store.db.prepare("SELECT delivery FROM task_results WHERE id=?").get(firstId)!.delivery, "inflight", "old failed attempts cannot release the current owner's unconfirmed batch");
    delivery.rejected(f.scope, firstId, "IPC outcome unknown", true);
    delivery.reconcilePending(f.scope);
    assert.equal(f.store.db.prepare("SELECT delivery FROM task_results WHERE id=?").get(firstId)!.delivery, "unknown", "uncertain IPC cannot retry while its current owner remains active");
    delivery.acknowledge(f.scope, signals[0].notifications.map((item: any) => item.id));
    delivery.notify(f.scope); await tick();
    assert.equal(signals[1].notifications.length, 2);
    delivery.acknowledge(f.scope, signals[1].notifications.map((item: any) => item.id));
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS count FROM task_results WHERE delivery='delivered'").get()!.count, 10);
  } finally { await delivery.close(); await f.dispose(); }
});
