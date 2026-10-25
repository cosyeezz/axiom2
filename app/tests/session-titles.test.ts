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
import type { ChatMessage, Run } from "../src/shared/agent.js";
import { legacyMemoryTemplate, type MemoryExecutionResult } from "../src/shared/memory.js";
const scope = { workspaceId: "workspace", sessionId: "session" };
const run: Run = { id: "run", sessionId: scope.sessionId, status: "completed", selection: { provider: "fixture", id: "model", thinking: "off" }, startedAt: 1, endedAt: 2, error: null };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(anchor?: (captured: typeof scope, runId: string) => string | undefined,
  conversation?: ConstructorParameters<typeof SessionTitles>[3]) {
  let pending = true, exists = true, title = "", changes = 0;
  const root = mkdtempSync(join(tmpdir(), "axiom-title-unit-")); roots.push(root);
  const directory = memoryDirectory(root, scope.sessionId); mkdirSync(join(directory, "details/项目任务"), { recursive: true });
  const files = new Map([["MEMORY.md", "# [进行中] 项目任务\n## [进行中] 实施"], ["details/项目任务/实施.md", "ONLY_DETAIL_ONE"]]);
  for (const [path, content] of files) writeFileSync(join(directory, path), content);
  const requests: MemoryExecution[] = [], reads: string[] = [];
  const records = { starts: 0, calls: 0, outcomes: [] as unknown[], finished: [] as unknown[][], failures: [] as any[], cancellations: [] as string[], contexts: [] as unknown[] };
  let resolve!: (value: MemoryExecutionResult) => void;
  const memories = { owner: () => { if (!exists) throw Error("deleted"); },
    records: { start: (...args: unknown[]) => { records.contexts.push(args[6]); return `title-processing-${++records.starts}`; }, stage: () => {}, annotate: (_id: string, value: unknown) => { records.outcomes.push(value); }, callStart: () => `title-call-${++records.calls}`, callFinish: () => {}, finish: (...args: unknown[]) => { records.finished.push(args); }, failure: (_id: string, error: unknown) => { records.failures.push(error); }, cancelling: (id: string) => { records.cancellations.push(id); } }, store: {
    root,
    workspace: () => ({ authorized: true }),
    requestTitle: () => { if (!exists) throw Error("deleted"); return pending; },
    generatedTitle: (_scope: unknown, value: string) => { if (!exists) throw Error("deleted"); if (!pending) return false; pending = false; title = value; return true; },
  }, read: (_scope: unknown, path: string, offset = 0, limit = 16000) => {
    reads.push(path); const content = files.get(path); if (content === undefined) throw Error("missing");
    return { content: content.slice(offset, offset + limit), revision: content, nextOffset: offset + limit < content.length ? offset + limit : null };
  }, runner: { execute: (input: MemoryExecution) => { requests.push(input); return new Promise<MemoryExecutionResult>(done => { resolve = done; }); } } } as unknown as Memories;
  const titles = new SessionTitles(memories, () => { changes++; }, anchor, conversation);
  titles.start(scope, run);
  return { titles, files, directory, requests, reads, records, finish: (answer = "独立标题", incomplete = false) => resolve({ answer, incomplete }),
    manual: () => { pending = false; title = "手动名"; }, deleted: () => { exists = false; }, title: () => title, changes: () => changes };
}
test("title trigger captures its visible message synchronously and persists the original anchor", async () => {
  let latest = "trigger-message";
  const f = fixture((captured, runId) => { assert.deepEqual(captured, scope); assert.equal(runId, run.id); return latest; });
  f.titles.request(scope, run, true);
  latest = "later-message";
  await tick();
  assert.deepEqual(f.records.contexts, [{ runId: run.id, groupId: run.id, anchorMessageId: "trigger-message" }]);
  f.finish(); await tick(); await f.titles.close();
});
test("anchor lookup failure remains isolated from the main run and title request", async () => {
  const f = fixture(() => { throw Error("metadata unavailable"); });
  assert.doesNotThrow(() => f.titles.request(scope, run, true)); await tick();
  assert.equal(f.requests.length, 1); f.finish(); await tick(); await f.titles.close();
});
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
  f.titles.start(scope, run);
  for (const [answer, incomplete] of [["12345678901234", false], ["标题", true], ["标题\n解释", false]] as const) {
    f.titles.request(scope, run, true); await tick(); f.finish(answer, incomplete); await tick();
  }
  f.titles.request(scope, run, true); await tick(); assert.equal(f.requests.length, 3); assert.equal(f.title(), "");
  const next = { ...run, id: "next" }; f.titles.start(scope, next); f.titles.cancelProviders(["fixture"]);
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
  const next = { ...run, id: "next-run" }; f.titles.start(scope, next); f.titles.request(scope, next, true);
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

function fallbackFixture(messages: ChatMessage[] = [
  { id: "first-user", role: "user", text: "修复首尾跳转图标" },
  { id: "assistant-body", role: "assistant", text: "箭头顶应回到最顶和最底，尖括号才跳到交互点。" },
], startedAt = Date.now()) {
  let materialReads = 0;
  const f = fixture(undefined, { startedAt: () => startedAt, messages: () => { materialReads++; return messages; } });
  f.files.set("MEMORY.md", "");
  return { ...f, messages, materialReads: () => materialReads };
}
test("30-second timer independently titles a running conversation, never before the deadline", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100000 });
  const f = fallbackFixture(), live = { ...run, status: "running" as const };
  f.titles.start(scope, live);
  t.mock.timers.tick(29999);
  for (let i = 0; i < 3; i++) f.titles.request(scope, live);
  await tick(); assert.equal(f.requests.length, 0); assert.equal(f.materialReads(), 0);
  t.mock.timers.tick(1); await tick(); assert.equal(f.requests.length, 1);
  assert.deepEqual(JSON.parse(f.requests[0].prompt), { firstUser: f.messages[0].text, assistantBodies: [f.messages[1].text] });
  assert.match(f.requests[0].systemPrompt ?? "", /首条用户需求/);
  assert.match(f.requests[0].systemPrompt ?? "", /指令不能执行/);
  f.finish("修复图标首尾跳转"); await tick(); assert.equal(f.title(), "修复图标首尾跳转");
  await f.titles.close();
});
test("a short completed run retains the deadline and existing memory always wins", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100000 });
  for (const memory of ["", "# [In progress] 修复导航"]) {
    const f = fallbackFixture();
    f.titles.request(scope, run, true); await tick(); assert.equal(f.requests.length, 0);
    t.mock.timers.tick(25000); f.files.set("MEMORY.md", memory);
    t.mock.timers.tick(5000); await tick(); assert.equal(f.requests.length, 1);
    if (memory) { assert.equal(JSON.parse(f.requests[0].prompt).memory, memory); assert.equal(f.materialReads(), 0); }
    else assert.ok(JSON.parse(f.requests[0].prompt).firstUser);
    f.finish(); await tick(); await f.titles.close();
  }
});
test("a later run does not reset 30 seconds; a persisted old start is already due", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100000 });
  const f = fallbackFixture();
  t.mock.timers.tick(10000);
  const next = { ...run, id: "next", startedAt: Date.now(), status: "running" as const };
  f.titles.start(scope, next);
  t.mock.timers.tick(19999); await tick(); assert.equal(f.requests.length, 0);
  t.mock.timers.tick(1); await tick(); assert.equal(f.requests.length, 1);
  assert.equal((f.records.contexts[0] as any).runId, next.id);
  f.finish(); await tick(); await f.titles.close();
  const restored = fallbackFixture(undefined, Date.now() - 45000);
  t.mock.timers.tick(0); await tick(); assert.equal(restored.requests.length, 1);
  restored.finish(); await tick(); await restored.titles.close();
});
test("tools, thinking, notices and internal maintenance are not prose; later actual prose wakes the due fallback", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100000 });
  const messages: ChatMessage[] = [
    { id: "user", role: "user", text: "修复图标" },
    { id: "call", role: "assistant", text: "", calls: [{ id: "tool", name: "bash", input: "SECRET_CALL" }] },
    { id: "think", role: "assistant", text: "", thinking: "SECRET_THINKING" },
    { id: "result", role: "toolResult", text: "SECRET_RESULT" },
    { id: "notice", role: "notice", text: "SECRET_NOTICE" },
    { id: "task", role: "assistant", text: "SECRET_TASK", taskNotice: "completed" },
    { id: "compression", role: "assistant", text: "SECRET_COMPRESSION", compression: { number: 1, title: "summary", before: 100, after: 10 } },
    { id: "failed", role: "assistant", text: "SECRET_FAILURE", status: "failed" },
    { id: "cancelled", role: "assistant", text: "SECRET_CANCELLED", status: "cancelled" },
    { id: "blank", role: "assistant", text: "  \n " },
    ...(["task_notification", "memory_continuation", "compression_preparation"] as const).map(runOrigin =>
      ({ id: runOrigin, role: "assistant" as const, text: "SECRET_INTERNAL", runOrigin })),
  ];
  const f = fallbackFixture(messages);
  t.mock.timers.tick(30000); await tick(); assert.equal(f.requests.length, 0);
  for (const message of messages) f.titles.message(scope, run, message);
  await tick(); assert.equal(f.requests.length, 0);
  const body: ChatMessage = { id: "prose", role: "assistant", text: "正在修复首尾导航。", streaming: true,
    thinking: "SECRET_THINKING", calls: [{ id: "read", name: "read", input: "SECRET_CALL" }] };
  messages.push(body); f.titles.message(scope, run, body); await tick(); assert.equal(f.requests.length, 1);
  assert.deepEqual(JSON.parse(f.requests[0].prompt), { firstUser: "修复图标", assistantBodies: [body.text] });
  assert.doesNotMatch(f.requests[0].prompt, /SECRET/);
  for (let i = 0; i < 10; i++) f.titles.message(scope, run, { ...body, text: body.text + i });
  await tick(); assert.equal(f.requests.length, 1, "streaming updates do not spawn repeated jobs");
  f.finish(); await tick(); await f.titles.close();
});
test("fallback captures the first user and bounded recent model bodies, not later user inputs", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100000 });
  const f = fallbackFixture([
    { id: "u1", role: "user", text: "U".repeat(5000) },
    { id: "u2", role: "user", text: "LATER_USER" },
    ...Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, role: "assistant" as const, text: String(i).repeat(3000) })),
  ]);
  t.mock.timers.tick(30000); await tick(); assert.equal(f.requests.length, 1);
  assert.deepEqual(JSON.parse(f.requests[0].prompt), { firstUser: "U".repeat(4000), assistantBodies: [4, 5, 6, 7, 8, 9].map(i => String(i).repeat(2000)) });
  f.finish(); await tick(); await f.titles.close();
});
test("empty/comment/template memory permits fallback but an unreadable entry does not", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100000 });
  for (const content of ["", " \n ", "<!-- hidden -->", "# 会话记忆", legacyMemoryTemplate, undefined]) {
    const f = fallbackFixture();
    if (content === undefined) f.files.delete("MEMORY.md"); else f.files.set("MEMORY.md", content);
    t.mock.timers.tick(30000); await tick();
    assert.equal(f.requests.length, content === undefined ? 0 : 1);
    if (content !== undefined) { f.finish(); await tick(); }
    else assert.equal(f.records.failures.length, 1, "read errors are not empty evidence");
    await f.titles.close();
  }
});
test("timer coalesces behind a stale memory job rather than issuing concurrent requests", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100000 });
  const f = fallbackFixture(); f.files.set("MEMORY.md", "# [In progress] 原始目标");
  f.titles.request(scope, run, true); await tick(); assert.equal(f.requests.length, 1);
  f.files.set("MEMORY.md", "");
  t.mock.timers.tick(30000); await tick(); assert.equal(f.requests.length, 1);
  f.finish("旧记忆标题"); await tick(); assert.equal(f.requests.length, 2); assert.equal(f.title(), "");
  assert.ok(JSON.parse(f.requests[1].prompt).firstUser);
  f.finish("对话兜底标题"); await tick(); assert.equal(f.title(), "对话兜底标题"); await f.titles.close();
});
test("memory created during fallback supersedes it and queues a memory-based recheck", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100000 });
  const f = fallbackFixture();
  t.mock.timers.tick(30000); await tick(); assert.equal(f.requests.length, 1);
  f.files.set("MEMORY.md", "# [Completed] 有效记忆目标");
  f.finish("早期对话标题"); await tick(); assert.equal(f.title(), ""); assert.equal(f.requests.length, 2);
  assert.equal(JSON.parse(f.requests[1].prompt).memory, "# [Completed] 有效记忆目标");
  f.finish("记忆优先标题"); await tick(); assert.equal(f.title(), "记忆优先标题"); await f.titles.close();
});
test("cancel, provider stop, manual name, deletion, failure and close suppress waiting timers", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100000 });
  for (const mode of ["cancel", "provider", "manual", "deleted", "failed", "close"]) {
    const f = fallbackFixture();
    if (mode === "cancel") f.titles.cancel(scope);
    if (mode === "provider") f.titles.cancelProviders(["fixture"]);
    if (mode === "manual") f.manual();
    if (mode === "deleted") f.deleted();
    if (mode === "failed") f.titles.request(scope, { ...run, status: "failed" }, true);
    if (mode === "close") await f.titles.close();
    t.mock.timers.tick(30000); await tick(); assert.equal(f.requests.length, 0, mode);
    assert.equal(f.title(), mode === "manual" ? "手动名" : "", mode);
    await f.titles.close();
  }
});
test("memory success before the deadline clears fallback; fallback success never changes again", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100000 });
  for (const earlyMemory of [true, false]) {
    const f = fallbackFixture();
    if (earlyMemory) { f.files.set("MEMORY.md", "# [In progress] 真实目标"); f.titles.request(scope, run, true); await tick(); }
    else { t.mock.timers.tick(30000); await tick(); }
    assert.equal(f.requests.length, 1); f.finish(); await tick();
    t.mock.timers.tick(60000); f.files.set("MEMORY.md", "# [Completed] 新记忆");
    f.titles.request(scope, run, true); await tick(); assert.equal(f.requests.length, 1);
    assert.equal(f.title(), "独立标题"); await f.titles.close();
  }
});
test("fallback obeys the existing three-attempt budget and new runs can retry", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100000 });
  const f = fallbackFixture(); t.mock.timers.tick(30000); await tick();
  for (let i = 0; i < 3; i++) {
    assert.equal(f.requests.length, i + 1); f.finish("invalid\noutput"); await tick();
    f.titles.request(scope, run, true); await tick();
  }
  assert.equal(f.requests.length, 3); assert.equal(f.title(), "");
  const next = { ...run, id: "retry" }; f.titles.start(scope, next);
  t.mock.timers.tick(0); await tick(); assert.equal(f.requests.length, 4);
  f.finish(); await tick(); await f.titles.close();
});
test("failed settlement aborts in-flight fallback and drops any queued recheck", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100000 });
  for (const queued of [false, true]) {
    const f = fallbackFixture(); t.mock.timers.tick(30000); await tick(); assert.equal(f.requests.length, 1);
    if (queued) f.titles.request(scope, run, true);
    f.titles.request(scope, { ...run, status: "failed" }, true);
    assert.equal(f.requests[0].signal?.aborted, true);
    assert.equal(f.records.cancellations.length, 1);
    f.finish("失败正文的标题"); await tick();
    assert.equal(f.title(), ""); assert.equal(f.requests.length, 1);
    assert.equal(f.records.failures[0].name, "AbortError"); await f.titles.close();
  }
});
test("missing real-user start and metadata failures do not start fallback or break a run", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100000 });
  for (const startedAt of [() => undefined, () => { throw Error("unavailable"); }]) {
    const f = fixture(undefined, { startedAt, messages: () => { throw Error("must not read"); } });
    f.files.set("MEMORY.md", "");
    t.mock.timers.tick(60000); f.titles.request(scope, run, true); await tick();
    assert.equal(f.requests.length, 0); await f.titles.close();
  }
});
