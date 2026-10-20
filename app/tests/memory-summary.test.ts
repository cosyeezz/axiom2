import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { tmpdir } from "./temporary.js";
import { Store } from "../src/server/storage.js";
import { Memories } from "../src/server/memories.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import { memorySummaryVersion } from "../src/shared/memory.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const minute = 60_000;
const selection = { provider: "fixture", id: "fixture", thinking: "off" as const };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-memory-summary-")), project = join(root, "project");
  mkdirSync(project);
  const store = new Store(root);
  const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const create = () => {
    const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    return { workspaceId: workspace.id, sessionId: session.id };
  };
  const scope = create(), memories = new Memories(store, () => {}), directory = memoryDirectory(root, scope.sessionId);
  const configure = (params: Record<string, unknown>) => memories.command({ requestId: randomUUID(), op: "memory.configure", ...scope, params });
  const model = (summary = "处理会话记忆维护，经过方案调整，当前正在验证。") => {
    let calls = 0;
    memories.runner = { close: async () => {}, execute: async (input) => {
      calls++; input.read(scope.sessionId, "MEMORY.md");
      return { answer: JSON.stringify({ title: "记忆维护", summary }), incomplete: false };
    } };
    return () => calls;
  };
  const entry = () => memories.catalog(scope.workspaceId).find((item) => item.sessionId === scope.sessionId)!;
  // Each timing test explicitly drives organizer cycles; only the dedicated
  // scheduler case leaves the interval enabled.
  const manual = () => { clearInterval((memories as any).timer); (memories as any).watcher?.close(); };
  return { root, store, scope, create, memories, directory, configure, model, entry, manual,
    async close() { await memories.close(); store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("legacy summaries are hidden until task-focused regeneration without resetting source stability", async (t) => {
  const f = fixture(); f.manual();
  try {
    await f.configure({ organizerModel: selection, queryModel: selection });
    writeFileSync(join(f.directory, "MEMORY.md"), "## 目标与范围\n改进会话记忆的查找与浏览\n\n实施细节记录在 app/src/server/memories.ts。\n");
    await f.memories.scanAsync();
    const original = f.entry();
    f.store.db.prepare("UPDATE memory_sources SET body=? WHERE sessionId=?").run(JSON.stringify({
      ...original, status: "ready", summary: "修改 app/src/server/memories.ts 的 organizeSource 函数。", indexedAt: Date.now(),
    }), f.scope.sessionId);
    assert.equal(f.entry().summary, ""); assert.equal(f.entry().status, "pending");
    let calls = 0;
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      calls++;
      assert.equal(input.kind, "organize");
      assert.match(input.prompt, /做了什么、解决了什么问题、取得的结果和当前状态/);
      assert.match(input.prompt, /主题与摘要都不包含文件路径、文件名、代码符号/);
      assert.match(input.prompt, /不罗列具体尝试或实现步骤/);
      input.read(f.scope.sessionId, "MEMORY.md");
      return { answer: JSON.stringify({ title: "会话记忆浏览", summary: "改进会话记忆的查找与浏览，便于通过任务成果找到历史资料，当前仍在验证。" }), incomplete: false };
    } };
    const unavailable = await f.memories.query(f.scope, "有哪些会话记忆？");
    assert.equal(calls, 0); assert.deepEqual(unavailable.sources, []);
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 30 * minute });
    await f.memories.scanAsync();
    assert.equal(f.entry().updatedAt, original.updatedAt);
    await f.memories.organize();
    assert.equal(calls, 1); assert.equal(f.entry().status, "ready");
    const raw = JSON.parse(String(f.store.db.prepare("SELECT body FROM memory_sources WHERE sessionId=?").get(f.scope.sessionId)!.body));
    assert.equal(raw.summaryVersion, memorySummaryVersion);
    assert.equal("summaryVersion" in f.entry(), false, "private policy metadata stays out of the UI");
    await f.memories.scanAsync();
    assert.equal(f.entry().status, "ready", "current summaries survive an unchanged scan");
  } finally { await f.close(); }
});

test("entry and detail changes each restart the thirty-minute quiet window, ordinary scans do not", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const f = fixture(); f.manual();
  try {
    await f.configure({ organizerModel: selection, intervalMs: 1000 });
    writeFileSync(join(f.directory, "MEMORY.md"), "进行中的会话事实");
    await f.memories.scanAsync();
    const start = f.entry().updatedAt, calls = f.model();
    await f.memories.organize(); assert.equal(calls(), 0);
    t.mock.timers.tick(29 * minute + 59_000);
    await f.memories.scanAsync();
    assert.equal(f.entry().updatedAt, start);
    await f.memories.organize(); assert.equal(calls(), 0);
    t.mock.timers.tick(1000);
    await f.memories.organize(); assert.equal(calls(), 1);
    assert.equal(f.entry().status, "ready");

    writeFileSync(join(f.directory, "MEMORY.md"), "新增要求后的事实");
    await f.memories.scanAsync();
    assert.equal(f.entry().summary, "");
    const entryChangedAt = f.entry().updatedAt;
    t.mock.timers.tick(29 * minute);
    mkdirSync(join(f.directory, "references"));
    writeFileSync(join(f.directory, "references", "detail.md"), "新增验证结果");
    await f.memories.scanAsync();
    assert.ok(f.entry().updatedAt > entryChangedAt);
    t.mock.timers.tick(minute);
    await f.memories.organize(); assert.equal(calls(), 1, "入口虽已30分钟，专题变化必须重新计时");
    t.mock.timers.tick(29 * minute);
    await f.memories.organize(); assert.equal(calls(), 2);
  } finally { await f.close(); }
});

test("quiet-window timing survives restart and an offline change restarts it", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const f = fixture(); f.manual();
  try {
    await f.configure({ organizerModel: selection, intervalMs: 1000 });
    writeFileSync(join(f.directory, "MEMORY.md"), "重启前保存的事实");
    await f.memories.scanAsync();
    const start = f.entry().updatedAt;
    await f.memories.close();
    t.mock.timers.tick(29 * minute);
    const restarted = new Memories(f.store, () => {});
    clearInterval((restarted as any).timer);
    try {
      await restarted.scanAsync();
      assert.equal(restarted.catalog(f.scope.workspaceId)[0]!.updatedAt, start);
      let calls = 0;
      restarted.runner = { close: async () => {}, execute: async (input) => {
        calls++; input.read(f.scope.sessionId, "MEMORY.md");
        return { answer: JSON.stringify({ title: "重启", summary: "稳定计时已保留" }), incomplete: false };
      } };
      await restarted.organize(); assert.equal(calls, 0);
      t.mock.timers.tick(minute);
      await restarted.organize(); assert.equal(calls, 1);
    } finally { await restarted.close(); }
    writeFileSync(join(f.directory, "MEMORY.md"), "停服期间改变的事实");
    const changed = new Memories(f.store, () => {});
    clearInterval((changed as any).timer);
    try {
      await changed.scanAsync();
      const entry = changed.catalog(f.scope.workspaceId)[0]!;
      assert.equal(entry.summary, ""); assert.equal(entry.updatedAt, Date.now());
    } finally { await changed.close(); }
  } finally { await f.close(); }
});

test("scanning an eligible source does not launch the organizer outside a periodic cycle", async (t) => {
  const f = fixture(); f.manual();
  try {
    await f.configure({ organizerModel: selection });
    writeFileSync(join(f.directory, "MEMORY.md"), "周期整理事实");
    await f.memories.scanAsync();
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 30 * minute });
    const calls = f.model();
    await f.memories.scanAsync();
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(calls(), 0);
    await f.memories.organize(); assert.equal(calls(), 1);
  } finally { await f.close(); }
});

test("organizer enforces 200 Unicode characters without silently truncating the summary", async (t) => {
  const f = fixture(); f.manual();
  try {
    await f.configure({ organizerModel: selection, intervalMs: 1000 });
    writeFileSync(join(f.directory, "MEMORY.md"), "长度边界验证");
    await f.memories.scanAsync();
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 30 * minute });
    f.model("😀".repeat(201));
    await f.memories.organize();
    assert.equal(f.entry().status, "error"); assert.equal(f.entry().summary, "");
    t.mock.timers.tick(1000);
    f.model("😀".repeat(200));
    await f.memories.organize();
    assert.equal(f.entry().status, "ready"); assert.equal(f.entry().summary, "😀".repeat(200));
  } finally { await f.close(); }
});

test("legacy long summaries are hidden immediately and rebuilt without restarting stable-source time", async (t) => {
  const f = fixture(); f.manual();
  try {
    await f.configure({ organizerModel: selection });
    writeFileSync(join(f.directory, "MEMORY.md"), "已有来源的原始事实");
    await f.memories.scanAsync();
    const original = f.entry();
    f.store.db.prepare("UPDATE memory_sources SET body=? WHERE sessionId=?").run(JSON.stringify({ ...original, status: "ready", summary: "旧".repeat(201) }), f.scope.sessionId);
    assert.equal(f.entry().summary, ""); assert.equal(f.entry().status, "pending");
    const query = await f.memories.query(f.scope, "旧摘要");
    assert.equal(query.answer, ""); assert.equal(query.incomplete, true);
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 30 * minute });
    const calls = f.model();
    await f.memories.organize();
    assert.equal(calls(), 1); assert.equal(f.entry().updatedAt, original.updatedAt);
    assert.equal(f.entry().status, "ready");
  } finally { await f.close(); }
});

test("unknown sources count as uncovered, while confirmed empty templates do not", async () => {
  const f = fixture(); f.manual();
  try {
    await f.memories.scanAsync();
    f.create();
    const unknown = await f.memories.query(f.scope, "已有记忆");
    assert.equal(unknown.incomplete, true); assert.equal(unknown.answer, "");
    await f.memories.scanAsync();
    assert.equal((await f.memories.query(f.scope, "已有记忆")).incomplete, false);
  } finally { await f.close(); }
});

test("query rejects an earlier summary invalidated while a later source is being rechecked", async () => {
  const f = fixture(); f.manual();
  try {
    await f.configure({ queryModel: selection });
    const other = f.create();
    writeFileSync(join(f.directory, "MEMORY.md"), "第一个来源");
    writeFileSync(join(memoryDirectory(f.root, other.sessionId), "MEMORY.md"), "第二个来源");
    await f.memories.scanAsync();
    for (const entry of f.memories.catalog(f.scope.workspaceId)) f.store.db.prepare("UPDATE memory_sources SET body=? WHERE sessionId=?").run(JSON.stringify({ ...entry, status: "ready", summaryVersion: memorySummaryVersion, summary: `摘要 ${entry.sessionId}` }), entry.sessionId);
    const internals = f.memories as any, read = internals.readViewInWorker.bind(internals);
    let firstId = "";
    internals.readViewInWorker = async (scope: typeof f.scope) => {
      if (!firstId) firstId = scope.sessionId;
      else {
        const row = f.store.db.prepare("SELECT body FROM memory_sources WHERE sessionId=?").get(firstId)!;
        f.store.db.prepare("UPDATE memory_sources SET body=? WHERE sessionId=?").run(JSON.stringify({ ...JSON.parse(String(row.body)), status: "pending", summary: "" }), firstId);
      }
      return read(scope);
    };
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      assert.equal(input.readChars! + input.prompt.length, f.memories.preferences().readChars, "完整提示占用从同一预算扣除");
      return { answer: "基于旧摘要的答案", incomplete: false };
    } };
    const result = await f.memories.query(f.scope, "全部来源");
    assert.equal(result.answer, ""); assert.equal(result.incomplete, true); assert.equal(result.reason, "revision_conflict");
  } finally { await f.close(); }
});

test("query rejects a saved earlier source before its delayed scan updates the summary", async () => {
  const f = fixture(); f.manual();
  try {
    await f.configure({ queryModel: selection });
    const other = f.create();
    for (const source of [f.scope, other]) writeFileSync(join(memoryDirectory(f.root, source.sessionId), "MEMORY.md"), "保存前的事实");
    await f.memories.scanAsync();
    for (const entry of f.memories.catalog(f.scope.workspaceId)) f.store.db.prepare("UPDATE memory_sources SET body=? WHERE sessionId=?").run(JSON.stringify({ ...entry, status: "ready", summaryVersion: memorySummaryVersion, summary: "保存前的摘要" }), entry.sessionId);
    const internals = f.memories as any, read = internals.readViewInWorker.bind(internals);
    let first: typeof f.scope | undefined, saved = false;
    internals.readViewInWorker = async (scope: typeof f.scope) => {
      const view = await read(scope);
      if (!first) first = scope;
      else if (!saved && scope.sessionId !== first.sessionId) {
        saved = true;
        const document = f.memories.read(first, "MEMORY.md");
        f.memories.save(first, "MEMORY.md", document.revision, "保存后的新事实");
        // Hold only the delayed background scan to reproduce the interval
        // where the write is complete but cache and summary are still old.
        clearTimeout(internals.scanDelay);
      }
      return view;
    };
    f.memories.runner = { close: async () => {}, execute: async () => ({ answer: "依据保存前摘要的旧答案", incomplete: false }) };
    const result = await f.memories.query(f.scope, "当前事实");
    assert.equal(saved, true);
    assert.equal(f.memories.read(first!, "MEMORY.md").content, "保存后的新事实");
    assert.equal(f.memories.catalog(f.scope.workspaceId).find((entry) => entry.sessionId === first!.sessionId)!.summary, "保存前的摘要");
    assert.equal(result.answer, ""); assert.equal(result.incomplete, true); assert.equal(result.reason, "revision_conflict");
  } finally { await f.close(); }
});

test("an over-budget complete summary index is reported instead of truncated or sent partially", async () => {
  const f = fixture(); f.manual();
  try {
    await f.configure({ queryModel: selection, readChars: 16_000 });
    for (let index = 0; index < 60; index++) {
      const scope = index === 0 ? f.scope : f.create();
      writeFileSync(join(memoryDirectory(f.root, scope.sessionId), "MEMORY.md"), `来源 ${index}`);
    }
    await f.memories.scanAsync();
    for (const entry of f.memories.catalog(f.scope.workspaceId)) f.store.db.prepare("UPDATE memory_sources SET body=? WHERE sessionId=?").run(JSON.stringify({ ...entry, status: "ready", summaryVersion: memorySummaryVersion, summary: "摘要".repeat(100) }), entry.sessionId);
    let calls = 0;
    f.memories.runner = { close: async () => {}, execute: async () => { calls++; throw Error("over-budget index must not reach a model"); } };
    const result = await f.memories.query(f.scope, "相关历史");
    assert.equal(calls, 0); assert.equal(result.incomplete, true); assert.deepEqual(result.sources, []);
    assert.match(result.answer, /全部记忆摘要.*预算/);
  } finally { await f.close(); }
});
