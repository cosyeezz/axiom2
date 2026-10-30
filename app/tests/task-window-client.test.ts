import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { TaskWindowStore, taskWindowActive, type TaskWindowReader } from "../src/client/tasks/task-window-store.js";
import { TaskWindows } from "../src/server/task-windows.js";
import { AppError } from "../src/shared/protocol.js";
import type { TaskWindowData, TaskWindowQuery } from "../src/shared/task-window.js";
import { taskWindowFixture } from "./fixtures/task-window.js";

function setup(t: Parameters<typeof taskWindowFixture>[0]) {
  const f = taskWindowFixture(t), windows = new TaskWindows(f.store, () => "a".repeat(64));
  const queries: TaskWindowQuery[] = [];
  const reader: TaskWindowReader = async (query, signal) => {
    queries.push(query);
    const reply = windows.read(f.scope, "client-test", query, signal);
    if (!reply.ok) throw new AppError(reply.error.code, reply.error.message);
    assert.ok(Buffer.byteLength(JSON.stringify(reply)) <= 128 * 1024);
    return reply.data as TaskWindowData;
  };
  t.after(() => windows.close());
  return { ...f, windows, reader, queries };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("hints with no demand reopen the cut on anchor or reader reacquisition without background RPCs", async t => {
  const f = setup(t), task = f.task("inactive");
  const model = new TaskWindowStore(f.reader); t.after(() => model.dispose());
  const first = model.acquire(task.anchor); await model.refresh(); first();
  let reads = f.queries.length;
  const revision = model.snapshot(task.anchor).page!.revision;
  f.store.db.prepare("UPDATE tasks SET status='running' WHERE id=?").run(task.id);
  model.invalidate(); await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(f.queries.length, reads, "inactive hints must not fetch");
  const second = model.acquire(task.anchor); await tick();
  assert.equal(model.snapshot(task.anchor).current, true);
  assert.equal(model.snapshot(task.anchor).page!.counts.running, 1);
  assert.notEqual(model.snapshot(task.anchor).page!.revision, revision);
  assert.equal(f.queries.length, reads + 2, "one fresh root and one anchor page");
  second(); reads = f.queries.length;
  f.store.db.prepare("UPDATE tasks SET status='completed' WHERE id=?").run(task.id);
  model.invalidate(); await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(f.queries.length, reads);
  const reader = model.acquireReader(); await tick();
  assert.equal(taskWindowActive(model.status()), false);
  assert.equal(f.queries.length, reads + 1, "reader-only resumption fetches just a new root");
  reader();
});

test("global task activity uses complete counts and never treats unknown or stale metadata as idle", async t => {
  const f = setup(t);
  for (let i = 0; i < 145; i++) f.task(`activity-${i}`, i);
  f.store.db.prepare("UPDATE tasks SET status='running' WHERE id='activity-0'").run();
  const model = new TaskWindowStore(f.reader); t.after(() => model.dispose());
  assert.equal(taskWindowActive(model.status()), null);
  const off = model.acquireReader(); await model.refresh();
  const active = model.status();
  assert.equal(active.page!.items.length, 64);
  assert.ok(active.page!.items.every(task => task.status === "completed"));
  assert.equal(taskWindowActive(active), true, "old off-page active task still blocks a fresh prompt and retry");
  assert.equal(taskWindowActive({ ...active, loading: true }), null);
  assert.equal(taskWindowActive({ ...active, error: "unavailable" }), null);
  assert.equal(taskWindowActive({ ...active, page: { ...active.page!, anchorKey: "filtered" } }), null);
  f.store.db.prepare("UPDATE tasks SET status='future-status' WHERE id='activity-0'").run();
  await model.refresh(); assert.equal(taskWindowActive(model.status()), null);
  f.store.db.prepare("UPDATE tasks SET status='queued' WHERE id='activity-1'").run();
  await model.refresh(); assert.equal(taskWindowActive(model.status()), true, "known active existence holds even with an unknown peer");
  f.store.db.prepare("UPDATE tasks SET status='completed'").run();
  await model.refresh(); assert.equal(taskWindowActive(model.status()), false);
  assert.ok(f.queries.every(query => query.op === "open"), "activity needs no task pagination or full list");
  model.dispose(); assert.equal(taskWindowActive(model.status()), null); off();
});

test("cards share one SQL cut, use complete anchor counts and explicitly page older tasks", async t => {
  const f = setup(t);
  for (let i = 0; i < 145; i++) f.task(`a-${i}`, i);
  f.store.db.prepare("UPDATE tasks SET anchor='batch' WHERE parentSessionId=?").run(f.scope.sessionId);
  f.task("other", 999);
  const model = new TaskWindowStore(f.reader); t.after(() => model.dispose());
  const offA = model.acquire("batch"), offB = model.acquire("anchor-other");
  await model.refresh();
  assert.equal(f.queries.filter(q => q.op === "open").length, 1);
  assert.equal(model.snapshot("batch").rows.length, 64);
  assert.equal(model.snapshot("batch").page!.counts.total, 145);
  assert.equal(model.snapshot("batch").page!.counts.completed, 145);
  assert.equal(model.snapshot("anchor-other").rows.length, 1);
  assert.equal(model.snapshot("batch").page!.revision, model.snapshot("anchor-other").page!.revision);
  await model.more("batch"); assert.equal(model.snapshot("batch").rows.length, 128);
  await model.more("batch"); assert.equal(model.snapshot("batch").rows.length, 145);
  assert.equal(model.snapshot("batch").previous, null);
  assert.equal(f.queries.filter(q => q.op === "open").length, 1);
  assert.equal(new Set(model.snapshot("batch").rows.map(row => row.task.taskKey)).size, 145);
  offA(); offB();
});

test("partial refresh retains missing cached rows as stale, full coverage alone removes them", async t => {
  const f = setup(t);
  for (let i = 0; i < 145; i++) f.task(`a-${i}`, i);
  f.store.db.prepare("UPDATE tasks SET anchor='batch'").run();
  const model = new TaskWindowStore(f.reader); t.after(() => model.dispose()); model.acquire("batch");
  await model.refresh(); await model.more("batch");
  const old = model.snapshot("batch").rows.find(row => row.task.order === 125)!;
  f.store.db.prepare("DELETE FROM tasks WHERE id='a-125'").run();
  f.task("replacement", 145); f.store.db.prepare("UPDATE tasks SET anchor='batch' WHERE id='replacement'").run();
  await model.refresh();
  const partial = model.snapshot("batch");
  assert.equal(partial.page!.total, 145); assert.equal(partial.rows.length, 129);
  assert.notEqual(partial.rows.find(row => row.task.taskKey === old.task.taskKey)!.revision, partial.page!.revision);
  assert.notEqual(partial.previous, null);
  await model.more("batch");
  assert.equal(model.snapshot("batch").previous, null);
  assert.equal(model.snapshot("batch").rows.length, 145);
  assert.equal(model.snapshot("batch").rows.some(row => row.task.taskKey === old.task.taskKey), false);
});

test("navigation rebinds the current task key and rechecks live parent and child ownership without writes", async t => {
  const f = setup(t), task = f.task("a");
  const model = new TaskWindowStore(f.reader); t.after(() => model.dispose()); model.acquire(task.anchor); await model.refresh();
  const key = model.snapshot(task.anchor).rows[0].task.taskKey;
  const before = f.store.db.prepare("SELECT total_changes() AS n").get()!.n;
  assert.equal(await model.target(key), task.id);
  assert.equal(f.store.db.prepare("SELECT total_changes() AS n").get()!.n, before);
  f.store.db.prepare("UPDATE sessions SET deletedAt=1 WHERE id=?").run(task.sessionId);
  await assert.rejects(model.target(key), (error: unknown) => error instanceof AppError && error.code === "UNAVAILABLE");
  f.store.db.prepare("UPDATE sessions SET deletedAt=NULL WHERE id=?").run(task.sessionId);
  const other = f.session(); f.store.db.prepare("UPDATE tasks SET parentSessionId=? WHERE id=?").run(other.sessionId, task.id);
  await assert.rejects(model.target(key), (error: unknown) => error instanceof AppError && error.code === "UNAVAILABLE");
  const page = model.snapshot(task.anchor).page!;
  const invalid = f.windows.read(f.scope, "invalid", { op: "tasks", revision: page.revision, anchor: task.anchor, anchorKey: page.anchorKey });
  assert.equal(invalid.ok, false); if (!invalid.ok) assert.equal(invalid.error.code, "INVALID_REFERENCE");
});

test("at most two physical RPCs and disposal fences late replies and queued work", async t => {
  const f = setup(t);
  for (let i = 0; i < 8; i++) f.task(`a-${i}`, i);
  const held: { query: TaskWindowQuery; signal: AbortSignal; resolve: (data: TaskWindowData) => void }[] = [];
  let active = 0, peak = 0, calls = 0;
  const model = new TaskWindowStore(async (query, signal) => {
    calls++; active++; peak = Math.max(peak, active);
    try {
      if (query.op === "open") return await f.reader(query, signal);
      return await new Promise<TaskWindowData>(resolve => held.push({ query, signal, resolve }));
    } finally { active--; }
  });
  for (let i = 0; i < 8; i++) model.acquire(`anchor-a-${i}`);
  const done = model.refresh(); await tick();
  assert.equal(held.length, 2); assert.equal(peak, 2);
  model.dispose();
  for (const item of held) { assert.equal(item.signal.aborted, true); item.resolve(await f.reader(item.query, new AbortController().signal)); }
  await done; await tick();
  assert.equal(calls, 3);
  for (let i = 0; i < 8; i++) assert.equal(model.snapshot(`anchor-a-${i}`).current, false);
});

test("failed pages stay unknown and do not create a stale retry loop or a full-list fallback", async t => {
  const f = setup(t); f.task("a"); let calls = 0;
  const model = new TaskWindowStore(async (query, signal) => {
    calls++; if (query.op !== "open") throw new AppError("STALE", "stale cut");
    return f.reader(query, signal);
  }); t.after(() => model.dispose());
  model.acquire("anchor-a"); await model.refresh();
  assert.equal(model.snapshot("anchor-a").page, null);
  assert.equal(model.snapshot("anchor-a").current, false);
  assert.equal(model.snapshot("anchor-a").error, "stale cut");
  await new Promise(resolve => setTimeout(resolve, 250)); assert.equal(calls, 2);
  await model.refresh(); assert.equal(calls, 4); // Only an explicit user retry.
});

test("operations resolve off-page task aliases and receipts, and explicitly continue versioned errors", async t => {
  const f = setup(t), task = f.task("first", 0), other = f.task("other", 1);
  const alias = f.records.modelRef("task", task.id);
  for (let i = 2; i < 145; i++) f.task(`later-${i}`, i);
  for (let i = 0; i < 145; i++) f.input(task, `receipt-${i}`, i, i === 0 ? "failed" : "delivered");
  f.input(other, "foreign-receipt", 200, "failed");
  const text = "actual error 😀\n".repeat(14000);
  f.store.db.prepare("UPDATE task_input_receipts SET error=? WHERE inputId='receipt-0'").run(text);
  const before = f.store.db.prepare("SELECT total_changes() AS n").get()!.n;
  const model = new TaskWindowStore(f.reader); t.after(() => model.dispose());
  const release = model.acquireReader(); await model.refresh();
  assert.equal(model.status().page!.items.some(item => item.order === 0), false);
  const collapsed = await model.inspect(alias, "receipt-0");
  assert.equal(collapsed.task!.order, 0); assert.equal(collapsed.input!.state, "failed");
  assert.equal(collapsed.inputError, null); assert.equal(f.queries.some(q => q.op === "field"), false);
  const expanded = await model.inspect(alias, "receipt-0", true);
  let error = expanded.inputError!;
  assert.ok(error.next !== null); assert.ok(error.text.length < text.length); assert.ok(text.startsWith(error.text));
  while (error.next !== null) error = await model.errorChunk(error);
  assert.equal(error.text, text);
  assert.equal((await model.inspect(alias, "foreign-receipt", true)).input, null);
  assert.equal((await model.inspect("missing")).task, null);
  assert.equal(f.store.db.prepare("SELECT total_changes() AS n").get()!.n, before);
  assert.equal(f.queries.filter(q => q.op === "open").length, 1);
  await model.refresh();
  await assert.rejects(model.errorChunk(expanded.inputError!), (e: unknown) => e instanceof AppError && e.code === "CANCELLED");
  release(); assert.equal(model.status().loading, false);
});

test("operation cancellation rejects queued and late results without cancelling sibling reads", async t => {
  const f = setup(t); f.task("a"); f.task("b");
  const held: { query: TaskWindowQuery; signal: AbortSignal; resolve: (data: TaskWindowData) => void }[] = [];
  const model = new TaskWindowStore((query, signal) => query.op === "lookup"
    ? new Promise(resolve => held.push({ query, signal, resolve })) : f.reader(query, signal));
  t.after(() => model.dispose()); model.acquireReader(); await model.refresh();
  const a = new AbortController(), queued = new AbortController();
  const first = assert.rejects(model.inspect("a", undefined, false, a.signal), (e: unknown) => e instanceof AppError && e.code === "CANCELLED");
  const sibling = model.inspect("b");
  const third = assert.rejects(model.inspect("a", undefined, false, queued.signal), (e: unknown) => e instanceof AppError && e.code === "CANCELLED");
  await tick(); assert.equal(held.length, 2);
  a.abort(); queued.abort(); await first; await third;
  assert.equal(held[0].signal.aborted, true); assert.equal(held[1].signal.aborted, false);
  for (const item of held) item.resolve(await f.reader(item.query, new AbortController().signal));
  assert.ok((await sibling).task); await tick();
  assert.equal(held.length, 2); assert.ok(model.status().page);
});

test("operation-only root failures are visible and require an external or explicit retry", async t => {
  let reads = 0;
  const model = new TaskWindowStore(async () => { reads++; throw new AppError("STALE", "stale root"); });
  t.after(() => model.dispose()); model.acquireReader(); await model.refresh();
  assert.equal(model.status().page, null); assert.equal(model.status().error, "stale root");
  await new Promise(resolve => setTimeout(resolve, 250)); assert.equal(reads, 1);
  await model.refresh(); assert.equal(reads, 2);
});

test("production cards and transport use partial windows while read receipts retain complete membership and rendering gates", () => {
  const cards = readFileSync(new URL("../src/client/tasks/TaskCards.tsx", import.meta.url), "utf8");
  const provider = readFileSync(new URL("../src/client/tasks/TaskWindowProvider.tsx", import.meta.url), "utf8");
  const operation = readFileSync(new URL("../src/client/tasks/TaskOperation.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(operation, /useTask\(|task\.inputs|openTask\(task\.id\)/);
  assert.match(operation, /useTaskInspection/); assert.match(operation, /input\?\.mode === "followUp"/);
  assert.match(operation, /window\.target\(task\.taskKey\)/);
  const conversation = readFileSync(new URL("../src/client/chat/OriginalConversation.tsx", import.meta.url), "utf8");
  const transport = readFileSync(new URL("../src/client/transport.ts", import.meta.url), "utf8");
  const receipt = readFileSync(new URL("../src/client/chat/useReadReceipt.ts", import.meta.url), "utf8");
  assert.doesNotMatch(cards, /useAnchorTasks|tasksScope|results\.map/);
  assert.match(cards, /window\.page\?\.counts/); assert.match(cards, /window\.target\(t\.taskKey\)/);
  assert.match(cards, /加载更早的子任务/); assert.match(cards, /total === 0/);
  assert.match(conversation, /<TaskWindowProvider scope=\{scope\}>/);
  assert.match(provider, /command<TaskWindowData>\("task\.window"/);
  assert.match(provider, /observeConnection[\s\S]*?model\.dispose\(\)/);
  assert.match(transport, /"tasks", "task-window", "costs"/);
  assert.match(transport, /if \(!\["agent\.window", "task\.window", "agent\.history\.index"/);
  assert.match(receipt, /renderedContextReady\(scope, index\.ids, !running\(info\.run\)\)/);
  assert.doesNotMatch(receipt, /tasksScope|tasks\.tasks/);
  assert.match(receipt, /model\.hasResults\(references, version, controller\.signal\)/);
  assert.match(receipt, /live\.page\.revision !== root\.page\.revision/);
  assert.match(receipt, /if \(!references\) return/);
});
