import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { TaskWindows } from "../src/server/task-windows.js";
import { TaskWindowStore } from "../src/client/tasks/task-window-store.js";
import { AppError } from "../src/shared/protocol.js";
import type { TaskWindowData, TaskWindowQuery, WindowTaskPage, WindowTaskResultPage, WindowTaskTarget } from "../src/shared/task-window.js";
import type { WindowFieldInfo } from "../src/shared/thread-window.js";
import type { WindowFieldData } from "../src/shared/window-frame-budget.js";
import { taskWindowFixture } from "./fixtures/task-window.js";

function setup(t: Parameters<typeof taskWindowFixture>[0]) {
  const f = taskWindowFixture(t), windows = new TaskWindows(f.store, () => "c".repeat(64));
  t.after(() => windows.close());
  const read = <T extends TaskWindowData>(query: TaskWindowQuery): T => {
    const reply = windows.read(f.scope, "report-test", query);
    if (!reply.ok) throw new AppError(reply.error.code, reply.error.message);
    assert.ok(Buffer.byteLength(JSON.stringify(reply)) <= (query.op === "field" ? 64 : 128) * 1024);
    return reply.data as T;
  };
  return { ...f, windows, read };
}
test("selected owned report fields preserve all text and cleaned notes with bounded UTF16 chunks and zero writes", t => {
  const f = setup(t), task = f.task(randomUUID());
  const report = "中文 😀 e\u0301\n".repeat(30000), notes = "未验证 😀\n".repeat(24000);
  const result = { ...f.result(task, "result-a", "completed", report), reportKind: "partial", unfinished: ["模型报告不等于全部验收通过；请核对交付中的未验证项。", notes],
    sideEffects: "未记录工具返回。文件及外部副作用未回滚。", reason: "保留的原因" };
  f.store.db.prepare("UPDATE task_results SET body=? WHERE id=?").run(JSON.stringify(result), result.id);
  f.store.db.prepare("UPDATE tasks SET initialInputId='initial-input' WHERE id=?").run(task.id);
  const changes = () => f.store.db.prepare("SELECT total_changes() AS n").get()!.n, before = changes();
  const root = f.read<WindowTaskPage>({ op: "open" }), descriptor = root.items[0];
  assert.ok(!JSON.stringify(root).includes("未验证"));
  const target = f.read<WindowTaskTarget>({ op: "target", revision: root.revision, taskRef: descriptor.ref });
  assert.equal(target.sessionId, task.sessionId); assert.equal(target.initialInputId, "initial-input");
  const page = f.read<WindowTaskResultPage>({ op: "results", revision: root.revision, taskRef: descriptor.ref });
  const ref = page.items[0].ref;
  for (const [field, expected] of [["text", report], ["input", `未完成／未验证\n${notes}`], ["error", result.reason]] as const) {
    const info = f.read<WindowFieldInfo>({ op: "fieldInfo", revision: root.revision, entityRef: ref, field });
    assert.equal(info.lengthCU, expected.length);
    let text = "", offsetCU = 0, chunks = 0;
    do {
      const value = f.read<WindowFieldData>({ op: "field", revision: root.revision, entityRef: ref, field, expectedVersion: info.version, offsetCU });
      assert.equal(value.chunk.offsetCU, text.length); text += value.chunk.text; chunks++;
      if (value.chunk.nextOffsetCU === null) break;
      offsetCU = value.chunk.nextOffsetCU;
    } while (chunks < 100);
    assert.equal(text, expected); if (field !== "error") assert.ok(chunks > 1);
  }
  const meta = f.read<WindowFieldData>({ op: "field", revision: root.revision, entityRef: ref, field: "metadata" });
  assert.deepEqual(JSON.parse(meta.chunk.text), { status: "completed", reportKind: "partial", startedAt: 10, endedAt: 30, hasNotes: true, hasReason: true });
  assert.equal(meta.chunk.nextOffsetCU, null); assert.equal(changes(), before);
});
test("lazy report membership fails closed; retained payload is immutable and eviction cannot reuse a stale field version", t => {
  const f = setup(t), task = f.task("owned"), a = f.result(task, "a"), b = f.result(task, "b"), c = f.result(task, "c");
  const root = f.read<WindowTaskPage>({ op: "open" });
  const page = f.read<WindowTaskResultPage>({ op: "results", revision: root.revision, taskRef: root.items[0].ref });
  const info = (i: number) => f.read<WindowFieldInfo>({ op: "fieldInfo", revision: root.revision, entityRef: page.items[i].ref, field: "text" });
  const version = info(0).version;
  f.store.db.prepare("UPDATE task_results SET body=? WHERE id=?").run(JSON.stringify({ ...a, report: "MUTATED_PRIVATE_REPORT" }), a.id);
  const retained = f.read<WindowFieldData>({ op: "field", revision: root.revision, entityRef: page.items[0].ref, field: "text", expectedVersion: version });
  assert.equal(retained.chunk.text, a.report);
  info(1); info(2);
  assert.throws(() => info(0), (e: unknown) => e instanceof AppError && e.code === "STALE" && !e.message.includes("PRIVATE"));
  const fresh = f.read<WindowTaskPage>({ op: "open" });
  const freshPage = f.read<WindowTaskResultPage>({ op: "results", revision: fresh.revision, taskRef: fresh.items[0].ref });
  f.store.db.prepare("UPDATE task_results SET body=? WHERE id=?").run(JSON.stringify({ ...b, taskId: "foreign" }), b.id);
  assert.throws(() => f.read({ op: "fieldInfo", revision: fresh.revision, entityRef: freshPage.items[1].ref, field: "text" }), (e: unknown) => e instanceof AppError && e.code === "UNAVAILABLE");
  const foreign = f.session(); f.store.db.prepare("UPDATE tasks SET parentSessionId=? WHERE id=?").run(foreign.sessionId, task.id);
  assert.throws(() => f.read({ op: "fieldInfo", revision: fresh.revision, entityRef: freshPage.items[2].ref, field: "text" }), (e: unknown) => e instanceof AppError && e.code === "UNAVAILABLE");
  assert.equal(c.taskId, task.id);
});
test("client pages selected results, explicitly extends fields and rebinds loaded prefixes only using full field versions", async t => {
  const f = setup(t), task = f.task(randomUUID());
  for (let i = 0; i < 145; i++) f.result(task, `result-${i}`, "completed", i === 0 ? "完整报告 😀\n".repeat(30000) : `报告${i}`);
  const queries: TaskWindowQuery[] = [];
  const model = new TaskWindowStore(async query => { queries.push(query); return f.read(query); });
  t.after(() => model.dispose()); model.acquireReader(); await model.refresh();
  const inspected = await model.inspect(task.id); assert.ok(inspected.task);
  const first = await model.results(inspected.task, inspected.revision); assert.equal(first.items.length, 64); assert.equal(first.total, 145);
  const middle = await model.results(inspected.task, inspected.revision, first.previous!);
  const oldest = await model.results(inspected.task, inspected.revision, middle.previous!); assert.equal(oldest.items.length, 17); assert.equal(oldest.previous, null);
  const key = oldest.items[0].resultKey;
  let field = await model.field(key, "text"); assert.notEqual(field.next, null);
  field = await model.moreField(field); const previous = field, oldRevision = field.revision;
  await model.refresh(); const fieldsBefore = queries.filter(q => q.op === "field").length;
  field = await model.field(key, "text", undefined, previous);
  assert.notEqual(field.revision, oldRevision); assert.equal(field.text, previous.text); assert.equal(queries.filter(q => q.op === "field").length, fieldsBefore);
  await assert.rejects(model.moreField(previous), (e: unknown) => e instanceof AppError && e.code === "CANCELLED");
  while (field.next !== null) field = await model.moreField(field);
  assert.equal(field.text, "完整报告 😀\n".repeat(30000));
  const destination = await model.destination(inspected.task.taskKey); assert.equal(destination.taskId, task.id); assert.equal(destination.sessionId, task.sessionId);
});
