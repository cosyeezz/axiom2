import assert from "node:assert/strict";
import test from "node:test";
import type { Run } from "../src/shared/agent.js";
import type { TaskInputState, TaskStatus } from "../src/shared/tasks.js";
import type { TaskWindowQuery, WindowTaskInputPage, WindowTaskLocation, WindowTaskPage, WindowTaskResultPage, WindowTaskResultRefPage } from "../src/shared/task-window.js";
import type { WindowFieldInfo } from "../src/shared/thread-window.js";
import type { WindowFieldData } from "../src/shared/window-frame-budget.js";
import { createWindowIdentity } from "../src/server/canonical-window-identity.js";
import { TaskWindow } from "../src/server/task-window.js";
import { captureTaskWindow, type TaskWindowSource, type TaskWindowSourceTask } from "../src/server/task-window-source.js";
import { taskWindowFixture } from "./fixtures/task-window.js";

const seed = "ab".repeat(32), identity = createWindowIdentity(seed), requestId = "\u0001".repeat(200);
function task(n: number, extra: Partial<TaskWindowSourceTask> = {}): TaskWindowSourceTask {
  return { id: `private-task-${n}`, ref: `t${n + 1}`, workspaceId: "private-workspace", parentSessionId: "private-parent", sessionId: `private-child-${n}`,
    anchor: "private-call", title: `title-${n}`, description: `instructions-${n}`, context: null, status: "completed", runId: null,
    createdAt: n, budgets: { concurrency: 4, workMs: 600000 }, results: [], inputs: [], error: null, elapsedMs: 0, ...extra };
}
function cut(tasks: readonly TaskWindowSourceTask[], extra: Partial<Omit<TaskWindowSource, "tasks">> = {}): TaskWindowSource {
  return Object.freeze({ frozen: false, resultVersion: 0, readVersion: 0, ...extra,
    run: extra.run ? Object.freeze({ ...extra.run }) : null, resultRefs: Object.freeze((extra.resultRefs ?? []).map(ref => Object.freeze({ ...ref }))),
    tasks: Object.freeze(tasks.map(t => Object.freeze({ ...t, budgets: Object.freeze({ ...t.budgets }),
      results: Object.freeze(t.results.map(r => Object.freeze({ ...r }))), inputs: Object.freeze(t.inputs.map(i => Object.freeze({ ...i }))) }))) });
}
function success<T>(reader: TaskWindow, query: TaskWindowQuery): T {
  const reply = reader.read(requestId, query);
  assert.equal(reply.ok, true, JSON.stringify(reply)); assert.ok(Buffer.byteLength(JSON.stringify(reply)) <= 128 * 1024);
  if (!reply.ok) throw new Error("Expected success");
  return reply.data as T;
}
function error(reader: TaskWindow, query: unknown, code: string, id: unknown = requestId) {
  const reply = reader.read(id, query);
  assert.equal(reply.ok, false); assert.ok(Buffer.byteLength(JSON.stringify(reply)) <= 2048);
  if (reply.ok) throw new Error("Expected failure");
  assert.equal(reply.error.code, code); assert.equal(JSON.stringify(reply).includes("PRIVATE_DIAGNOSTIC"), false);
  return reply;
}
const open = (reader: TaskWindow) => success<WindowTaskPage>(reader, { op: "open" });
const locate = (reader: TaskWindow, revision: string, key: string) => success<WindowTaskLocation>(reader, { op: "locate", revision, key }).location;

function manyChildren(): TaskWindowSourceTask {
  return task(0, { results: Array.from({ length: 145 }, (_, n) => ({ id: `private-result-${n}`, runId: `private-run-${n}`, status: "completed" })),
    inputs: Array.from({ length: 145 }, (_, n) => ({ inputId: `private-input-${n}`, runId: n ? `private-run-${n}` : null, state: "queued", error: null })) });
}
function refs(t: TaskWindowSourceTask) {
  return t.results.map((r, n) => ({ taskId: t.id, resultId: r.id, runId: r.runId, version: n + 1 }));
}

test("145 historical tasks page independently with whole-anchor counts and bounded private descriptors", () => {
  const title = "\u0001\\\"😀".repeat(20000);
  const source = cut(Array.from({ length: 145 }, (_, n) => task(n, { title, anchor: n < 100 ? "private-call" : "other-call",
    status: n === 0 ? "new-status" as TaskStatus : n <= 7 ? "failed" : "completed", createdAt: n === 0 ? NaN : n, elapsedMs: n === 0 ? Infinity : 0 })),
    { frozen: true, resultVersion: 3, readVersion: 1, run: { id: "private-parent-run", status: "new-run-state" as Run["status"] } });
  const reader = new TaskWindow(() => source, undefined, seed), first = open(reader);
  assert.equal(first.items.length, 64); assert.equal(first.total, 145); assert.equal(first.items[0].order, 81);
  assert.equal(first.counts.unknown, 1); assert.equal(first.counts.failed, 7); assert.equal(first.counts.completed, 137);
  assert.equal(first.state.run!.status, null); assert.equal(first.state.frozen, true); assert.equal(first.state.readVersion, 1);
  const all = [...first.items]; let before = first.previous;
  while (before !== null) {
    const page = success<WindowTaskPage>(reader, { op: "tasks", revision: first.revision, before, expectedVersion: first.version });
    assert.ok(page.items.length <= 64); all.unshift(...page.items); before = page.previous;
  }
  assert.deepEqual(all.map(t => t.order), Array.from({ length: 145 }, (_, i) => i));
  assert.equal(new Set(all.map(t => t.taskKey)).size, 145); assert.equal(all[0].status, null); assert.equal(all[0].createdAt, null); assert.equal(all[0].elapsedMs, null);
  const anchor = success<WindowTaskPage>(reader, { op: "tasks", revision: first.revision, anchorKey: identity.key("call", "private-call") });
  assert.equal(anchor.total, 100); assert.equal(anchor.items[0].order, 36); assert.equal(anchor.items.at(-1)!.order, 99);
  assert.equal(anchor.counts.failed, 7); assert.ok(anchor.items.every(t => t.status === "completed"));
  assert.equal(success<WindowTaskPage>(reader, { op: "tasks", revision: first.revision, anchorKey: identity.key("call", "absent") }).total, 0);
  assert.equal(first.items.reduce((n, t) => n + Buffer.byteLength(JSON.stringify(t.title)), 0) <= 8192, true);
  for (const t of all) { assert.ok(Buffer.byteLength(JSON.stringify(t)) <= 4096); assert.equal(t.title!.complete, false); }
  for (const forbidden of ["private-", "other-call", "instructions-", "modelRef", "sessionId", "taskId", "runId", "t145"]) assert.equal(JSON.stringify(first).includes(forbidden), false, forbidden);
  assert.throws(() => { first.items[0].title!.text = "mutated"; }, TypeError);
  assert.throws(() => { first.state.resultRefs.total = 1000; }, TypeError);
  assert.throws(() => { first.counts.failed = 1000; }, TypeError);
  first.items[0].status = "failed";
  assert.equal(success<WindowTaskPage>(reader, { op: "tasks", revision: first.revision }).items[0].status, "completed");
});

test("results, input receipts and outstanding resultRefs each retain all 145 independent members", () => {
  const t = manyChildren(), source = cut([t], { resultVersion: 145, resultRefs: refs(t) });
  const reader = new TaskWindow(() => source, undefined, seed), head = open(reader), taskRef = head.items[0].ref;
  for (const op of ["results", "inputs", "resultRefs"] as const) {
    let before: number | undefined, found = 0;
    do {
      const q: TaskWindowQuery = op === "resultRefs" ? { op, revision: head.revision, before } : { op, revision: head.revision, taskRef, before };
      const page = success<WindowTaskResultPage | WindowTaskInputPage | WindowTaskResultRefPage>(reader, q);
      assert.equal(page.total, 145); assert.ok(page.items.length <= 64); found += page.items.length;
      assert.equal(JSON.stringify(page).includes("private-"), false);
      before = page.previous ?? undefined;
    } while (before !== undefined);
    assert.equal(found, 145);
  }
  const results = success<WindowTaskResultPage>(reader, { op: "results", revision: head.revision, taskRef });
  const inputs = success<WindowTaskInputPage>(reader, { op: "inputs", revision: head.revision, taskRef });
  assert.equal(results.version, head.items[0].results.version); assert.equal(inputs.version, head.items[0].inputs.version);
  assert.equal(results.items[0].order, 81); assert.equal(inputs.items[0].inputKey, identity.key("input", "private-input-81"));
  assert.equal(results.items[0].resultKey, identity.key("task-result", "private-result-81"));
  const events = success<WindowTaskResultRefPage>(reader, { op: "resultRefs", revision: head.revision });
  assert.equal(events.items[0].resultRef, results.items[0].ref); assert.equal(events.items[0].eventVersion, 82);
  assert.equal(events.version, head.state.resultRefs.version); assert.equal(events.state.version, head.state.version);
  error(reader, { op: "results", revision: head.revision, taskRef: inputs.items[0].ref }, "INVALID_REFERENCE");
  error(reader, { op: "fieldInfo", revision: head.revision, entityRef: results.items[0].ref, field: "text" }, "UNAVAILABLE");
  error(reader, { op: "field", revision: head.revision, entityRef: inputs.items[0].ref, field: "metadata" }, "UNAVAILABLE");
});

test("whole collection versions reject same-count off-page replacements and cuts never revive old refs", () => {
  const t = manyChildren(), tasks = [t, ...Array.from({ length: 144 }, (_, i) => task(i + 1))];
  let source = cut(tasks, { resultVersion: 145, resultRefs: refs(t) });
  const reader = new TaskWindow(() => source, undefined, seed), a = open(reader), b = open(reader);
  assert.equal(a.version, b.version); assert.equal(a.state.version, b.state.version);
  assert.notEqual(a.revision, b.revision); assert.equal(a.identityNamespace, b.identityNamespace);
  const bt = locate(reader, b.revision, identity.key("task", t.id))!.ref;
  const oldResults = success<WindowTaskResultPage>(reader, { op: "results", revision: b.revision, taskRef: bt });
  const oldInputs = success<WindowTaskInputPage>(reader, { op: "inputs", revision: b.revision, taskRef: bt });
  const oldRefs = success<WindowTaskResultRefPage>(reader, { op: "resultRefs", revision: b.revision });
  const changed = task(0, { ...t, status: "failed", results: t.results.map((r, i) => i ? r : { ...r, status: "failed" }),
    inputs: t.inputs.map((input, i) => i ? input : { ...input, inputId: "private-replacement-input" }) });
  source = cut([changed, ...tasks.slice(1)], { resultVersion: 145, resultRefs: refs(changed) });
  const c = open(reader), ct = locate(reader, c.revision, identity.key("task", t.id))!.ref;
  assert.notEqual(c.version, b.version);
  assert.deepEqual(c.items.map(({ ref: _, ...rest }) => rest), b.items.map(({ ref: _, ...rest }) => rest)); // Change outside the tail page.
  error(reader, { op: "tasks", revision: c.revision, expectedVersion: b.version }, "STALE");
  for (const [op, version] of [["results", oldResults.version], ["inputs", oldInputs.version]] as const)
    error(reader, { op, revision: c.revision, taskRef: ct, expectedVersion: version }, "STALE");
  error(reader, { op: "resultRefs", revision: c.revision, expectedVersion: oldRefs.version }, "STALE");
  assert.equal(success<WindowTaskResultPage>(reader, { op: "results", revision: b.revision, taskRef: bt, before: 1 }).items[0].status, "completed");
  error(reader, { op: "tasks", revision: a.revision }, "STALE");
  error(reader, { op: "results", revision: c.revision, taskRef: bt }, "INVALID_REFERENCE");
  assert.equal(locate(reader, c.revision, identity.key("input", "private-input-0")), null);
  assert.notEqual(locate(reader, c.revision, identity.key("input", "private-replacement-input")), null);
  assert.equal(success<WindowTaskPage>(reader, { op: "tasks", revision: c.revision, expectedVersion: c.version }).total, 145);
});

test("current-cut locate and private token lookup do not grant cross-scope, raw-ID actions or report lookup", () => {
  const source = cut([manyChildren()]), reader = new TaskWindow(() => source, undefined, seed), a = open(reader);
  const byAlias = success<WindowTaskLocation>(reader, { op: "lookup", revision: a.revision, kind: "task", reference: "t1" });
  assert.equal(byAlias.location!.ref, a.items[0].ref);
  assert.deepEqual(success<WindowTaskLocation>(reader, { op: "lookup", revision: a.revision, kind: "task", reference: "private-task-0" }), byAlias);
  const input = success<WindowTaskLocation>(reader, { op: "lookup", revision: a.revision, kind: "input", reference: "private-input-0" }).location!;
  assert.equal(input.kind, "input"); assert.equal(input.itemOrder, 0);
  assert.equal(locate(reader, a.revision, identity.key("call", "private-call")), null);
  assert.equal(locate(reader, a.revision, identity.key("run", "private-run-0")), null);
  assert.equal(success<WindowTaskLocation>(reader, { op: "lookup", revision: a.revision, kind: "task", reference: "r1" }).location, null);
  const other = new TaskWindow(() => source, undefined, "cd".repeat(32)), b = open(other);
  assert.notEqual(a.identityNamespace, b.identityNamespace); assert.equal(locate(other, b.revision, a.items[0].taskKey), null);
  error(other, { op: "results", revision: b.revision, taskRef: a.items[0].ref }, "INVALID_REFERENCE");
  error(reader, { op: "lookup", revision: a.revision, kind: "result", reference: "r1" }, "INVALID_REFERENCE");
  for (const reference of ["x".repeat(129), "t1 ", "中文", "a/b"]) error(reader, { op: "lookup", revision: a.revision, kind: "task", reference }, "INVALID_REFERENCE");
  assert.notEqual(identity.key("task", "same"), identity.key("task-result", "same"));
  assert.notEqual(identity.key("task", "same"), identity.key("message", "same"));
});

test("full UTF16 field versions and bounded continuation are independent of descriptor preview equality", () => {
  const large = "a\"\\\n😀\ud800\udfff".repeat(12000), t = task(0, { description: large + "\ud800", context: large, error: large, title: large + "x",
    inputs: [{ inputId: "private-input", runId: null, state: "new-state" as TaskInputState, error: large }] });
  let source = cut([t]);
  const reader = new TaskWindow(() => source, undefined, seed), a = open(reader), entityRef = a.items[0].ref;
  const values = { text: t.description, input: large, error: large, metadata: JSON.stringify({ title: t.title, modelRef: "t1" }) };
  const versions = new Map<string, string>();
  for (const field of ["text", "input", "error", "metadata"] as const) {
    const info = success<WindowFieldInfo>(reader, { op: "fieldInfo", revision: a.revision, entityRef, field });
    assert.ok(Buffer.byteLength(JSON.stringify(reader.read(requestId, { op: "fieldInfo", revision: a.revision, entityRef, field }))) <= 2048);
    assert.equal(info.lengthCU, values[field].length); versions.set(field, info.version);
    let offsetCU = 0, text = "";
    while (true) {
      const query: TaskWindowQuery = { op: "field", revision: a.revision, entityRef, field, offsetCU, expectedVersion: info.version };
      const part: WindowFieldData = success<WindowFieldData>(reader, query);
      assert.ok(Buffer.byteLength(JSON.stringify(reader.read(requestId, query))) <= 65536);
      assert.ok(Buffer.byteLength(JSON.stringify(part.chunk.text)) <= 49152);
      assert.equal(part.chunk.offsetCU, offsetCU); text += part.chunk.text;
      if (part.chunk.nextOffsetCU === null) break;
      assert.ok(part.chunk.nextOffsetCU > offsetCU); offsetCU = part.chunk.nextOffsetCU;
    }
    assert.equal(text, values[field]);
  }
  const inputPage = success<WindowTaskInputPage>(reader, { op: "inputs", revision: a.revision, taskRef: entityRef });
  assert.equal(inputPage.items[0].state, null);
  assert.equal(success<WindowFieldInfo>(reader, { op: "fieldInfo", revision: a.revision, entityRef: inputPage.items[0].ref, field: "error" }).lengthCU, large.length);
  error(reader, { op: "field", revision: a.revision, entityRef, field: "text", offsetCU: large.indexOf("😀") + 1 }, "INVALID_OFFSET");
  source = cut([{ ...t, description: large + "\ud801", title: large + "y" }]);
  const b = open(reader), nextRef = b.items[0].ref;
  assert.equal(a.items[0].descriptorVersion, b.items[0].descriptorVersion); assert.equal(a.version, b.version);
  for (const field of ["text", "metadata"] as const) {
    const next = success<WindowFieldInfo>(reader, { op: "fieldInfo", revision: b.revision, entityRef: nextRef, field });
    assert.notEqual(next.version, versions.get(field));
    error(reader, { op: "field", revision: b.revision, entityRef: nextRef, field, expectedVersion: versions.get(field) }, "STALE");
  }
  assert.equal(success<WindowFieldData>(reader, { op: "field", revision: b.revision, entityRef: nextRef, field: "input", expectedVersion: versions.get("input"), offsetCU: large.length }).chunk.text, "");
});

test("strict requests, safe errors and terminal owner guards never publish revoked captures", () => {
  let captures = 0, current = true, throws = false;
  const source = cut([task(0)]), reader = new TaskWindow(() => { captures++; if (throws) throw new Error("PRIVATE_DIAGNOSTIC"); return source; }, () => current, seed);
  for (const query of [{ op: "open", extra: "x".repeat(20000) }, { op: "open", anchorKey: "raw-call" }, { op: "lookup", revision: "r", kind: "task", reference: null }, []]) error(reader, query, "INVALID_REFERENCE");
  const badId = error(reader, { op: "open" }, "INVALID_REQUEST_ID", " invalid "); assert.equal(badId.requestId, ""); assert.equal(captures, 0);
  const a = open(reader);
  for (const before of [-1, 2, NaN, 0.5, Number.MAX_SAFE_INTEGER + 1]) error(reader, { op: "tasks", revision: a.revision, before }, "INVALID_OFFSET");
  error(reader, { op: "fieldInfo", revision: a.revision, entityRef: a.items[0].ref, field: "thinking" }, "INVALID_FIELD");
  throws = true; error(reader, { op: "open" }, "UNAVAILABLE");
  assert.equal(success<WindowTaskPage>(reader, { op: "tasks", revision: a.revision }).total, 1);
  current = false; error(reader, { op: "tasks", revision: a.revision }, "STALE"); current = true; error(reader, { op: "open" }, "STALE");
  const revoked = new TaskWindow(() => { current = false; return source; }, () => current, seed);
  error(revoked, { op: "open" }, "STALE"); current = true; error(revoked, { op: "open" }, "STALE");
  let guardThrows = true;
  const throwing = new TaskWindow(() => source, () => { if (guardThrows) throw new Error("PRIVATE_DIAGNOSTIC"); return true; }, seed);
  error(throwing, { op: "open" }, "STALE"); guardThrows = false; error(throwing, { op: "open" }, "STALE");
});

test("broken complete membership and duplicate lookup identities fail closed without empty coverage", () => {
  for (const source of [cut([task(0), task(1, { ref: "t1" })]), cut([manyChildren()], { resultVersion: 1,
    resultRefs: [{ taskId: "private-task-0", resultId: "missing", runId: "private-run-0", version: 1 }] }),
    cut([manyChildren()], { resultVersion: 1, resultRefs: [{ taskId: "private-task-0", resultId: "private-result-0", runId: "wrong-run", version: 1 }] })]) {
    error(new TaskWindow(() => source, undefined, seed), { op: "open" }, "UNAVAILABLE");
  }
});

test("real private SQL capture feeds the bounded reader without alias writes or report bodies", t => {
  const f = taskWindowFixture(t), own = f.task("own"), foreign = f.task("foreign", 1, f.session());
  const result = f.result(own, "own-result", "completed", "PRIVATE_REPORT_PAYLOAD".repeat(10000)); f.result(foreign, "foreign-result");
  f.input(own, "own-input", 1, "accepted"); f.store.recordResult(f.scope.sessionId, result.id, "task");
  f.store.db.prepare("INSERT INTO task_model_refs(taskId) VALUES(?)").run(own.id);
  const changes = () => f.store.db.prepare("SELECT total_changes() AS n").get()!.n, before = changes();
  const reader = new TaskWindow(() => captureTaskWindow(f.store, f.scope), () => { f.store.session(f.scope.workspaceId, f.scope.sessionId); return f.store.workspace(f.scope.workspaceId).authorized; }, seed);
  const first = open(reader); assert.equal(changes(), before); assert.equal(first.total, 1); assert.equal(first.state.resultRefs.total, 1);
  assert.equal(first.items[0].anchorKey, identity.key("call", own.anchor)); assert.equal(first.state.resultVersion, 1);
  const page = success<WindowTaskResultPage>(reader, { op: "results", revision: first.revision, taskRef: first.items[0].ref });
  assert.equal(page.total, 1); assert.equal(JSON.stringify(page).includes("PRIVATE_REPORT_PAYLOAD"), false); assert.equal(JSON.stringify(page).includes("foreign"), false);
  const meta = success<WindowFieldData>(reader, { op: "field", revision: first.revision, entityRef: first.items[0].ref, field: "metadata" });
  const modelRef = (JSON.parse(meta.chunk.text) as { modelRef: string }).modelRef;
  assert.equal(success<WindowTaskLocation>(reader, { op: "lookup", revision: first.revision, kind: "task", reference: modelRef }).location!.ref, first.items[0].ref);
  f.store.db.prepare("UPDATE tasks SET status='running' WHERE id=?").run(own.id);
  const second = open(reader); assert.equal(second.items[0].status, "running"); assert.equal(second.items[0].taskKey, first.items[0].taskKey);
  assert.equal(success<WindowTaskPage>(reader, { op: "tasks", revision: first.revision }).items[0].status, "completed");
  f.store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id=?").run(f.scope.workspaceId);
  error(reader, { op: "tasks", revision: second.revision }, "STALE");
  f.store.db.prepare("UPDATE workspaces SET authorized=1 WHERE id=?").run(f.scope.workspaceId);
  error(reader, { op: "open" }, "STALE");
});
