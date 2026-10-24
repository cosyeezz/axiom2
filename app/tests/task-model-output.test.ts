import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Store } from "../src/server/storage.js";
import { TaskRecords } from "../src/server/tasks/records.js";
import { TaskCommands } from "../src/server/tasks/commands.js";
import { TaskDelivery } from "../src/server/tasks/delivery.js";
import { taskTools } from "../src/server/task-tools.js";
import { modelTaskOutput, taskDisplayText } from "../src/server/task-output.js";
import { boundedMessage, chatMessage, transcriptMessages } from "../src/server/transcript.js";
import { readTaskReport, taskCallLabel } from "../src/client/tasks/task-call.js";
import { taskIndex } from "../src/client/tasks/task-selectors.js";
import type { Agents } from "../src/server/agents.js";
import type { TaskScheduler } from "../src/server/tasks/scheduler.js";
import type { Run, Selection } from "../src/shared/agent.js";
import type { TaskResult } from "../src/shared/tasks.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";

const report: TaskResult = { id: "result-uuid", taskId: "task-uuid", runId: "run-uuid", status: "completed",
  report: "Evidence and conclusion\n" + "完整报告。".repeat(5000), reportKind: "final", reason: null,
  startedAt: 10, endedAt: 20, elapsedMs: 10, unfinished: [], sideEffects: "" };

function fixture() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "axiom-task-refs-")));
  const store = new Store(root), records = new TaskRecords(store);
  const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: root, authorized: true } }) as Workspace;
  const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const selection: Selection = { provider: "fixture", id: "fixture", thinking: "off" };
  const run: Run = { id: randomUUID(), sessionId: session.id, status: "running", selection, startedAt: 1, endedAt: null, error: null };
  const agents = { store, info: () => ({ run }), active: () => true } as unknown as Agents;
  const appended: string[] = [], cancelled: string[] = [];
  const scheduler = { closing: false,
    append: async (row: { id: string }) => { appended.push(row.id); return { taskId: row.id, inputId: "receipt-uuid", runId: run.id, status: "accepted" }; },
    cancel: (row: { id: string }) => { cancelled.push(row.id); return { taskId: row.id, status: "stopping" }; },
  } as unknown as TaskScheduler;
  const delivery = new TaskDelivery(agents, records);
  const commands = new TaskCommands(agents, records, scheduler, delivery, async () => {});
  const create = (to = scope) => records.create(to, randomUUID(), "context", [{ task: "task" }], selection).taskIds[0];
  const result = (taskId: string, body = "original result") => {
    const row = records.own(scope, taskId), id = randomUUID(), runId = randomUUID();
    store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'completed',?,1)")
      .run(runId, row.sessionId, JSON.stringify(selection));
    const value = { ...report, id, taskId, runId, report: body };
    store.db.prepare("INSERT INTO task_results(id,taskId,runId,body) VALUES(?,?,?,?)").run(id, taskId, runId, JSON.stringify(value));
    return value;
  };
  return { root, store, records, scope, run, commands, appended, cancelled, create, result,
    close: () => { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("model content is compact while details, evidence and outcome warnings remain complete", async () => {
  for (const kind of ["final", "partial", "system"] as const) {
    const full = { ...report, reportKind: kind, taskRef: "t1", resultRef: "r2" };
    const tool = taskTools(async () => full).find(t => t.name === "read_result")!;
    const result = await tool.execute("call", { taskId: "t1", resultId: "r2" }, undefined, undefined, {} as never);
    assert.strictEqual(result.details, full);
    const model = JSON.parse((result.content[0] as { text: string }).text);
    assert.deepEqual(model, { status: "completed", report: report.report, reportKind: kind });
    assert.doesNotMatch(JSON.stringify(model), /uuid|taskRef|resultRef|startedAt|endedAt|elapsedMs/);
  }
  const stopped = { ...report, status: "cancelled" as const, reportKind: "partial" as const, reason: "budget reached",
    unfinished: ["integration test not run"], sideEffects: "created output.txt", budgetSummary: true,
    stop: { source: "budget" as const, reason: "deadline", requestedAt: 123 } };
  assert.deepEqual(modelTaskOutput("read_result", stopped), { status: "cancelled", report: report.report,
    reportKind: "partial", reason: stopped.reason, unfinished: stopped.unfinished, sideEffects: stopped.sideEffects,
    budgetSummary: true, stop: { source: "budget", reason: "deadline" } });
  assert.deepEqual(modelTaskOutput("delegate", { taskIds: ["uuid"], taskRefs: ["t1"], status: "queued", budgets: {} }),
    { taskIds: ["t1"], status: "queued" });
  for (const status of ["queued", "accepted", "delivered", "failed", "cancelled", "stopping", "completed"])
    for (const name of ["append", "cancel_task"] as const)
      assert.deepEqual(modelTaskOutput(name, { status, taskId: "uuid", inputId: "uuid", runId: "uuid" }), { status });
});

test("UI live/history projection uses full details, preserves strict reference matching and legacy/error content", () => {
  const full = { ...report, taskRef: "t1", resultRef: "r2" }, input = { taskId: "t1", resultId: "r2" };
  const content = [{ type: "text" as const, text: JSON.stringify(modelTaskOutput("read_result", full)) }];
  const native = { role: "toolResult" as const, toolCallId: "call", toolName: "read_result", content, details: full, timestamp: 1 };
  const before = structuredClone(native), projected = chatMessage(native, "tool-call")!;
  assert.deepEqual(readTaskReport(projected.text, input), full);
  assert.equal(boundedMessage(projected).truncated, true);
  assert.deepEqual(readTaskReport(projected.text, { taskId: "t1", resultId: "r3" }), null);
  assert.deepEqual(readTaskReport(projected.text, { taskId: "t2", resultId: "r2" }), null);
  assert.deepEqual(readTaskReport(projected.text, { taskId: report.taskId, resultId: report.id }), full);
  const manager = SessionManager.inMemory();
  manager.appendMessage(native as never);
  assert.equal(transcriptMessages(manager)[0].text, projected.text);
  assert.equal(transcriptMessages(manager, true)[0].text, projected.text);
  assert.deepEqual(native, before, "UI projection must never mutate model content");
  assert.equal(taskDisplayText("functions.read_result", full), projected.text);
  for (const name of ["read", "other.read_result", undefined]) assert.equal(taskDisplayText(name, full), undefined);
  for (const details of [undefined, null, []]) assert.equal(taskDisplayText("read_result", details), undefined);
  const legacy = { ...native, content: [{ type: "text", text: JSON.stringify(report) }], details: undefined };
  assert.deepEqual(readTaskReport(chatMessage(legacy, "legacy")!.text, { taskId: report.taskId, resultId: report.id }), report);
  const error = { ...native, isError: true, content: [{ type: "text", text: "RESULT_SCOPE_MISMATCH" }] };
  assert.equal(chatMessage(error, "error")!.text, "RESULT_SCOPE_MISMATCH");
  assert.equal(taskDisplayText("read_result", full, true), undefined);
  const receipt = { taskId: "uuid", inputId: "receipt", runId: "run", status: "accepted" };
  assert.deepEqual(JSON.parse(taskDisplayText("append", receipt)!), receipt);
  assert.equal(taskCallLabel("cancel_task", "completed", { status: "stopping" }), "停止已受理");
});

test("short references select exact immutable results and retain UUID compatibility and ownership checks", async () => {
  const f = fixture();
  try {
    const taskId = f.create(), otherId = f.create(), first = f.result(taskId), second = f.result(taskId, "newer result");
    const taskRef = f.records.modelRef("task", taskId), firstRef = f.records.modelRef("result", first.id);
    const secondRef = f.records.modelRef("result", second.id), otherRef = f.records.modelRef("task", otherId);
    assert.match(taskRef, /^t[1-9]\d*$/); assert.match(firstRef, /^r[1-9]\d*$/);
    const read = (task: string, result: string, scope: Scope = f.scope) =>
      f.commands.tool(scope, f.run, "read_result", randomUUID(), { taskId: task, resultId: result });
    const old = await read(taskRef, firstRef) as TaskResult;
    assert.equal(old.id, first.id); assert.equal(old.report, "original result");
    assert.equal((await read(taskRef, secondRef) as TaskResult).report, "newer result");
    assert.equal((await read(taskId, first.id) as TaskResult).id, first.id);
    await assert.rejects(read(otherRef, firstRef), { code: "RESULT_SCOPE_MISMATCH" });
    await assert.rejects(read(taskRef, "r999999"), { code: "RESULT_SCOPE_MISMATCH" });
    await assert.rejects(read(firstRef, firstRef), { code: "TASK_SCOPE_MISMATCH" });
    await assert.rejects(read(taskRef, taskRef), { code: "RESULT_SCOPE_MISMATCH" });
    const other = f.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: f.scope.workspaceId }) as Session;
    await assert.rejects(read(taskRef, firstRef, { ...f.scope, sessionId: other.id }), { code: "TASK_SCOPE_MISMATCH" });
    // The public boundary must also reject a mismatched workspace before reading a mapped result.
    await assert.rejects(read(taskRef, firstRef, { ...f.scope, workspaceId: "unknown-workspace" }));
    await f.commands.tool(f.scope, f.run, "append", "append-once", { taskId: taskRef, summary: "extra", text: "details" });
    await f.commands.tool(f.scope, f.run, "append", "append-once", { taskId: taskRef, summary: "extra", text: "details" });
    assert.deepEqual(f.appended, [taskId], "raw request identity and durable idempotence are unchanged");
    await f.commands.tool(f.scope, f.run, "cancel_task", "cancel-once", { taskId: taskRef });
    assert.deepEqual(f.cancelled, [taskId]);
    const list = f.records.list(f.scope), index = taskIndex(list);
    assert.strictEqual(index.byId.get(taskRef), index.byId.get(taskId));
    assert.equal(index.byId.get(taskRef)!.id, taskId, "opening a task continues to use its UUID");
    assert.equal(JSON.parse(String(f.store.db.prepare("SELECT body FROM task_results WHERE id=?").get(first.id)!.body)).id, first.id);
  } finally { f.close(); }
});

test("reference migration/restart is stable, deleted references are not reused, and the mapping is FK protected", () => {
  const f = fixture(); let reopened: Store | undefined, closed = false;
  try {
    const taskId = f.create(), result = f.result(taskId);
    // Simulate a database predating reference mappings.
    f.store.db.exec("DROP TABLE task_model_refs");
    const migrated = new TaskRecords(f.store);
    const taskRef = migrated.modelRef("task", taskId), resultRef = migrated.modelRef("result", result.id);
    const sequence = f.store.db.prepare("SELECT seq FROM sqlite_sequence WHERE name='task_model_refs'").get()!.seq;
    new TaskRecords(f.store);
    assert.equal(f.store.db.prepare("SELECT seq FROM sqlite_sequence WHERE name='task_model_refs'").get()!.seq, sequence);
    assert.throws(() => migrated.modelRef("task", "missing-uuid"), /FOREIGN KEY/);
    assert.throws(() => f.store.db.prepare("INSERT INTO task_model_refs(taskId,resultId) VALUES(?,?)").run(taskId, result.id));
    f.store.close(); closed = true;
    reopened = new Store(f.root);
    const restored = new TaskRecords(reopened);
    assert.equal(restored.modelRef("task", taskId), taskRef);
    assert.equal(restored.modelRef("result", result.id), resultRef);
    assert.equal(restored.modelId("task", taskRef), taskId);
    assert.equal(restored.modelId("result", resultRef), result.id);
    reopened.db.prepare("DELETE FROM tasks WHERE id=?").run(taskId);
    assert.equal(restored.modelId("task", taskRef), taskRef);
    assert.equal(restored.modelId("result", resultRef), resultRef);
    const next = restored.create(f.scope, "new", "context", [{ task: "new" }], f.run.selection).taskIds[0];
    assert.notEqual(restored.modelRef("task", next), taskRef);
    assert.ok(Number(restored.modelRef("task", next).slice(1)) > Number(resultRef.slice(1)));
  } finally { reopened?.close(); if (!closed) f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
});
