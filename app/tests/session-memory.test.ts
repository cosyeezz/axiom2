import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, linkSync, unlinkSync } from "node:fs";
import { tmpdir } from "./temporary.js";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Store } from "../src/server/storage.js";
import { TaskRecords } from "../src/server/tasks/records.js";
import { Memories } from "../src/server/memories.js";
import { Costs } from "../src/server/costs.js";
import { textFileCommand, type OpenMemoryFile } from "../src/server/memory-open.js";
import { initializeMemory, memoryDirectory, digest, replaceMemoryFile, readMemoryTextSnapshot, textFile } from "../src/server/memory-files.js";
import { pendingMemoryRead, recordMemoryRead } from "../src/server/memory-recovery.js";
import { memoryInstruction, memoryTemplate, parseMemory } from "../src/shared/memory.js";
import { AppError, type Scope, type Workspace, type Session } from "../src/shared/protocol.js";
function fixture(openFile?: OpenMemoryFile, replaceFile?: typeof replaceMemoryFile, readCorrectionFile?: typeof textFile, observed?: (scope: string) => boolean, readCorrectionSnapshot?: typeof readMemoryTextSnapshot) {
  const root = mkdtempSync(join(tmpdir(), "axiom-memory-")), project = mkdtempSync(join(tmpdir(), "axiom-memory-project-"));
  const store = new Store(root);
  const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const create = () => { const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session; return { workspaceId: workspace.id, sessionId: session.id }; };
  const scope = create(), events: string[] = [], memories = new Memories(store, (key) => events.push(key), openFile, replaceFile, readCorrectionFile, observed, readCorrectionSnapshot);
  return { root, project, store, scope, create, events, memories, directory: memoryDirectory(root, scope.sessionId), async close() { await memories.close(); store.close(); rmSync(root, { recursive: true, force: true }); rmSync(project, { recursive: true, force: true }); } };
}
test("memory budget patches persist, validate limits and preserve existing saved values", async () => {
  const f = fixture(); try {
    f.store.db.prepare("INSERT INTO memory_preferences(id,body) VALUES(1,?)").run(JSON.stringify({ timeoutMs: 120000, readChars: 120000 }));
    assert.equal(f.memories.preferences().timeoutMs, 120000);
    assert.equal(f.memories.preferences().maxTurns, 32, "old records gain the new turn default");
    const configure = (params: Record<string, unknown>) => f.memories.command({ requestId: randomUUID(), op: "memory.configure", workspaceId: f.scope.workspaceId, params });
    await configure({ timeoutMs: 900000, maxTurns: 64 });
    assert.equal(f.memories.preferences().readChars, 120000, "partial updates preserve other saved fields");
    for (const params of [{ timeoutMs: 3600001 }, { readChars: 15999 }, { maxTurns: 0 }, { maxTurns: 129 }, { maxTurns: 1.5 }]) {
      await assert.rejects(configure(params));
      assert.equal(f.memories.preferences().maxTurns, 64, "invalid saves cannot change preferences");
    }
    await f.memories.close();
    const reopened = new Memories(f.store, () => {});
    try { assert.equal(reopened.preferences().timeoutMs, 900000); assert.equal(reopened.preferences().maxTurns, 64); }
    finally { await reopened.close(); }
  } finally { await f.close(); }
});
test("memory initialization only creates entry and never overwrites recovered content", async () => {
  const f = fixture(); try {
    assert.deepEqual(readdirSync(f.directory), ["MEMORY.md"]);
    writeFileSync(join(f.directory, "MEMORY.md"), "用户维护的记忆"); initializeMemory(f.root, f.scope.sessionId);
    assert.equal(readFileSync(join(f.directory, "MEMORY.md"), "utf8"), "用户维护的记忆");
    assert.equal(parseMemory(memoryTemplate).percent, null);
    unlinkSync(join(f.directory, "MEMORY.md"));
    assert.equal(f.memories.view(f.scope).reason, "missing");
    assert.equal(readdirSync(f.directory).includes("MEMORY.md"), false, "missing initialized memory must not be recreated by reading");
  } finally { await f.close(); }
});
test("large memory usage history retains accounting totals through the session index", async () => {
  const f = fixture(); try {
    // Costs 读取完整会话账本；本 fixture 只初始化记忆表，补齐其只读依赖即可。
    f.store.db.exec("CREATE TABLE compressions(id TEXT PRIMARY KEY,sessionId TEXT NOT NULL,body TEXT NOT NULL)");
    const insert = f.store.db.prepare("INSERT INTO memory_usage(id,sessionId,kind,provider,model,usage,createdAt) VALUES(?,?,?,?,?,?,?)");
    for (let index = 0; index < 1000; index++)
      insert.run(`memory-usage-${index}`, f.scope.sessionId, index % 2 ? "query" : "organize", "fixture", "fixture", JSON.stringify({ input: 1, output: 2, cost: { total: .001 } }), index);
    const plan = f.store.db.prepare("EXPLAIN QUERY PLAN SELECT * FROM memory_usage WHERE sessionId=?").all(f.scope.sessionId) as { detail?: string }[];
    assert.ok(plan.some((row) => /memory_usage_session/i.test(String(row.detail))), "费用按会话读取必须命中专用索引");
    const count = f.store.db.prepare("SELECT COUNT(*) AS count FROM memory_usage WHERE sessionId=?").get(f.scope.sessionId) as { count: number };
    assert.equal(count.count, 1000);
    const report = new Costs(f.store).get(f.scope);
    assert.equal(report.total.records, 1000, "索引查询不能遗漏任何记忆费用记录");
    assert.ok(Math.abs(report.total.knownCost - 1) < 1e-9, "汇总费用必须与所有合成记录相同");
  } finally { await f.close(); }
});
test("a batch scan publishes one workspace catalog snapshot instead of one per source", async () => {
  const f = fixture(); try {
    for (let index = 0; index < 7; index++) {
      const source = f.create();
      writeFileSync(join(memoryDirectory(f.root, source.sessionId), "MEMORY.md"), `批量来源 ${index}`);
    }
    writeFileSync(join(f.directory, "MEMORY.md"), "批量来源主会话");
    f.events.length = 0; f.memories.scan();
    assert.equal(f.events.filter((scope) => scope === `memory-catalog:${f.scope.workspaceId}`).length, 1);
  } finally { await f.close(); }
});
test("unobserved memory updates keep cache and catalog but emit no snapshots", async () => {
  let observed = false;
  const f = fixture(undefined, undefined, undefined, () => observed); try {
    const memories = f.memories as any, catalog = memories.catalog.bind(memories); let catalogReads = 0;
    memories.catalog = (workspaceId: string) => { catalogReads++; return catalog(workspaceId); };
    writeFileSync(join(f.directory, "MEMORY.md"), "无订阅时仍需建档的来源");
    f.memories.scan();
    assert.equal(f.events.length, 0, "没有订阅者时不应创建无接收者的 memory 发布");
    assert.equal(catalogReads, 0, "没有订阅者时也不应构造目录发布载荷");
    assert.equal(f.memories.snapshot(f.scope)?.entry, "无订阅时仍需建档的来源");
    assert.equal(f.memories.catalog(f.scope.workspaceId)[0]?.excerpt, "无订阅时仍需建档的来源");
    observed = true;
    writeFileSync(join(f.directory, "MEMORY.md"), "建立订阅后的当前来源");
    f.memories.scan();
    assert.ok(f.events.includes(`memory:${f.scope.workspaceId}:${f.scope.sessionId}`));
    assert.ok(f.events.includes(`memory-catalog:${f.scope.workspaceId}`));
  } finally { await f.close(); }
});
test("ordinary watch events debounce by session without querying every scope or scheduling unknown paths globally", async () => {
  const f = fixture(); try {
    const memories = f.memories as any, watcher = memories.watcher;
    assert.ok(watcher, "当前文件系统应支持用于此回归的 watcher");
    if (memories.scanDelay) clearTimeout(memories.scanDelay);
    memories.scanDelay = undefined; memories.queueAll = false; memories.queuedScopes.clear();
    let scopeQueries = 0;
    const originalScopes = memories.scopes.bind(memories);
    memories.scopes = () => { scopeQueries++; return originalScopes(); };
    for (let index = 0; index < 8; index++) watcher.emit("change", "change", `${f.scope.sessionId}/MEMORY.md`);
    assert.equal(scopeQueries, 0, "同一会话的文件事件不能逐次枚举全部 scope");
    assert.equal(memories.queueAll, false);
    assert.equal(memories.queuedScopes.size, 1);
    memories.queuedScopes.clear();
    watcher.emit("change", "change", "not-a-session/MEMORY.md");
    assert.equal(memories.queueAll, false, "普通未知路径不升级为全局扫描");
  } finally { await f.close(); }
});
test("watch root loss and watcher errors recover through the global safety scan", async () => {
  const missing = fixture(), failed = fixture();
  try {
    const missingMemories = missing.memories as any, root = join(missing.root, "memory", "sessions");
    assert.ok(missingMemories.watcher, "当前文件系统应支持用于此回归的 watcher");
    rmSync(root, { recursive: true, force: true });
    missingMemories.handleWatchEvent(root, `${missing.scope.sessionId}/MEMORY.md`);
    assert.equal(missingMemories.watcher, undefined, "根目录消失后应停止失效 watcher");
    assert.equal(missingMemories.queueAll, true, "根目录消失必须请求全局恢复扫描");
    const failedMemories = failed.memories as any, watcher = failedMemories.watcher;
    assert.ok(watcher, "当前文件系统应支持用于此回归的 watcher");
    watcher.emit("error", Error("模拟 watcher 故障"));
    assert.equal(failedMemories.watcher, undefined, "watcher 故障后应释放失效实例");
    assert.equal(failedMemories.queueAll, true, "watcher 故障必须请求全局恢复扫描");
  } finally { await Promise.all([missing.close(), failed.close()]); }
});
test("unavailable memory reads are empty without exposing foreign data or allowing writes", async () => {
  const f = fixture(); try {
    writeFileSync(join(f.directory, "MEMORY.md"), "private source");
    await f.memories.scanAsync(f.scope);
    const otherProject = join(f.project, "other"); mkdirSync(otherProject);
    const otherWorkspace = f.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: otherProject, authorized: true } }) as Workspace;
    const records = new TaskRecords(f.store);
    const { taskIds } = records.create(f.scope, "anchor", "context", [{ task: "child", role: "" }], { provider: "fixture", id: "fixture", thinking: "off" });
    const childId = String(f.store.db.prepare("SELECT sessionId FROM tasks WHERE id=?").get(taskIds[0])!.sessionId);
    for (const scope of [
      { ...f.scope, workspaceId: otherWorkspace.id },
      { ...f.scope, workspaceId: "missing-workspace" },
      { ...f.scope, sessionId: randomUUID() },
      { ...f.scope, sessionId: childId },
    ]) {
      assert.equal(f.memories.snapshot(scope)?.reason, "unavailable");
      assert.equal((await f.memories.command({ requestId: randomUUID(), op: "memory.get", ...scope }) as any).reason, "unavailable");
      const document = await f.memories.command({ requestId: randomUUID(), op: "memory.read", ...scope }) as any;
      assert.equal(document.content, ""); assert.equal(document.available, false); assert.equal(document.reason, "unavailable");
      assert.throws(() => f.memories.save(scope, "MEMORY.md", digest("private source"), "overwritten"));
    }
    assert.equal(f.memories.snapshot(f.scope)?.entry, "private source", "foreign reads cannot replace the real owner's cache");
    assert.equal(readFileSync(join(f.directory, "MEMORY.md"), "utf8"), "private source");
    unlinkSync(join(f.directory, "MEMORY.md"));
    const view = await f.memories.command({ requestId: randomUUID(), op: "memory.get", ...f.scope });
    assert.equal((view as any).reason, "missing");
    const missingDocument = await f.memories.command({ requestId: randomUUID(), op: "memory.read", ...f.scope }) as any;
    assert.equal(missingDocument.content, ""); assert.equal(missingDocument.reason, "missing");
    await assert.rejects(f.memories.command({ requestId: randomUUID(), op: "memory.get", ...f.scope }, AbortSignal.abort()), { name: "AbortError" });
    const unavailable = await f.memories.query(f.scope, "history");
    assert.equal(unavailable.answer, ""); assert.equal(unavailable.incomplete, true); assert.deepEqual(unavailable.sources, []); assert.ok(unavailable.reason);
    await assert.rejects(f.memories.query(f.scope, "history", AbortSignal.abort()), { name: "AbortError" });
    writeFileSync(join(f.directory, "MEMORY.md"), "recovered source");
    assert.equal((await f.memories.command({ requestId: randomUUID(), op: "memory.get", ...f.scope }) as any).entry, "recovered source");
  } finally { await f.close(); }
});
test("memory storage failure does not prevent session creation or empty reads", async () => {
  const f = fixture(); try {
    rmSync(join(f.root, "memory"), { recursive: true, force: true });
    writeFileSync(join(f.root, "memory"), "blocks memory directory creation");
    const scope = f.create();
    assert.equal(f.store.session(scope.workspaceId, scope.sessionId).id, scope.sessionId);
    assert.equal((await f.memories.command({ requestId: randomUUID(), op: "memory.get", ...scope }) as any).reason, "read_failed");
    const restarted = new Memories(f.store, () => {});
    try { assert.equal(restarted.view(scope).reason, "read_failed"); }
    finally { await restarted.close(); }
  } finally { await f.close(); }
});
test("memory availability reasons distinguish a real missing file, correction hold, and a valid empty template", async () => {
  const f = fixture(); try {
    const path = join(f.directory, "MEMORY.md");
    await f.memories.scanAsync(f.scope);
    const template = await f.memories.command({ requestId: randomUUID(), op: "memory.get", ...f.scope }) as any;
    assert.equal(template.reason, undefined, "合法空模板不是缺失资料");
    assert.equal(template.entry, memoryTemplate);
    assert.deepEqual(f.memories.catalog(f.scope.workspaceId), []);

    writeFileSync(path, "等待用户纠正的旧事实");
    f.store.db.prepare("INSERT INTO memory_corrections(id,workspaceId,target,createdAt) VALUES(?,?,?,?)")
      .run(randomUUID(), f.scope.workspaceId, "等待用户纠正的旧事实", Date.now());
    const held = await f.memories.command({ requestId: randomUUID(), op: "memory.get", ...f.scope }) as any;
    const heldDocument = await f.memories.command({ requestId: randomUUID(), op: "memory.read", ...f.scope }) as any;
    assert.equal(held.reason, "correction_pending");
    assert.equal(heldDocument.reason, "correction_pending");
    assert.equal(f.memories.catalog(f.scope.workspaceId)[0]?.reason, "correction_pending");
  } finally { await f.close(); }
});
test("query without candidates needs neither a runner nor model selection", async () => {
  const f = fixture(); try {
    await f.memories.scanAsync(f.scope);
    assert.deepEqual(await f.memories.query(f.scope, "history"), { answer: "", scope: f.scope, incomplete: false, sources: [] });
  } finally { await f.close(); }
});
test("a restarted memory service publishes its first unchanged view including unavailable sources", async () => {
  const f = fixture(); try {
    for (const missing of [false, true]) {
      if (missing) unlinkSync(join(f.directory, "MEMORY.md"));
      await f.memories.scanAsync(f.scope);
      const events: { scope: string; data: any }[] = [];
      const restarted = new Memories(f.store, (scope, data) => events.push({ scope, data }));
      try {
        assert.equal(restarted.snapshot(f.scope), null);
        await restarted.scanAsync(f.scope);
        const event = events.find((item) => item.scope === `memory:${f.scope.workspaceId}:${f.scope.sessionId}`);
        assert.ok(event, "subscribers must leave loading even when the catalog revision is unchanged");
        assert.equal(event.data.error, undefined);
        if (missing) { assert.equal(event.data.entry, ""); assert.equal(event.data.reason, "missing"); }
        else assert.equal(event.data.entry, memoryTemplate);
      } finally { await restarted.close(); }
    }
  } finally { await f.close(); }
});
test("unauthorized memory correction cannot register a future deletion", async () => {
  const f = fixture(); try {
    writeFileSync(join(f.directory, "MEMORY.md"), "保留事实");
    await f.memories.scanAsync(f.scope);
    f.store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id=?").run(f.scope.workspaceId);
    await assert.rejects(f.memories.correct(f.scope.workspaceId, "保留事实"), { code: "AUTHORIZATION_REQUIRED" });
    assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM memory_corrections").get()!.n, 0);
    assert.equal(readFileSync(join(f.directory, "MEMORY.md"), "utf8"), "保留事实");
  } finally { await f.close(); }
});
test("progress uses explicit estimated workload, not checkbox counts; invalid completed states stay unknown", () => {
  const body = (percent: string, state = "进行中") => `## 目标与范围\n完成迁移\n\n## 任务进度\n整体状态：${state}\n整体进度：${percent}\n当前进展：验证\n- [已完成] 实现\n- [阻塞] 验证\n\n## 下一步与接续位置\n补充证据`;
  const progress = parseMemory(body("约 80%"));
  assert.equal(progress.percent, 80); assert.equal(progress.tasks.length, 2); assert.equal(progress.next, "补充证据");
  for (const estimate of ["100%", "约 45%", "约 110%", "-10%"])
    assert.equal(parseMemory(body(estimate)).progressState, "conflict");
  assert.equal(parseMemory(body("50%")).percent, 50, "十进制步进的进行中进度是有效输入");
  assert.equal(parseMemory(body("100%", "已完成")).percent, null);
  assert.equal(parseMemory(body("100%", "已完成").replace("[阻塞]", "[已完成]")).percent, 100);
});
test("progress accepts explicit legacy fields and real checkboxes without turning prose or links into tasks", () => {
  const legacy = parseMemory(`# 会话记忆

## 目标与状态
用户要求检查二维码布局，浏览器验证仍在继续。整体状态：进行中；整体进度：约60%。类型与构建已通过。
配置说明不是任务。

## 验证与交付
- [完整验收](artifacts/validation.md)
- 普通证据说明

## AOCI与后续
后续如用户要求可正式发布。`);
  assert.equal(legacy.goal, "用户要求检查二维码布局，浏览器验证仍在继续");
  assert.equal(legacy.state, "进行中");
  assert.equal(legacy.percent, 60);
  assert.deepEqual(legacy.tasks, []);

  const checkboxes = parseMemory(`## 当前目标与状态
完成真实验证

## 任务进度
整体状态：进行中；整体进度：40%；当前进展：浏览器验收；下一步：完成移动端检查
- [x] 完成类型检查
- [ ] 完成移动端检查
- [进行中] 核对桌面布局
- [阻塞] 等待实体设备
- [完整验收](artifacts/validation.md)`);
  assert.deepEqual(checkboxes.tasks, [
    { state: "已完成", title: "完成类型检查" },
    { state: "未开始", title: "完成移动端检查" },
    { state: "进行中", title: "核对桌面布局" },
    { state: "阻塞", title: "等待实体设备" },
  ]);
  assert.equal(checkboxes.current, "浏览器验收");
  assert.equal(checkboxes.next, "完成移动端检查");
  const fencedExamples = parseMemory(`## 任务进度
整体状态：进行中
\`\`\`md
- [x] 文档示例
- [进行中] 另一示例
\`\`\`
<!--
- [x] 注释示例
-->
~~~
- [ ] 未闭合示例`);
  assert.deepEqual(fencedExamples.tasks, [], "闭合或未闭合 fenced code 中的 checkbox 不能成为 Todo");
  const hiddenFields = parseMemory(`## 目标与状态
真实目标
\`\`\`md
整体状态：已完成；整体进度：100%；当前进展：示例
\`\`\`
## 任务进度
整体状态：已完成
整体进度：100%`);
  assert.equal(hiddenFields.goal, "真实目标");
  assert.equal(hiddenFields.current, "");
  assert.deepEqual(hiddenFields.tasks, []);
  assert.equal(hiddenFields.progressState, "conflict", "没有显式任务的已完成 100% 不能成为有效进度");
  assert.match(memoryInstruction("C:/memory/MEMORY.md"), /必须保留“## 目标与范围”和“## 任务进度”/);
  assert.match(memoryInstruction("C:/memory/MEMORY.md"), /不能用部署摘要、验证证据链接或普通正文代替任务清单/);
});
test("file changes invalidate semantic content immediately, subscribe locally and reject stale saves", async () => {
  const f = fixture(); try {
    writeFileSync(join(f.directory, "MEMORY.md"), "原始事实"); f.memories.scan();
    const initial = f.memories.read(f.scope), catalog = f.memories.catalog(f.scope.workspaceId)[0];
    f.store.db.prepare("UPDATE memory_sources SET body=? WHERE sessionId=?").run(JSON.stringify({ ...catalog, status: "ready", summary: "旧结论" }), f.scope.sessionId);
    writeFileSync(join(f.directory, "MEMORY.md"), "新结论"); f.events.length = 0; f.memories.scan();
    assert.equal(f.memories.catalog(f.scope.workspaceId)[0].summary, "");
    assert.ok(f.events.every((key) => key.startsWith("memory:") || key.startsWith("memory-catalog:")));
    assert.throws(() => f.memories.save(f.scope, "MEMORY.md", initial.revision, "旧副本"), { code: "REVISION_CONFLICT" });
    assert.equal(readFileSync(join(f.directory, "MEMORY.md"), "utf8"), "新结论");
    const current = f.memories.read(f.scope); f.memories.save(f.scope, "MEMORY.md", current.revision, "已合并");
    assert.equal(f.memories.read(f.scope).content, "已合并");
  } finally { await f.close(); }
});
test("memory read rejects JSONL, hard links, foreign sources and unreferenced project paths", async () => {
  const f = fixture(); try {
    writeFileSync(join(f.project, "allowed.md"), "当前代码证据");
    writeFileSync(join(f.project, "private.md"), "没有授权引用");
    writeFileSync(join(f.project, "raw.jsonl"), "原始对话");
    writeFileSync(join(f.directory, "MEMORY.md"), `[证据](${join(f.project, "allowed.md")})\n[禁止](${join(f.project, "raw.jsonl")})`);
    assert.equal(f.memories.read(f.scope, join(f.project, "allowed.md")).content, "当前代码证据");
    assert.throws(() => f.memories.read(f.scope, join(f.project, "private.md")));
    assert.throws(() => f.memories.read(f.scope, join(f.project, "raw.jsonl")));
    mkdirSync(join(f.directory, "references"));
    linkSync(join(f.project, "raw.jsonl"), join(f.directory, "references", "alias.md"));
    assert.throws(() => f.memories.read(f.scope, "references/alias.md"));
    assert.throws(() => f.memories.read({ ...f.scope, workspaceId: "other" }));
  } finally { await f.close(); }
});
test("ordinary deletion retains file bindings, runs and memory, but blocks execution ownership and list recovery", async () => {
  const f = fixture(); try {
    writeFileSync(join(f.directory, "MEMORY.md"), "需要保留的历史事实"); f.memories.scan();
    const file = join(f.root, "original.jsonl"); writeFileSync(file, "original");
    f.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(f.scope.sessionId, file);
    f.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'completed','{}',1)").run("run", f.scope.sessionId);
    f.store.execute({ requestId: randomUUID(), op: "session.delete", ...f.scope, params: { confirmed: true } });
    assert.deepEqual(f.store.sessions(f.scope.workspaceId), []);
    assert.throws(() => f.store.session(f.scope.workspaceId, f.scope.sessionId), { code: "SCOPE_MISMATCH" });
    assert.equal(f.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(f.scope.sessionId)?.file, file);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM runs").get()?.n, 1);
    assert.equal(f.memories.view(f.scope).deleted, true);
    assert.equal(readFileSync(file, "utf8"), "original");
    f.memories.scan(); assert.equal(f.memories.catalog(f.scope.workspaceId)[0].deleted, true);
  } finally { await f.close(); }
});
test("explicit correction clears exact duplicates without deleting unrelated history and cannot be revived", async () => {
  const f = fixture(); try {
    const other = f.create();
    for (const scope of [f.scope, other]) writeFileSync(join(memoryDirectory(f.root, scope.sessionId), "MEMORY.md"), "错误条目\n此前真实发生的迁移\n有效事实");
    f.memories.scan(); await f.memories.correct(f.scope.workspaceId, "错误条目");
    for (const scope of [f.scope, other]) assert.equal(f.memories.read(scope).content, "\n此前真实发生的迁移\n有效事实");
    writeFileSync(join(f.directory, "MEMORY.md"), "错误条目"); f.memories.scan();
    assert.throws(() => f.memories.read(f.scope), { code: "MEMORY_CORRECTION_PENDING" });
    assert.equal(f.memories.catalog(f.scope.workspaceId).find((e) => e.sessionId === f.scope.sessionId)?.summary, "");
  } finally { await f.close(); }
});
test("organized topics do not invalidate an unchanged source title or trigger another organizer request", async () => {
  const f = fixture(); try {
    f.store.execute({ requestId: randomUUID(), op: "session.rename", ...f.scope, params: { title: "原始会话标题" } });
    f.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(f.scope.sessionId, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
    writeFileSync(join(f.directory, "MEMORY.md"), "已整理的当前事实"); f.memories.scan();
    let calls = 0;
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      calls++; input.read(f.scope.sessionId, "MEMORY.md");
      return { answer: JSON.stringify({ title: "模型生成主题", summary: "可复用摘要", keywords: ["事实"], edits: [] }), incomplete: false };
    } };
    await f.memories.organize();
    const indexed = f.memories.catalog(f.scope.workspaceId)[0]!;
    assert.equal(indexed.status, "ready");
    assert.equal(indexed.summary, "可复用摘要");
    assert.equal(indexed.sourceTitle, "原始会话标题", "公共投影保留原会话标题用于搜索和定位");
    assert.equal("dependencies" in indexed, false, "读取依赖不能进入前端目录投影");
    assert.equal(JSON.parse(String(f.store.db.prepare("SELECT body FROM memory_sources WHERE sessionId=?").get(f.scope.sessionId)!.body)).sourceTitle, "原始会话标题");
    f.memories.scan();
    const rescanned = f.memories.catalog(f.scope.workspaceId)[0]!;
    assert.equal(rescanned.status, "ready");
    assert.equal(rescanned.summary, "可复用摘要");
    f.store.execute({ requestId: randomUUID(), op: "session.rename", ...f.scope, params: { title: "改名后的会话标题" } });
    f.memories.scan();
    const renamed = f.memories.catalog(f.scope.workspaceId)[0]!;
    assert.equal(renamed.status, "ready");
    assert.equal(renamed.summary, "可复用摘要");
    assert.equal(renamed.sourceTitle, "改名后的会话标题");
    assert.equal(JSON.parse(String(f.store.db.prepare("SELECT body FROM memory_sources WHERE sessionId=?").get(f.scope.sessionId)!.body)).sourceTitle, "改名后的会话标题");
    (f.memories as any).lastOrganized = 0; await f.memories.organize();
    assert.equal(calls, 1, "an unchanged source must not be summarized again");
  } finally { await f.close(); }
});
test("one organizer wake drains a fair bounded batch and a failed source does not monopolize it", async () => {
  const f = fixture(); try {
    const sources = [f.scope, ...Array.from({ length: 4 }, () => f.create())];
    for (const [index, source] of sources.entries()) {
      writeFileSync(join(memoryDirectory(f.root, source.sessionId), "MEMORY.md"), `待整理来源 ${index}`);
      f.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(source.sessionId, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
    }
    f.memories.scan();
    const calls: string[] = [];
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      calls.push(input.scope.sessionId);
      if (calls.length === 1) throw Error("首个来源失败");
      input.read(input.scope.sessionId, "MEMORY.md");
      return { answer: JSON.stringify({ title: `主题 ${calls.length}`, summary: "已整理", keywords: [], edits: [] }), incomplete: false };
    } };
    await f.memories.organize();
    const catalog = f.memories.catalog(f.scope.workspaceId);
    assert.equal(calls.length, 4, "一次唤醒最多推进内部小批，不应在首个失败后停止");
    assert.equal(new Set(calls).size, 4, "同一来源在同一批内不能垄断重试机会");
    assert.equal(catalog.filter((entry) => entry.status === "ready").length, 3);
    assert.equal(catalog.filter((entry) => entry.status === "error").length, 1);
    assert.equal(catalog.filter((entry) => entry.status === "pending").length, 1);
  } finally { await f.close(); }
});
test("four persisted empty templates cannot consume the organizer batch before a real pending source", async () => {
  const f = fixture(); try {
    const empty = [f.scope, ...Array.from({ length: 3 }, () => f.create())], usable = f.create();
    for (const source of [...empty, usable])
      f.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(source.sessionId, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
    writeFileSync(join(memoryDirectory(f.root, usable.sessionId), "MEMORY.md"), "真实待整理的来源");
    f.memories.scan();
    const internals = f.memories as any;
    if (internals.organizerWake) { clearTimeout(internals.organizerWake); internals.organizerWake = undefined; }
    const calls: string[] = [];
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      calls.push(input.scope.sessionId); input.read(input.scope.sessionId, "MEMORY.md");
      return { answer: JSON.stringify({ title: "真实来源", summary: "真实摘要", keywords: [], edits: [] }), incomplete: false };
    } };
    await f.memories.organize(true);
    assert.deepEqual(calls, [usable.sessionId]);
    assert.equal(f.memories.catalog(f.scope.workspaceId).find((entry) => entry.sessionId === usable.sessionId)?.status, "ready");
  } finally { await f.close(); }
});
test("organizer prioritizes persisted pending content and bounds rotating unknown-template discovery", async () => {
  const f = fixture(); try {
    const usable = f.create();
    for (let index = 0; index < 12; index++) f.create();
    f.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(usable.sessionId, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
    writeFileSync(join(memoryDirectory(f.root, usable.sessionId), "MEMORY.md"), "优先整理的已建档来源");
    f.memories.scan(usable);
    const internals = f.memories as any;
    if (internals.organizerWake) { clearTimeout(internals.organizerWake); internals.organizerWake = undefined; }
    internals.organizerWakePending = false;
    const scanAsync = internals.scanAsync.bind(internals); let unknownScans = 0, calls = 0;
    internals.scanAsync = async (scope: Scope) => {
      if (scope.sessionId !== usable.sessionId) unknownScans++;
      return scanAsync(scope);
    };
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      calls++; assert.equal(input.scope.sessionId, usable.sessionId);
      input.read(usable.sessionId, "MEMORY.md");
      return { answer: JSON.stringify({ title: "已建档主题", summary: "已建档摘要", keywords: [], edits: [] }), incomplete: false };
    } };
    await f.memories.organize(true);
    assert.equal(calls, 1, "已知有效 pending 必须先取得模型槽位");
    assert.ok(unknownScans <= 4, "单次整理最多探测四个未知模板，不得线性扫描全部会话");
  } finally { await f.close(); }
});
test("a content wake arriving during organization schedules the next bounded batch", async () => {
  const f = fixture(); let release!: () => void, entered!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  try {
    f.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(f.scope.sessionId, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
    writeFileSync(join(f.directory, "MEMORY.md"), "整理中的来源 A"); f.memories.scan(f.scope);
    const internals = f.memories as any;
    if (internals.organizerWake) { clearTimeout(internals.organizerWake); internals.organizerWake = undefined; }
    internals.organizerWakePending = false;
    const calls: string[] = [];
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      calls.push(input.scope.sessionId); input.read(input.scope.sessionId, "MEMORY.md");
      if (input.scope.sessionId === f.scope.sessionId) { entered(); await blocked; }
      return { answer: JSON.stringify({ title: "主题", summary: "摘要", keywords: [], edits: [] }), incomplete: false };
    } };
    const first = f.memories.organize(true);
    await started;
    // Create B only after organizerCandidates has frozen A's first batch.
    const later = f.create();
    f.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(later.sessionId, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
    writeFileSync(join(memoryDirectory(f.root, later.sessionId), "MEMORY.md"), "运行中写入的来源 B"); f.memories.scan(later);
    await new Promise<void>((resolve) => setTimeout(resolve, 280));
    release(); await first;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("整理中的唤醒没有推进来源 B")), 1000);
      const poll = () => calls.includes(later.sessionId) ? (clearTimeout(timer), resolve()) : setTimeout(poll, 10);
      poll();
    });
    assert.ok(calls.includes(later.sessionId), "运行期间的新内容在当前批结束后必须短时推进");
  } finally { release?.(); await f.close(); }
});
test("a reintroduced corrected entry stays externally blocked, then cleanup restores remaining content", async () => {
  const f = fixture(); try {
    const path = join(f.directory, "MEMORY.md");
    writeFileSync(path, "需要清理的旧事实\n保留的有效事实"); f.memories.scan();
    await f.memories.correct(f.scope.workspaceId, "需要清理的旧事实");
    writeFileSync(path, "需要清理的旧事实\n保留的有效事实"); f.memories.scan();
    assert.throws(() => f.memories.read(f.scope), { code: "MEMORY_CORRECTION_PENDING" });
    await f.memories.correct(f.scope.workspaceId, "需要清理的旧事实");
    assert.equal(readFileSync(path, "utf8"), "\n保留的有效事实");
    assert.equal(f.memories.read(f.scope).content, "\n保留的有效事实");
  } finally { await f.close(); }
});
test("correction retries once after a revision conflict and preserves concurrent content", async () => {
  let writes = 0;
  const f = fixture(undefined, (path, revision, content) => {
    writes++;
    if (writes === 1) {
      writeFileSync(path, `${readFileSync(path, "utf8")}\n并发写入的保留内容`);
      throw new AppError("REVISION_CONFLICT", "模拟并发保存冲突");
    }
    replaceMemoryFile(path, revision, content);
  });
  try {
    const path = join(f.directory, "MEMORY.md");
    writeFileSync(path, "需要清理的旧事实\n有效事实"); f.memories.scan();
    await f.memories.correct(f.scope.workspaceId, "需要清理的旧事实");
    assert.equal(writes, 2);
    assert.equal(readFileSync(path, "utf8"), "\n有效事实\n并发写入的保留内容");
  } finally { await f.close(); }
});
test("correction snapshots content and CAS revision together before a concurrent save", async () => {
  let injected = false;
  const f = fixture(undefined, undefined, undefined, undefined, (path) => {
    const snapshot = readMemoryTextSnapshot(path);
    if (!injected) {
      injected = true;
      writeFileSync(path, `\ufeff${snapshot.content}\n并发保存的新内容`);
    }
    return snapshot;
  });
  try {
    const path = join(f.directory, "MEMORY.md");
    writeFileSync(path, "\ufeff需要清理的旧事实\n有效事实"); f.memories.scan();
    await f.memories.correct(f.scope.workspaceId, "需要清理的旧事实");
    assert.equal(readFileSync(path, "utf8"), "\ufeff\n有效事实\n并发保存的新内容");
  } finally { await f.close(); }
});
test("a restarted service retains its private cleanup manifest for reintroduced corrected content", async () => {
  const f = fixture(); try {
    const path = join(f.directory, "MEMORY.md");
    writeFileSync(path, "重启前已纠正的事实\n保留内容"); f.memories.scan();
    await f.memories.correct(f.scope.workspaceId, "重启前已纠正的事实");
    writeFileSync(path, "重启前已纠正的事实\n保留内容");
    await f.memories.close();
    const restarted = new Memories(f.store, () => {});
    try {
      await restarted.correct(f.scope.workspaceId, "重启前已纠正的事实");
      assert.equal(readFileSync(path, "utf8"), "\n保留内容");
      assert.equal(restarted.read(f.scope).content, "\n保留内容");
    } finally { await restarted.close(); }
  } finally { await f.close(); }
});
test("without corrections, oversized detail files do not block unrelated organizer work", async () => {
  let correctionReads = 0;
  const f = fixture(undefined, undefined, (path, maxBytes) => {
    correctionReads++;
    return textFile(path, maxBytes);
  });
  try {
    f.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(f.scope.sessionId, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
    writeFileSync(join(f.directory, "MEMORY.md"), "可整理的入口");
    mkdirSync(join(f.directory, "references"));
    writeFileSync(join(f.directory, "references", "oversized.md"), "x".repeat(4 * 1024 * 1024 + 1));
    let calls = 0;
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      calls++; input.read(f.scope.sessionId, "MEMORY.md");
      return { answer: JSON.stringify({ title: "主题", summary: "正常摘要", keywords: [], edits: [] }), incomplete: false };
    } };
    await f.memories.organize();
    assert.equal(calls, 1);
    assert.equal(correctionReads, 0, "the correction stage must not read files without correction records");
    assert.equal(f.memories.catalog(f.scope.workspaceId)[0]?.status, "ready");
  } finally { await f.close(); }
});
test("a correction failure in one source does not prevent another source from becoming organized", async () => {
  const f = fixture(); try {
    const other = f.create();
    for (const scope of [f.scope, other]) {
      f.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(scope.sessionId, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
      writeFileSync(join(memoryDirectory(f.root, scope.sessionId), "MEMORY.md"), "待清理的重复事实\n可保留的内容");
    }
    const details = join(memoryDirectory(f.root, other.sessionId), "references"); mkdirSync(details);
    writeFileSync(join(details, "unreadable.md"), "待清理的重复事实".repeat(256 * 1024));
    f.store.db.prepare("INSERT INTO memory_corrections VALUES(?,?,?,?)").run(randomUUID(), f.scope.workspaceId, "待清理的重复事实", Date.now());
    let calls = 0;
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      calls++; input.read(input.scope.sessionId, "MEMORY.md");
      return { answer: JSON.stringify({ title: "已恢复来源", summary: "可用摘要", keywords: [], edits: [] }), incomplete: false };
    } };
    await f.memories.organize();
    assert.ok(calls > 0, "one failed detail must not stop the organizer");
    assert.ok(f.memories.catalog(f.scope.workspaceId).some((entry) => entry.status === "ready"));
    assert.equal(f.memories.read(f.scope).content.includes("待清理的重复事实"), false);
  } finally { await f.close(); }
});
test("a summary failure does not make a readable source unavailable to queries", async () => {
  const f = fixture(); try {
    f.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(f.scope.sessionId, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
    writeFileSync(join(f.directory, "MEMORY.md"), "仍可读取的原始事实"); f.memories.scan();
    const entry = f.memories.catalog(f.scope.workspaceId)[0]!;
    f.store.db.prepare("UPDATE memory_sources SET body=? WHERE sessionId=?").run(JSON.stringify({ ...entry, status: "error", error: "摘要模型失败" }), f.scope.sessionId);
    let reads = 0;
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      const document = input.read(f.scope.sessionId, "MEMORY.md"); reads++;
      assert.equal(document.content, "仍可读取的原始事实");
      return { answer: "原文仍可查询", incomplete: false };
    } };
    const result = await f.memories.query(f.scope, "原始事实");
    assert.equal(reads, 1);
    assert.equal(result.answer, "原文仍可查询");
    assert.equal(result.incomplete, true, "summary quality remains incomplete without hiding readable memory");
  } finally { await f.close(); }
});
test("organizer status changes during a query preserve unchanged facts and mark coverage incomplete", async () => {
  const f = fixture(); try {
    (f.memories as any).scheduleOrganizerWake = () => {};
    (f.memories as any).watcher?.close();
    (f.memories as any).watcher = undefined;
    f.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(f.scope.sessionId, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
    writeFileSync(join(f.directory, "MEMORY.md"), "未发生变化的事实");
    await f.memories.scanAsync();
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      assert.equal(input.kind, "query");
      const document = input.read(f.scope.sessionId, "MEMORY.md");
      const row = f.store.db.prepare("SELECT body FROM memory_sources WHERE sessionId=?").get(f.scope.sessionId)!;
      const entry = JSON.parse(String(row.body));
      f.store.db.prepare("UPDATE memory_sources SET body=? WHERE sessionId=?").run(JSON.stringify({ ...entry, status: "error", error: "整理模型不可用" }), f.scope.sessionId);
      return { answer: document.content, incomplete: false };
    } };
    const result = await f.memories.query(f.scope, "当前事实");
    assert.equal(result.answer, "未发生变化的事实");
    assert.equal(result.incomplete, true);
    assert.equal(result.reason, undefined);
  } finally { await f.close(); }
});
test("query discards a late answer as empty after its actually-read source changes", async () => {
  const f = fixture(); try {
    f.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(f.scope.sessionId, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
    writeFileSync(join(f.directory, "MEMORY.md"), "历史事实"); f.memories.scan();
    let resolve!: (result: { answer: string; incomplete: boolean }) => void;
    f.memories.runner = { close: async () => {}, execute: async (input) => { input.read(f.scope.sessionId, "MEMORY.md"); return new Promise((r) => { resolve = r; }); } };
    const query = f.memories.query(f.scope, "历史");
    writeFileSync(join(f.directory, "MEMORY.md"), "已纠正"); resolve({ answer: "旧内容", incomplete: false });
    const discarded = await query;
    assert.equal(discarded.answer, ""); assert.equal(discarded.incomplete, true); assert.deepEqual(discarded.sources, []); assert.equal(discarded.reason, "revision_conflict");
  } finally { await f.close(); }
});
test("organizer cannot publish results against a changed source", async () => {
  const f = fixture(); try {
    writeFileSync(join(f.directory, "MEMORY.md"), "待核实事实"); f.memories.scan();
    f.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(f.scope.sessionId, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      input.read(f.scope.sessionId, "MEMORY.md"); writeFileSync(join(f.directory, "MEMORY.md"), "用户的新事实");
      return { answer: JSON.stringify({ title: "旧主题", summary: "旧摘要", keywords: [], edits: [] }), incomplete: false };
    } };
    await f.memories.organize(); f.memories.scan();
    assert.notEqual(f.memories.catalog(f.scope.workspaceId)[0].summary, "旧摘要");
    assert.equal(f.memories.read(f.scope).content, "用户的新事实");
  } finally { await f.close(); }
});
test("summary-only queries discard correction races and external references are rechecked", async () => {
  const f = fixture(); try {
    f.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(f.scope.sessionId, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
    writeFileSync(join(f.directory, "MEMORY.md"), "旧事实"); f.memories.scan();
    f.memories.runner = { close: async () => {}, execute: async () => { await f.memories.correct(f.scope.workspaceId, "旧事实"); return { answer: "旧事实", incomplete: false }; } };
    const corrected = await f.memories.query(f.scope, "事实");
    assert.equal(corrected.answer, ""); assert.equal(corrected.incomplete, true); assert.equal(corrected.reason, "revision_conflict");
    const projectFile = join(f.project, "evidence.md"); writeFileSync(projectFile, "v1");
    writeFileSync(join(f.directory, "MEMORY.md"), `[当前依据](${projectFile})`); f.memories.scan();
    f.memories.runner = { close: async () => {}, execute: async (input) => { input.read(f.scope.sessionId, projectFile); writeFileSync(projectFile, "v2"); return { answer: "v1", incomplete: false }; } };
    const changedEvidence = await f.memories.query(f.scope, "依据");
    assert.equal(changedEvidence.answer, ""); assert.equal(changedEvidence.incomplete, true); assert.equal(changedEvidence.reason, "revision_conflict");
  } finally { await f.close(); }
});
test("query discards an exposed summary when its persisted external dependency changes", async () => {
  const f = fixture(); try {
    f.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(f.scope.sessionId, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
    const evidence = join(f.project, "summary-evidence.md"); writeFileSync(evidence, "v1");
    writeFileSync(join(f.directory, "MEMORY.md"), `[当前依据](${evidence})`); f.memories.scan();
    const entry = f.memories.catalog(f.scope.workspaceId)[0]!;
    f.store.db.prepare("UPDATE memory_sources SET body=? WHERE sessionId=?").run(JSON.stringify({
      ...entry, status: "ready", title: "旧主题", summary: "依赖 v1 的旧摘要",
      dependencies: [{ sessionId: f.scope.sessionId, path: evidence, revision: digest(readFileSync(evidence)) }],
    }), f.scope.sessionId);
    f.memories.runner = { close: async () => {}, execute: async () => {
      writeFileSync(evidence, "v2");
      return { answer: "根据旧摘要的答案", incomplete: false };
    } };
    assert.deepEqual(await f.memories.query(f.scope, "当前依据"), { answer: "", scope: f.scope, incomplete: true, sources: [], reason: "revision_conflict" });
  } finally { await f.close(); }
});
test("background scans verify stable external dependencies in the worker once per real path and skip old dependencies after source changes", async () => {
  const f = fixture(); try {
    // Disable the watcher before writes. Clearing a queued timer later cannot
    // discard an OS notification that has not reached JavaScript yet.
    const memories = f.memories as any;
    memories.watcher?.close(); memories.watcher = undefined;
    if (memories.scanDelay) clearTimeout(memories.scanDelay);
    memories.scanDelay = undefined; memories.queueAll = false; memories.queuedScopes.clear();
    const other = f.create(), evidence = join(f.project, "shared-evidence.md");
    writeFileSync(evidence, "v1");
    for (const scope of [f.scope, other])
      writeFileSync(join(memoryDirectory(f.root, scope.sessionId), "MEMORY.md"), `[当前依据](${evidence})`);
    f.memories.scan();
    const current = f.memories.catalog(f.scope.workspaceId).find((entry) => entry.sessionId === f.scope.sessionId)!;
    f.store.db.prepare("UPDATE memory_sources SET body=? WHERE sessionId=?").run(JSON.stringify({
      ...current, status: "ready", summary: "只依赖 v1 的摘要", dependencies: [
        { sessionId: f.scope.sessionId, path: evidence, revision: digest(readFileSync(evidence)) },
        { sessionId: other.sessionId, path: evidence, revision: digest(readFileSync(evidence)) },
      ],
    }), f.scope.sessionId);
    const original = memories.verifyDependencyPaths.bind(memories);
    let checks = 0, requested: { key: string; path: string }[] = [];
    memories.verifyDependencyPaths = async (dependencies: { key: string; path: string }[]) => {
      checks++; requested = dependencies; return original(dependencies);
    };
    await f.memories.scanAsync(f.scope);
    assert.equal(checks, 1, "one stable source dispatches one dependency verification request");
    assert.equal(requested.length, 2);
    assert.equal(requested[0]?.path, requested[1]?.path, "the worker receives both authorized triples for its per-path deduplication");
    assert.equal(f.memories.catalog(f.scope.workspaceId).find((entry) => entry.sessionId === f.scope.sessionId)?.status, "ready");
    writeFileSync(join(f.directory, "MEMORY.md"), `[当前依据](${evidence})\n来源已改变`);
    checks = 0;
    await f.memories.scanAsync(f.scope);
    assert.equal(checks, 0, "a changed source invalidates immediately without rereading its old dependencies");
    const invalidated = f.memories.catalog(f.scope.workspaceId).find((entry) => entry.sessionId === f.scope.sessionId)!;
    assert.equal(invalidated.summary, ""); assert.equal(invalidated.status, "pending");
  } finally { await f.close(); }
});
test("query post-validation groups separately authorized reads of one external file into one worker hash", async () => {
  const f = fixture(); try {
    const memories = f.memories as any;
    memories.watcher?.close(); memories.watcher = undefined;
    if (memories.scanDelay) clearTimeout(memories.scanDelay);
    memories.scanDelay = undefined; memories.queueAll = false; memories.queuedScopes.clear();
    const other = f.create(), evidence = join(f.project, "query-shared-evidence.md");
    writeFileSync(evidence, "两份来源共同读取的依据");
    for (const source of [f.scope, other])
      writeFileSync(join(memoryDirectory(f.root, source.sessionId), "MEMORY.md"), `[当前依据](${evidence})`);
    f.memories.scan();
    f.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(f.scope.sessionId, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
    f.memories.runner = { close: async () => {}, execute: async (input) => ({
      answer: `${input.read(f.scope.sessionId, evidence).content}\n${input.read(other.sessionId, evidence).content}`,
      incomplete: false,
    }) };
    const original = memories.verifyDependencyPaths.bind(memories);
    const requests: { key: string; path: string }[][] = [];
    memories.verifyDependencyPaths = async (dependencies: { key: string; path: string }[]) => {
      requests.push(dependencies); return original(dependencies);
    };
    const result = await f.memories.query(f.scope, "共享依据");
    const documentRequest = requests.filter((request) => request.length > 0);
    assert.equal(documentRequest.length, 1, "only the actual-read document post-validation needs a worker hash request");
    assert.equal(documentRequest[0]?.length, 1, "two authorized session/path records resolving to one file hash once");
    assert.equal(result.readDocuments?.length, 2, "each source/path reading record remains available to callers");
  } finally { await f.close(); }
});
test("organizer rechecks external evidence, invalidates dependencies and rotates failed sources", async () => {
  const f = fixture(); try {
    const other = f.create(), file = join(f.project, "current.md"); writeFileSync(file, "v1");
    for (const scope of [f.scope, other]) {
      f.store.db.prepare("INSERT OR REPLACE INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(scope.sessionId, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
      writeFileSync(join(memoryDirectory(f.root, scope.sessionId), "MEMORY.md"), `[当前依据](${file})`);
    }
    f.memories.scan();
    const attempted: string[] = [];
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      attempted.push(input.scope.sessionId); input.read(input.scope.sessionId, "MEMORY.md"); input.read(input.scope.sessionId, file);
      if (attempted.length === 1) writeFileSync(file, "v2");
      return { answer: JSON.stringify({ title: "主题", summary: "依据当前文件", keywords: [], edits: [] }), incomplete: false };
    } };
    await f.memories.organize();
    assert.equal(f.memories.catalog(f.scope.workspaceId).find((s) => s.sessionId === attempted[0])?.status, "error");
    (f.memories as any).lastOrganized = 0; await f.memories.organize();
    assert.equal(new Set(attempted).size, 2, "failed source cannot monopolize later cycles");
    assert.equal(f.memories.catalog(f.scope.workspaceId).find((s) => s.sessionId === attempted[1])?.status, "ready");
    writeFileSync(file, "v3"); f.memories.scan();
    assert.equal(f.memories.catalog(f.scope.workspaceId).find((s) => s.sessionId === attempted[1])?.summary, "");
  } finally { await f.close(); }
});
test("blank templates never request summaries and deleted sources retain referenced attachments", async () => {
  const f = fixture(); try {
    let calls = 0;
    f.memories.runner = { close: async () => {}, execute: async () => { calls++; throw Error("unexpected request"); } };
    await f.memories.organize(); assert.equal(calls, 0);
    const dir = join(f.root, "attachments", f.scope.workspaceId, f.scope.sessionId); mkdirSync(dir, { recursive: true });
    const attachment = join(dir, "report.txt"); writeFileSync(attachment, "历史产物");
    writeFileSync(join(f.directory, "MEMORY.md"), `[报告](${attachment})`);
    f.store.execute({ requestId: randomUUID(), op: "session.delete", ...f.scope, params: { confirmed: true } });
    assert.equal(f.memories.read(f.scope, attachment).content, "历史产物");
  } finally { await f.close(); }
});
test("catalog excludes empty scaffolds, shows literal excerpts and retains real documents and errors", async () => {
  const f = fixture(); try {
    assert.deepEqual(f.memories.catalog(f.scope.workspaceId), []);
    const path = join(f.directory, "MEMORY.md");
    for (const body of ["", "  \n", "# 会话记忆\n\n## 目标与范围\n", memoryTemplate.replaceAll("\n", "\r\n")]) {
      writeFileSync(path, body); f.memories.scan();
      assert.deepEqual(f.memories.catalog(f.scope.workspaceId), []);
    }
    mkdirSync(join(f.directory, "references"));
    const detail = join(f.directory, "references", "decision.md");
    writeFileSync(detail, "有实际内容的详细资料"); f.memories.scan();
    assert.equal(f.memories.catalog(f.scope.workspaceId)[0].hasContent, true);
    unlinkSync(detail);
    writeFileSync(path, memoryTemplate.replace("## 结论与决定\n尚未记录", "## 结论与决定\n迁移保留原始文件")); f.memories.scan();
    const entry = f.memories.catalog(f.scope.workspaceId)[0];
    assert.equal(entry.excerpt, "迁移保留原始文件");
    assert.equal(entry.summary, "", "excerpt must not masquerade as a generated summary");
    assert.equal(entry.entryChars, [...readFileSync(path, "utf8")].length);
    writeFileSync(path, "中文😀\n"); f.memories.scan();
    assert.equal(f.memories.catalog(f.scope.workspaceId)[0].entryChars, 4, "count Unicode characters, not UTF-8 bytes or surrogate halves");
    const cached = { ...f.memories.catalog(f.scope.workspaceId)[0], summary: "已整理", entryChars: undefined };
    f.store.db.prepare("UPDATE memory_sources SET body=? WHERE sessionId=?").run(JSON.stringify(cached), f.scope.sessionId);
    f.memories.scan();
    assert.equal(f.memories.catalog(f.scope.workspaceId)[0].entryChars, 4);
    assert.equal(f.memories.catalog(f.scope.workspaceId)[0].summary, "已整理", "adding counts preserves current summaries");
    writeFileSync(path, memoryTemplate); f.memories.scan();
    assert.deepEqual(f.memories.catalog(f.scope.workspaceId), []);
    assert.equal(readFileSync(path, "utf8"), memoryTemplate, "hiding a template never deletes the file");
    unlinkSync(path); f.memories.scan();
    assert.equal(f.memories.catalog(f.scope.workspaceId)[0].status, "error", "read failures stay visible");
    assert.equal(f.memories.catalog(f.scope.workspaceId)[0].entryChars, null, "read failures must not claim zero characters");
  } finally { await f.close(); }
});
test("local memory open rechecks ownership, text type and document revision without executing scripts", async () => {
  const opened: string[] = [];
  const f = fixture(async (path) => { opened.push(path); });
  try {
    const path = join(f.directory, "MEMORY.md");
    writeFileSync(path, "\uFEFF本地文本😀");
    const document = f.memories.read(f.scope);
    await f.memories.command({ requestId: randomUUID(), op: "memory.open", ...f.scope, params: { path: "MEMORY.md", revision: document.revision } });
    assert.deepEqual(opened, [path]);
    await assert.rejects(f.memories.open(f.scope, "MEMORY.md", "stale"), { code: "REVISION_CONFLICT" });
    await assert.rejects(f.memories.open({ ...f.scope, workspaceId: "foreign" }, "MEMORY.md", document.revision));
    const external = join(f.project, "证据 & file.md"); writeFileSync(external, "文件证据");
    await assert.rejects(f.memories.open(f.scope, external, digest("文件证据")));
    writeFileSync(path, `[证据](<${external}>)`);
    await f.memories.open(f.scope, external, f.memories.read(f.scope, external).revision);
    assert.equal(opened.at(-1), external);
    writeFileSync(path, "引用已经移除");
    await assert.rejects(f.memories.open(f.scope, external, digest("文件证据")));
    mkdirSync(join(f.directory, "scripts")); writeFileSync(join(f.directory, "scripts", "task.ps1"), "Write-Host forbidden");
    await assert.rejects(f.memories.open(f.scope, "scripts/task.ps1", digest("Write-Host forbidden")), { code: "MEMORY_PATH" });
    mkdirSync(join(f.directory, "references")); linkSync(external, join(f.directory, "references", "alias.md"));
    await assert.rejects(f.memories.open(f.scope, "references/alias.md", digest("文件证据")));
    assert.equal(opened.length, 2, "rejected requests never reach the desktop opener");
    f.store.execute({ requestId: randomUUID(), op: "session.delete", ...f.scope, params: { confirmed: true } });
    await f.memories.open(f.scope, "MEMORY.md", f.memories.read(f.scope).revision);
    assert.equal(opened.length, 3, "logical deletion keeps authorized memory access");
    for (const platform of ["win32", "darwin", "linux"] as const) {
      const command = textFileCommand(external, platform);
      assert.equal(command.args.at(-1), external, "file path remains one argument");
      if (platform === "win32") assert.ok(command.file.endsWith(join("System32", "notepad.exe")));
      if (platform === "darwin") assert.deepEqual(command.args, ["-t", external]);
    }
    assert.throws(() => textFileCommand(join(f.project, "task.ps1")));
  } finally { await f.close(); }
});
test("local memory opening preserves failures and serializes concurrent requests", async () => {
  let finish!: () => void;
  const f = fixture(() => new Promise<void>((resolve) => { finish = resolve; }));
  try {
    const revision = f.memories.read(f.scope).revision;
    const request = f.memories.open(f.scope, "MEMORY.md", revision);
    await assert.rejects(f.memories.open(f.scope, "MEMORY.md", revision), { code: "LIMIT" });
    finish(); await request;
    await assert.rejects(f.memories.open(f.scope, "MEMORY.md", revision, AbortSignal.abort()));
  } finally { await f.close(); }
  const failure = fixture(async () => { throw Error("desktop unavailable"); });
  try {
    const revision = failure.memories.read(failure.scope).revision;
    for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(failure.memories.open(failure.scope, "MEMORY.md", revision), /desktop unavailable/);
  } finally { await failure.close(); }
});
test("child settlement refresh cannot poison a main-session scan, before or during scanning", async () => {
  const f = fixture(); try {
    const records = new TaskRecords(f.store);
    await f.memories.scanAsync();
    const { taskIds } = records.create(f.scope, "anchor", "context", [{ task: "child", role: "" }],
      { provider: "fixture", id: "fixture", thinking: "off" });
    const row = f.store.db.prepare("SELECT sessionId FROM tasks WHERE id=?").get(taskIds[0])!;
    const child = { workspaceId: f.scope.workspaceId, sessionId: String(row.sessionId) };
    assert.deepEqual(f.memories.scopes(), [f.scope]);
    f.memories.refresh(child);
    await f.memories.scanAsync(f.scope);
    const scanning = f.memories.scanAsync(f.scope);
    f.memories.refresh(child);
    await scanning;
    assert.ok(f.memories.snapshot(f.scope));
    assert.equal(f.store.db.prepare("SELECT 1 FROM memory_sources WHERE sessionId=?").get(child.sessionId), undefined);
    await f.memories.scanAsync(child);
    assert.equal(f.memories.snapshot(child)?.reason, "unavailable");
  } finally { await f.close(); }
});
test("an invalid queued background source cannot reject or strand another session's scan", async () => {
  const f = fixture(); try {
    await f.memories.scanAsync();
    const invalid = { ...f.scope, sessionId: randomUUID() };
    f.memories.refresh(invalid);
    await f.memories.scanAsync(f.scope);
    assert.ok(f.memories.snapshot(f.scope));
    await f.memories.scanAsync(invalid);
    assert.equal(f.memories.snapshot(invalid)?.reason, "unavailable");
    // A later valid scan must still drain after the invalid background source.
    await f.memories.scanAsync(f.scope);
  } finally { await f.close(); }
});
test("worker scans keep the event loop available and never let an old result replace a save", async () => {
  const f = fixture(); try {
    const references = join(f.directory, "references"); mkdirSync(references);
    // 足以让哈希扫描跨越多个事件循环 tick，同时保持测试临时目录和耗时可控。
    for (let index = 0; index < 32; index++) writeFileSync(join(references, `${index}.md`), "证据".repeat(48_000));
    const current = f.memories.read(f.scope);
    let ticks = 0; const heartbeat = setInterval(() => { ticks++; }, 1);
    const scanning = f.memories.scanAsync(f.scope);
    f.memories.save(f.scope, "MEMORY.md", current.revision, "保存后的当前事实");
    await scanning;
    clearInterval(heartbeat);
    assert.ok(ticks > 0, "文件哈希在 worker 中运行时主线程仍应处理定时回调");
    assert.equal(f.memories.snapshot(f.scope)?.entry, "保存后的当前事实", "在途旧扫描不得覆盖保存后的版本");
  } finally { await f.close(); }
});
test("a targeted scan settles when another source requeues, without waiting for that source", async () => {
  const f = fixture(); let releaseFirst!: () => void, releaseRetry!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const retryGate = new Promise<void>((resolve) => { releaseRetry = resolve; });
  try {
    // This case controls generation invalidation explicitly. OS watcher events
    // must not invalidate B again behind A's deliberately blocked retry.
    (f.memories as any).watcher?.close();
    (f.memories as any).watcher = undefined;
    const other = f.create();
    writeFileSync(join(f.directory, "MEMORY.md"), "来源 A");
    writeFileSync(join(memoryDirectory(f.root, other.sessionId), "MEMORY.md"), "来源 B");
    await f.memories.scanAsync(); // Drain initialization and warm the real scanner before gating A.
    const original = (f.memories as any).scanDirectory.bind(f.memories);
    let calls = 0, entered!: () => void;
    const enteredFirst = new Promise<void>((resolve) => { entered = resolve; });
    (f.memories as any).scanDirectory = async (directory: string) => {
      if (directory === f.directory && ++calls === 1) { entered(); await firstGate; }
      else if (directory === f.directory && calls === 2) await retryGate;
      return original(directory);
    };
    const first = f.memories.scanAsync(f.scope);
    await enteredFirst;
    // This deadline only guards against a stuck queue; worker startup latency
    // is not part of the assertion. A's retry stays gated until B completes.
    const targetedOther = f.memories.scanAsync(other, AbortSignal.timeout(10_000));
    f.memories.refresh(f.scope); // 使 A 的在途读取过期并在 B 后重排。
    releaseFirst();
    await targetedOther;
    assert.equal(f.memories.snapshot(other)?.entry, "来源 B", "B 的调用只等待 B 的目标代次，不能被 A 的重试阻塞");
    releaseRetry();
    await Promise.all([first, targetedOther]);
  } finally {
    releaseFirst?.(); releaseRetry?.();
    await f.close();
  }
});
test("a restarted service queries its cached source while reporting catalog sources it has not loaded", async () => {
  const f = fixture(); try {
    const other = f.create();
    writeFileSync(join(f.directory, "MEMORY.md"), "可查询的当前事实");
    writeFileSync(join(memoryDirectory(f.root, other.sessionId), "MEMORY.md"), "尚未载入的来源");
    f.memories.scan();
    f.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(f.scope.sessionId, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
    const restarted = new Memories(f.store, () => {});
    try {
      // Keep B intentionally unloaded; filesystem notifications are covered by
      // separate watcher cases and would invalidate this query's premise.
      (restarted as any).watcher?.close();
      (restarted as any).watcher = undefined;
      if ((restarted as any).scanDelay) clearTimeout((restarted as any).scanDelay);
      (restarted as any).scanDelay = undefined; (restarted as any).queueAll = false;
      (restarted as any).queuedScopes.clear();
      await restarted.scanAsync(f.scope);
      assert.equal((restarted as any).cachedViews.has(other.sessionId), false, "B must be unloaded before the query");
      let reads = 0;
      restarted.runner = { close: async () => {}, execute: async (input) => {
        reads++; return { answer: input.read(f.scope.sessionId, "MEMORY.md").content, incomplete: false };
      } };
      const result = await restarted.query(f.scope, "当前事实");
      assert.equal(result.answer, "可查询的当前事实");
      assert.equal(result.incomplete, true, "未载入的持久目录条目必须明确为未覆盖");
      assert.equal(reads, 1);
    } finally { await restarted.close(); }
  } finally { await f.close(); }
});
test("Chinese partial phrases rank an older relevant source into the 24 query candidates", async () => {
  const f = fixture(); try {
    // This test observes query ranking; filesystem events and organization have
    // their own tests and must not consume this query-only runner fixture.
    (f.memories as any).scheduleOrganizerWake = () => {};
    (f.memories as any).watcher?.close();
    (f.memories as any).watcher = undefined;
    const relevant = f.scope, sources = [relevant, ...Array.from({ length: 24 }, () => f.create())];
    for (const [index, source] of sources.entries())
      writeFileSync(join(memoryDirectory(f.root, source.sessionId), "MEMORY.md"), index === 0 ? "模型迁移已经完成验证" : `无关资料 ${index}`);
    f.memories.scan();
    // 让建档写入产生的 watch 队列完成，再观察查询自身的候选行为。
    await f.memories.scanAsync();
    f.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(f.scope.sessionId, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
    let enteredCandidates = false, readSource = "";
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      enteredCandidates = input.prompt.includes(`\"sessionId\":\"${relevant.sessionId}\"`);
      const document = input.read(relevant.sessionId, "MEMORY.md"); readSource = relevant.sessionId;
      return { answer: document.content, incomplete: false };
    } };
    const result = await f.memories.query(f.scope, "请问模型迁移现在如何");
    assert.equal(enteredCandidates, true, "非整句中文问法仍应召回较旧的相关来源");
    assert.equal(readSource, relevant.sessionId);
    assert.equal(result.answer, "模型迁移已经完成验证");
  } finally { await f.close(); }
});
test("query post-validation scans only selected or actually read sources", async () => {
  const f = fixture(); try {
    // This case observes query-directed scans. Disable independent filesystem events
    // before creating fixtures; clearing a timer cannot discard undelivered OS events.
    (f.memories as any).watcher?.close();
    (f.memories as any).watcher = undefined;
    const unrelatedProject = join(f.project, "unrelated"); mkdirSync(unrelatedProject);
    const unrelatedWorkspace = f.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: unrelatedProject, authorized: true } }) as Workspace;
    const unrelatedSession = f.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: unrelatedWorkspace.id }) as Session;
    const unrelated = { workspaceId: unrelatedWorkspace.id, sessionId: unrelatedSession.id };
    writeFileSync(join(f.directory, "MEMORY.md"), "当前工作空间的事实");
    writeFileSync(join(memoryDirectory(f.root, unrelated.sessionId), "MEMORY.md"), "无关工作空间的资料");
    f.memories.scan();
    // Drain any initialization scan before counting query and post-validation work.
    await f.memories.scanAsync();
    f.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(f.scope.sessionId, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
    f.memories.runner = { close: async () => {}, execute: async (input) => ({ answer: input.read(f.scope.sessionId, "MEMORY.md").content, incomplete: false }) };
    const original = (f.memories as any).scanDirectory.bind(f.memories);
    const unrelatedDirectory = memoryDirectory(f.root, unrelated.sessionId); let unrelatedScans = 0;
    (f.memories as any).scanDirectory = async (directory: string) => {
      if (directory === unrelatedDirectory) unrelatedScans++;
      return original(directory);
    };
    const result = await f.memories.query(f.scope, "当前事实");
    assert.equal(result.answer, "当前工作空间的事实");
    assert.equal(unrelatedScans, 0, "后验扫描不得重读无关工作空间");
  } finally { await f.close(); }
});
test("summary-only query revalidates a changed generation and never applies a stale worker snapshot", async () => {
  const f = fixture(); let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  try {
    writeFileSync(join(f.directory, "MEMORY.md"), "修订 R0 的来源"); f.memories.scan();
    await f.memories.scanAsync(f.scope);
    f.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(f.scope.sessionId, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
    const entry = f.memories.catalog(f.scope.workspaceId)[0]!;
    f.store.db.prepare("UPDATE memory_sources SET body=? WHERE sessionId=?").run(JSON.stringify({ ...entry, status: "ready", summary: "仅存在于 R0 的旧摘要" }), f.scope.sessionId);
    f.memories.runner = { close: async () => {}, execute: async () => ({ answer: "根据旧摘要的回答", incomplete: false }) };
    const memories = f.memories as any, staleView = memories.cachedViews.get(f.scope.sessionId);
    const readInWorker = memories.readViewInWorker.bind(memories), apply = memories.applyScan.bind(memories);
    const applied: string[] = []; let entered!: () => void;
    const enteredValidation = new Promise<void>((resolve) => { entered = resolve; });
    let reads = 0;
    memories.readViewInWorker = async (scope: Scope) => {
      if (++reads === 1) { entered(); await hold; return staleView; }
      return readInWorker(scope);
    };
    memories.applyScan = (scope: Scope, view: any, changed?: Set<string>) => { applied.push(view.revision); return apply(scope, view, changed); };
    const query = f.memories.query(f.scope, "摘要问题");
    await enteredValidation;
    writeFileSync(join(f.directory, "MEMORY.md"), "修订 R1 的来源");
    memories.invalidate(f.scope);
    release();
    const discarded = await query;
    assert.equal(discarded.answer, ""); assert.equal(discarded.incomplete, true); assert.equal(discarded.reason, "revision_conflict");
    assert.ok(reads >= 2, "generation 变化后必须取得新的定向快照");
    assert.equal(applied.includes(staleView.revision), false, "旧 worker 快照不能写回缓存");
  } finally { await f.close(); }
});
test("query cancellation detaches post-validation and never publishes a late worker result", async () => {
  const f = fixture(); let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  try {
    writeFileSync(join(f.directory, "MEMORY.md"), "可取消的当前事实"); f.memories.scan();
    f.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(f.scope.sessionId, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
    f.memories.runner = { close: async () => {}, execute: async (input) => ({ answer: input.read(f.scope.sessionId, "MEMORY.md").content, incomplete: false }) };
    const view = (f.memories as any).cachedViews.get(f.scope.sessionId), memories = f.memories as any;
    let entered!: () => void, applyCalls = 0;
    const enteredValidation = new Promise<void>((resolve) => { entered = resolve; });
    const originalApply = memories.applyScan.bind(memories);
    memories.readViewInWorker = async () => { entered(); await hold; return view; };
    memories.applyScan = (...args: any[]) => { applyCalls++; return originalApply(...args); };
    const completed = memories.completedGenerations.get(f.scope.sessionId); f.events.length = 0;
    const controller = new AbortController(), pending = f.memories.query(f.scope, "当前事实", controller.signal);
    await enteredValidation; controller.abort();
    const aborted = await Promise.race([
      pending.then(() => false, (error) => error?.name === "AbortError"),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);
    assert.equal(aborted, true, "取消不能等待后验 worker 返回");
    assert.equal(applyCalls, 0); assert.equal(f.events.length, 0);
    assert.equal(memories.completedGenerations.get(f.scope.sessionId), completed);
    release(); await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(applyCalls, 0, "晚到 worker 结果不得回灌缓存");
    assert.equal(f.events.length, 0);
    assert.equal(memories.completedGenerations.get(f.scope.sessionId), completed);
  } finally {
    release?.();
    await f.close();
  }
});
test("query deadline covers post-validation scans and does not apply their late result", async () => {
  const f = fixture(); let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  try {
    writeFileSync(join(f.directory, "MEMORY.md"), "有界查询的当前事实"); f.memories.scan();
    f.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(f.scope.sessionId, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
    f.store.db.prepare("INSERT INTO memory_preferences VALUES(1,?)").run(JSON.stringify({ timeoutMs: 25 }));
    f.memories.runner = { close: async () => {}, execute: async (input) => ({ answer: input.read(f.scope.sessionId, "MEMORY.md").content, incomplete: false }) };
    const memories = f.memories as any, view = memories.cachedViews.get(f.scope.sessionId), apply = memories.applyScan.bind(memories);
    let applied = 0;
    memories.readViewInWorker = async () => { await hold; return view; };
    memories.applyScan = (...args: any[]) => { applied++; return apply(...args); };
    const timedOut = await f.memories.query(f.scope, "当前事实");
    assert.equal(timedOut.answer, ""); assert.equal(timedOut.incomplete, true); assert.equal(timedOut.reason, "timeout"); assert.equal(applied, 0);
    release(); await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(applied, 0, "timeout 后迟到扫描不得回灌状态");
  } finally { release?.(); await f.close(); }
});
test("external memory changes and deletions are eventually published without a synchronous request scan", async () => {
  const f = fixture(); try {
    await f.memories.scanAsync(f.scope);
    const path = join(f.directory, "MEMORY.md"); writeFileSync(path, "外部写入的当前事实");
    const waitFor = async (check: () => boolean) => {
      const until = Date.now() + 3000;
      while (!check()) {
        if (Date.now() >= until) throw Error("文件监视未在时限内发布更新");
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
      }
    };
    await waitFor(() => f.memories.snapshot(f.scope)?.entry === "外部写入的当前事实");
    unlinkSync(path);
    await waitFor(() => f.memories.snapshot(f.scope)?.revision === "empty");
    assert.equal(f.memories.snapshot(f.scope)?.reason, "missing");
  } finally { await f.close(); }
});
test("renaming a session updates its memory catalog without a directory rescan", async () => {
  const f = fixture(); try {
    writeFileSync(join(f.directory, "MEMORY.md"), "保留的记忆"); f.memories.scan(f.scope);
    f.store.execute({ requestId: randomUUID(), op: "session.rename", ...f.scope, params: { title: "更新后的会话标题" } });
    f.memories.rename(f.scope);
    assert.equal(f.memories.catalog(f.scope.workspaceId)[0]?.title, "更新后的会话标题");
    assert.equal(f.memories.snapshot(f.scope)?.entry, "保留的记忆");
  } finally { await f.close(); }
});
test("compaction recovery requires a successful complete actual entry read for each compaction", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-memory-recovery-"));
  try {
    const path = join(root, "MEMORY.md"); writeFileSync(path, "目标\n约束\n下一步");
    const manager = SessionManager.inMemory(root);
    manager.appendMessage({ role: "user", content: "任务", timestamp: Date.now() });
    const first = manager.getLeafId()!; manager.appendCompaction("摘要", first, 1000);
    const id = pendingMemoryRead(manager); assert.ok(id);
    const event = { toolName: "read", input: { path, offset: 1, limit: 1 }, isError: false, content: [{ type: "text", text: "目标" }] };
    assert.equal(recordMemoryRead(manager, path, root, event), false);
    assert.equal(pendingMemoryRead(manager), id);
    assert.equal(recordMemoryRead(manager, path, root, { ...event, content: [{ type: "text", text: "目标\n约束\n下一步" }] }), true);
    assert.equal(pendingMemoryRead(manager), null);
    manager.appendCompaction("第二次摘要", first, 500); assert.ok(pendingMemoryRead(manager));
    assert.equal(recordMemoryRead(manager, path, root, { ...event, isError: true }), false);
    assert.equal(pendingMemoryRead(manager), null, "a failed attempt must not repeatedly demand memory recovery");
    assert.equal(manager.getBranch().filter((e) => e.type === "custom" && e.customType === "axiom-memory-read").length, 1, "unavailable memory is not recorded as a successful read");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
