import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "./temporary.js";
import { memoryDirectory } from "../src/server/memory-files.js";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
import { SessionTitles } from "../src/server/session-titles.js";
import type { Memories, MemoryExecution } from "../src/server/memories.js";
import type { Run } from "../src/shared/agent.js";
import { legacyMemoryTemplate, type MemoryExecutionResult } from "../src/shared/memory.js";
const scope = { workspaceId: "workspace", sessionId: "session" };
const run: Run = { id: "run", sessionId: scope.sessionId, status: "completed", selection: { provider: "fixture", id: "model", thinking: "off" }, startedAt: 1, endedAt: 2, error: null };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  let pending = true, exists = true, title = "", changes = 0;
  const root = mkdtempSync(join(tmpdir(), "axiom-title-unit-")); roots.push(root);
  const directory = memoryDirectory(root, scope.sessionId); mkdirSync(join(directory, "details/项目任务"), { recursive: true });
  const files = new Map([["MEMORY.md", "# [进行中] 项目任务\n## [进行中] 实施"], ["details/项目任务/实施.md", "ONLY_DETAIL_ONE"]]);
  for (const [path, content] of files) writeFileSync(join(directory, path), content);
  const requests: MemoryExecution[] = [], reads: string[] = [];
  const records = { starts: 0, calls: 0, outcomes: [] as unknown[], finished: [] as unknown[][], failures: [] as any[], cancellations: [] as string[] };
  let resolve!: (value: MemoryExecutionResult) => void;
  const memories = { owner: () => { if (!exists) throw Error("deleted"); },
    records: { start: () => `title-processing-${++records.starts}`, stage: () => {}, annotate: (_id: string, value: unknown) => { records.outcomes.push(value); }, callStart: () => `title-call-${++records.calls}`, callFinish: () => {}, finish: (...args: unknown[]) => { records.finished.push(args); }, failure: (_id: string, error: unknown) => { records.failures.push(error); }, cancelling: (id: string) => { records.cancellations.push(id); } }, store: {
    root,
    workspace: () => ({ authorized: true }),
    requestTitle: () => { if (!exists) throw Error("deleted"); return pending; },
    generatedTitle: (_scope: unknown, value: string) => { if (!exists) throw Error("deleted"); if (!pending) return false; pending = false; title = value; return true; },
  }, read: (_scope: unknown, path: string, offset = 0, limit = 16000) => {
    reads.push(path); const content = files.get(path); if (content === undefined) throw Error("missing");
    return { content: content.slice(offset, offset + limit), revision: content, nextOffset: offset + limit < content.length ? offset + limit : null };
  }, runner: { execute: (input: MemoryExecution) => { requests.push(input); return new Promise<MemoryExecutionResult>(done => { resolve = done; }); } } } as unknown as Memories;
  const titles = new SessionTitles(memories, () => { changes++; });
  titles.start(scope, run.id);
  return { titles, files, directory, requests, reads, records, finish: (answer = "独立标题", incomplete = false) => resolve({ answer, incomplete }),
    manual: () => { pending = false; title = "手动名"; }, deleted: () => { exists = false; }, title: () => title, changes: () => changes };
}
test("every third main request and settlement; single flight, exact details, success once", async () => {
  const f = fixture();
  f.titles.request(scope, run); f.titles.request(scope, run); await tick(); assert.equal(f.requests.length, 0);
  f.titles.request(scope, run); await tick(); assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].kind, "title");
  assert.equal(f.requests[0].selection, run.selection);
  assert.deepEqual(JSON.parse(f.requests[0].prompt), { memory: f.files.get("MEMORY.md"), details: [{ heading: "实施", content: "ONLY_DETAIL_ONE" }] });
  assert.ok(f.reads.every(path => path === "MEMORY.md" || path === "details/项目任务/实施.md"));
  assert.throws(() => f.requests[0].read("session", "file"));
  f.titles.request(scope, run, true); await tick(); assert.equal(f.requests.length, 1);
  f.finish("一二三四五六七八九十甲乙丙"); await tick(); assert.equal(f.title(), "一二三四五六七八九十甲乙丙"); assert.equal(f.changes(), 1);
  f.titles.request(scope, run, true); await tick(); assert.equal(f.requests.length, 1);
  await f.titles.close();
});
test("empty/comment memory does not request; settlement catches newly available memory", async () => {
  const f = fixture();
  for (const content of ["", "  ", "<!-- hidden -->", "# 会话记忆", legacyMemoryTemplate]) {
    f.files.set("MEMORY.md", content); f.titles.request(scope, run, true); await tick();
  }
  assert.equal(f.requests.length, 0);
  assert.equal(f.records.calls, 0, "empty-memory checks never enter a title model call");
  assert.equal(f.records.outcomes.length, 5); assert.ok(f.records.outcomes.every(value => (value as any).outcome === "no_evidence"));
  f.files.set("MEMORY.md", "# [进行中] 真正目标\n## [未开始] 操作");
  f.titles.request(scope, run, true); await tick(); assert.equal(f.requests.length, 1); f.finish(); await tick(); await f.titles.close();
});
test("invalid/incomplete outputs bounded to three attempts, failed runs do not start title", async () => {
  const f = fixture();
  f.titles.request(scope, { ...run, status: "cancelled" }, true); await tick(); assert.equal(f.requests.length, 0);
  for (const [answer, incomplete] of [["12345678901234", false], ["标题", true], ["标题\n解释", false]] as const) {
    f.titles.request(scope, run, true); await tick(); f.finish(answer, incomplete); await tick();
  }
  f.titles.request(scope, run, true); await tick(); assert.equal(f.requests.length, 3); assert.equal(f.title(), "");
  const next = { ...run, id: "next" }; f.titles.start(scope, next.id); f.titles.cancelProviders(["fixture"]);
  f.titles.request(scope, next, true); await tick(); assert.equal(f.requests.length, 4, "new run retries; inactive provider does not cancel it");
  f.finish(); await tick(); await f.titles.close();
});
test("manual title, cancellation, provider stop, deletion and close reject late results", async () => {
  for (const mode of ["manual", "cancel", "provider", "deleted", "close"]) {
    const f = fixture(); f.titles.request(scope, run, true); await tick();
    let closing: Promise<void> | undefined;
    if (mode === "manual") f.manual();
    if (mode === "cancel") f.titles.cancel(scope);
    if (mode === "provider") f.titles.cancelProviders(["fixture"]);
    if (mode === "deleted") f.deleted();
    if (mode === "close") closing = f.titles.close();
    f.finish(); await tick(); await closing;
    assert.equal(f.title(), mode === "manual" ? "手动名" : "", mode); assert.equal(f.changes(), 0);
    f.titles.request(scope, run, true); await tick(); assert.equal(f.requests.length, 1, mode); await f.titles.close();
  }
});
test("absent detail files are optional; existing unreadable details reject partial material", async () => {
  const f = fixture(); rmSync(join(f.directory, "details/项目任务/实施.md")); f.files.delete("details/项目任务/实施.md");
  f.titles.request(scope, run, true); await tick(); assert.equal(f.requests.length, 1);
  assert.deepEqual(JSON.parse(f.requests[0].prompt).details, []); f.finish(); await tick(); await f.titles.close();
  const broken = fixture(); broken.files.delete("details/项目任务/实施.md");
  broken.titles.request(scope, run, true); await tick(); assert.equal(broken.requests.length, 0); await broken.titles.close();
});
test("manual names before generation skip all material reads and model calls", async () => {
  const f = fixture(); f.manual(); f.titles.request(scope, run, true); await tick();
  assert.equal(f.requests.length, 0); assert.equal(f.records.calls, 0); assert.equal(f.reads.length, 0); assert.equal(f.title(), "手动名");
  await f.titles.close();
});
test("source changes during title generation invalidate the result without overwriting the fallback", async () => {
  for (const path of ["MEMORY.md", "details/项目任务/实施.md"]) {
    const f = fixture(); f.titles.request(scope, run, true); await tick();
    f.files.set(path, f.files.get(path)! + "\n资料更新"); f.finish(); await tick();
    assert.equal(f.title(), ""); assert.equal(f.changes(), 0);
    assert.equal(f.records.failures.length, 1); assert.equal(f.records.failures[0].code, "REVISION_CONFLICT");
    await f.titles.close();
  }
});
test("settlement overlapping an in-flight stale title queues one fresh bounded recheck", async () => {
  const f = fixture(); for (let i = 0; i < 3; i++) f.titles.request(scope, run); await tick();
  assert.equal(f.requests.length, 1);
  f.files.set("MEMORY.md", "# [Completed] 新记忆目标");
  for (let i = 0; i < 3; i++) f.titles.request(scope, run, true);
  f.finish("旧资料标题"); await tick(); assert.equal(f.requests.length, 2, "settlement is coalesced, not lost or repeated");
  assert.equal(f.title(), ""); assert.equal(JSON.parse(f.requests[1].prompt).memory, "# [Completed] 新记忆目标");
  f.finish("新资料标题"); await tick(); assert.equal(f.title(), "新资料标题"); assert.equal(f.requests.length, 2);
  await f.titles.close();
});
test("new or removed related files invalidate title material even if the entry revision is unchanged", async () => {
  for (const change of ["add", "remove-detail", "remove-entry"]) {
    const f = fixture(), path = change === "remove-entry" ? "MEMORY.md" : "details/项目任务/实施.md";
    if (change === "add") { rmSync(join(f.directory, path)); f.files.delete(path); }
    f.titles.request(scope, run, true); await tick(); assert.equal(f.requests.length, 1);
    if (change === "add") { writeFileSync(join(f.directory, path), "新详情"); f.files.set(path, "新详情"); }
    else { rmSync(join(f.directory, path)); f.files.delete(path); }
    f.finish(); await tick(); assert.equal(f.title(), ""); assert.equal(f.records.failures[0]?.code, "REVISION_CONFLICT", change);
    await f.titles.close();
  }
});
test("a new run receives its own retry budget while the preceding third attempt is in flight", async () => {
  const f = fixture();
  for (let i = 0; i < 2; i++) { f.titles.request(scope, run, true); await tick(); f.finish("invalid\noutput"); await tick(); }
  f.titles.request(scope, run, true); await tick(); assert.equal(f.requests.length, 3);
  const next = { ...run, id: "next-run" }; f.titles.start(scope, next.id); f.titles.request(scope, next, true);
  f.finish("旧运行标题"); await tick(); assert.equal(f.title(), ""); assert.equal(f.requests.length, 4, "old run cannot consume the new run's budget");
  assert.equal(f.records.failures.at(-1)?.code, "REVISION_CONFLICT");
  f.finish("新运行标题"); await tick(); assert.equal(f.title(), "新运行标题"); await f.titles.close();
});
test("cancel marks the title as cancelling immediately, drops queued settlement and rejects late output", async () => {
  const f = fixture(); f.titles.request(scope, run, true); await tick();
  f.titles.request(scope, run, true); f.titles.cancel(scope);
  assert.equal(f.records.cancellations.length, 1);
  f.finish(); await tick(); assert.equal(f.title(), ""); assert.equal(f.requests.length, 1);
  assert.equal(f.records.failures[0].name, "AbortError"); await f.titles.close();
});
