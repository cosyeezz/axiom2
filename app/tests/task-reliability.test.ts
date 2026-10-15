import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
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
  const root = mkdtempSync(join(tmpdir(), "axiom-task-reliability-")), store = new Store(root);
  const w = store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: root, authorized: true } }) as Workspace;
  const s = store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: w.id }) as Session;
  const scope = { workspaceId: w.id, sessionId: s.id }, records = new TaskRecords(store);
  const selection: Selection = { provider: "fixture", id: "fixture", thinking: "off" };
  const taskId = records.create(scope, "anchor", "context", [{ task: "first", role: "" }], selection).taskIds[0];
  let live: Run | null = null;
  const agents = { store, info: () => ({ selection, run: live }), active: () => !!live && ["starting", "running", "stopping"].includes(live.status),
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
    const second = f.records.create(f.scope, "next", "context", [{ task: "older queue entry", role: "" }], run.selection).taskIds[0];
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
    for (let i = 0; i < 4; i++) f.records.create(f.scope, String(i), "context", Array.from({ length: 8 }, (_, j) => ({ task: `${i}-${j}`, role: "" })), run.selection);
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

test("immutable full result pages reconstruct the tail; cancellation keeps persisted partial output", async () => {
  const f = fixture();
  try {
    const run = f.activate(), manager = f.transcript(run.sessionId);
    const report = "证据".repeat(20000) + "报告尾部";
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: report }], stopReason: "stop", axiomRunId: run.id, timestamp: Date.now() } as any);
    run.status = "completed"; run.endedAt = Date.now();
    f.scheduler.settle(f.row(), run);
    const id = f.records.list(f.scope).tasks[0].results[0].id;
    const first = f.delivery.result(f.scope, f.taskId, id);
    assert.equal(first.report.length, 16000); assert.equal(first.totalLength, report.length);
    let combined = first.report, next = first.nextOffset;
    while (next != null) { const page = f.delivery.result(f.scope, f.taskId, id, next); combined += page.report; next = page.nextOffset; }
    assert.equal(combined, report); assert.equal(first.reportKind, "final");
    assert.throws(() => f.delivery.result(f.scope, f.taskId, id, -1), { code: "INVALID_INPUT" });
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
      for (const item of internal!.notification!.items!) manager.appendCustomMessageEntry("axiom-result", item.content, true, { axiomInput: item.id });
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
