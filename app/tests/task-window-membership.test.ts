import assert from "node:assert/strict";
import test from "node:test";
import { TaskWindow } from "../src/server/task-window.js";
import { captureTaskWindow } from "../src/server/task-window-source.js";
import { TaskWindowStore, type TaskWindowReader } from "../src/client/tasks/task-window-store.js";
import { AppError } from "../src/shared/protocol.js";
import { TASK_WINDOW_MEMBERSHIP_ITEMS, type TaskWindowData, type TaskWindowQuery, type WindowTaskPage } from "../src/shared/task-window.js";
import { taskWindowFixture } from "./fixtures/task-window.js";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function setup(t: Parameters<typeof taskWindowFixture>[0]) {
  const f = taskWindowFixture(t), task = f.task("member-a"); f.task("member-b");
  const references = Array.from({ length: 145 }, (_, i) => { const result = f.result(task, `result-${i}`); return { taskId: task.id, resultId: result.id }; });
  f.store.db.prepare("UPDATE sessions SET resultVersion=145,readVersion=145 WHERE id=?").run(f.scope.sessionId);
  f.store.db.prepare("INSERT INTO task_model_refs(taskId) VALUES(?)").run(task.id);
  const window = new TaskWindow(() => captureTaskWindow(f.store, f.scope), undefined, "c".repeat(64)); t.after(() => window.close());
  const queries: TaskWindowQuery[] = [];
  const reader: TaskWindowReader = async query => {
    queries.push(query); const reply = window.read("membership-test", query);
    if (!reply.ok) throw new AppError(reply.error.code, reply.error.message);
    return reply.data as TaskWindowData;
  };
  return { ...f, window, reader, queries, references };
}

test("membership proves complete raw pairs independently of outstanding refs, with strict bounded requests and cut isolation", async t => {
  const f = setup(t), page = await f.reader({ op: "open" }, new AbortController().signal) as WindowTaskPage;
  assert.equal(page.state.resultRefs.total, 0);
  const changes = f.store.db.prepare("SELECT total_changes() AS n").get()!.n;
  const query = { op: "hasResults", revision: page.revision, references: [f.references[0], f.references[144]] } as const;
  const response = f.window.read("\u0001".repeat(200), query);
  assert.equal(response.ok, true);
  if (response.ok) assert.deepEqual(response.data, { kind: "membership", revision: page.revision, matched: true });
  assert.ok(Buffer.byteLength(JSON.stringify(response)) <= 2048);
  assert.doesNotMatch(JSON.stringify(response), /member-a|result-144|PRIVATE_REPORT_PAYLOAD/);
  const alias = captureTaskWindow(f.store, f.scope)!.tasks.find(task => task.id === "member-a")!.ref; assert.ok(alias);
  for (const ref of [{ taskId: "member-b", resultId: "result-0" }, { taskId: "member-a", resultId: "missing" }, { taskId: alias, resultId: "result-0" }]) {
    const data = await f.reader({ ...query, references: [ref] }, new AbortController().signal);
    assert.ok("kind" in data && data.kind === "membership");
    assert.equal(data.matched, false);
  }
  const maximum = { ...query, references: Array.from({ length: TASK_WINDOW_MEMBERSHIP_ITEMS }, () => ({ taskId: "a".repeat(128), resultId: "b".repeat(128) })) };
  assert.ok(Buffer.byteLength(JSON.stringify(maximum)) < 16 * 1024);
  assert.equal(f.window.read("maximum", maximum).ok, true);
  let serialized = false;
  for (const references of [[], Array(1), Array(33).fill(f.references[0]), [null], [{ taskId: "a", resultId: "b", extra: true }],
    [{ taskId: "a".repeat(129), resultId: "b" }], [{ taskId: "a", resultId: { toJSON() { serialized = true; return "b"; } } }]]) {
    const reply = f.window.read("invalid", { ...query, references });
    assert.equal(reply.ok, false); if (!reply.ok) assert.equal(reply.error.code, "INVALID_REFERENCE");
  }
  assert.equal(serialized, false);
  assert.equal(f.store.db.prepare("SELECT total_changes() AS n").get()!.n, changes, "membership never repairs aliases or loads reports through the legacy list");
  f.result(f.records.rows("WHERE id='member-a'")[0], "later");
  const later = { taskId: "member-a", resultId: "later" };
  assert.equal((await f.reader({ ...query, references: [later] }, new AbortController().signal) as {matched:boolean}).matched, false);
  const fresh = await f.reader({ op: "open" }, new AbortController().signal) as WindowTaskPage;
  assert.equal((await f.reader({ ...query, revision: fresh.revision, references: [later] }, new AbortController().signal) as {matched:boolean}).matched, true);
  await f.reader({ op: "open" }, new AbortController().signal);
  const stale = f.window.read("stale", query); assert.equal(stale.ok, false); if (!stale.ok) assert.equal(stale.error.code, "STALE");
});

test("client membership requires every batch and sufficient watermark, not just loaded result pages", async t => {
  const f = setup(t), model = new TaskWindowStore(f.reader); t.after(() => model.dispose());
  model.acquireReader(); await model.refresh();
  assert.equal(model.status().page!.state.resultRefs.total, 0);
  assert.equal(await model.hasResults(f.references, 145), true);
  let batches = f.queries.filter(q => q.op === "hasResults");
  assert.deepEqual(batches.map(q => q.references.length), [32, 32, 32, 32, 17]);
  assert.equal(new Set(batches.map(q => q.revision)).size, 1);
  const count = f.queries.length;
  assert.equal(await model.hasResults(f.references, 146), false); assert.equal(f.queries.length, count);
  assert.equal(await model.hasResults([...f.references.slice(0, -1), { taskId: "member-a", resultId: "missing" }], 145), false);
  batches = f.queries.filter(q => q.op === "hasResults"); assert.equal(batches.length, 10, "last-batch absence cannot be accepted as complete");
  assert.ok(f.queries.every(q => q.op === "open" || q.op === "hasResults"));
});

test("cancelled or replaced membership cuts cannot finish from late replies", async t => {
  const f = setup(t), held: { query: TaskWindowQuery; resolve: (data: TaskWindowData) => void; signal: AbortSignal }[] = [];
  const model = new TaskWindowStore((query, signal) => query.op === "hasResults"
    ? new Promise(resolve => held.push({ query, resolve, signal })) : f.reader(query, signal));
  t.after(() => model.dispose()); model.acquireReader(); await model.refresh();
  const controller = new AbortController();
  const aborted = assert.rejects(model.hasResults(f.references, 145, controller.signal), (e: unknown) => e instanceof AppError && e.code === "CANCELLED");
  await tick(); controller.abort(); await aborted; assert.equal(held[0].signal.aborted, true);
  held[0].resolve(await f.reader(held[0].query, new AbortController().signal)); await tick(); assert.equal(held.length, 1);
  const replaced = assert.rejects(model.hasResults(f.references, 145), (e: unknown) => e instanceof AppError && e.code === "CANCELLED");
  await tick(); await model.refresh();
  held[1].resolve(await f.reader(held[1].query, new AbortController().signal)); await replaced; await tick();
  assert.equal(held.length, 2, "late first batch never launches another batch against the replacement cut");
});
