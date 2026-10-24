import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { memoryBatchWaitMs } from "../src/shared/memory-tree.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import { purposeFixture, selection, classification } from "./memory-purpose-fixture.js";

test("classification receives only opaque IDs, purpose text and frozen same-file context; raw bytes are untouched", async () => {
  const f = purposeFixture(); try {
    const scope = f.create("# [Completed] 修复目的索引\n## [Abandoned] ~~旧方案~~\n### [In progress] ~~旧实现~~\n## [Completed] 新方案\n# [In progress] 提升资料查找\n"); f.detail(scope, "正文机密哨兵"); f.memories.scan(scope);
    const path = join(memoryDirectory(f.root, scope.sessionId), "MEMORY.md"), bytes = readFileSync(path); let calls = 0;
    f.memories.runner = { close: async () => {}, execute: async input => {
      calls++; const data = JSON.parse(input.prompt); assert.deepEqual(Object.keys(data).sort(), ["batchIds", "existingTree", "purposes"]);
      assert.deepEqual(Object.keys(data.purposes[0]).sort(), ["context", "id", "text"]);
      assert.deepEqual(data.purposes[0].context, [{ text: "提升资料查找", state: "进行中" }]);
      for (const secret of ["正文机密哨兵", "旧实现", "MEMORY.md", scope.sessionId, f.root]) assert.ok(!input.prompt.includes(secret));
      assert.throws(() => input.read(scope.sessionId, "MEMORY.md"), /不提供/); return classification(input);
    } };
    await f.memories.pipeline.organize(f.tree.batch(f.workspace.id, Date.now() + memoryBatchWaitMs), selection, new AbortController().signal);
    assert.equal(calls, 1); assert.equal(f.tree.snapshot(f.workspace.id).purposes.length, 1); assert.deepEqual(readFileSync(path), bytes);
    const detailPath = "details/修复目的索引.md";
    assert.equal(f.memories.read(scope, detailPath).content, "正文机密哨兵");
    assert.equal(f.memories.save(scope, detailPath, f.memories.read(scope, detailPath).revision, "更新后的正文").content, "更新后的正文");
  } finally { await f.close(); }
});
test("title-path identities survive root reordering; duplicate roots are refused", async () => {
  const f = purposeFixture(); try {
    const scope = f.create("# [Completed] 甲目的\n## [Completed] 验证\n# [Completed] 乙目的\n## [Completed] 验证\n");
    const a = f.detail(scope, "甲详情", "## [Completed] 验证");
    f.memories.scan(scope); const old = f.tree.entries(f.workspace.id);
    assert.equal(old.length, 2); assert.equal(a.path, "details/甲目的/验证.md");
    f.write(scope, "# [Completed] 乙目的\n## [Completed] 验证\n# [Completed] 甲目的\n## [Completed] 验证\n"); f.memories.scan(scope);
    assert.deepEqual(f.tree.entries(f.workspace.id).map(p => p.id), old.map(p => p.id));
    const duplicate = f.create("# [Completed] 同名\n# [Completed] 同名\n"); f.memories.scan(duplicate);
    assert.equal(f.tree.entries(f.workspace.id).length, 2);
  } finally { await f.close(); }
});
test("correction prunes only affected purpose, keeps raw history/ledger, and reuses stable ID on safe reclassification", async () => {
  const f = purposeFixture(); try {
    const scope = f.create("# [Completed] 修复配置\n# [Completed] 保留验证\n"); const a = f.detail(scope, "错误事实 与有效条件", "# [Completed] 修复配置"); f.detail(scope, "无关真实历史", "# [Completed] 保留验证"); f.memories.scan(scope); f.publish();
    const before = f.tree.snapshot(f.workspace.id), old = before.purposes.find(p => p.text === "修复配置")!;
    f.store.db.prepare("INSERT INTO memory_usage VALUES(?,?,?,?,?,?,?)").run("fixture-usage", scope.sessionId, "organize", "fixture", "fixture", "{}", Date.now());
    await f.memories.correct(f.workspace.id, "错误事实"); const pruned = f.tree.snapshot(f.workspace.id);
    assert.deepEqual(pruned.purposes.map(p => p.text), ["保留验证"]); assert.ok(pruned.version > before.version);
    assert.equal(f.tree.entries(f.workspace.id).find(p => p.text === "修复配置")!.id, old.id);
    assert.equal(f.memories.read(scope, a.path).content, " 与有效条件"); assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM memory_usage").get()!.n, 1);
    f.memories.runner = { close: async () => {}, execute: async input => classification(input) };
    await f.memories.pipeline.organize(f.tree.batch(f.workspace.id, Date.now() + memoryBatchWaitMs), selection, new AbortController().signal);
    assert.equal(f.tree.snapshot(f.workspace.id).purposes.find(p => p.text === "修复配置")!.id, old.id);
    const entry = join(memoryDirectory(f.root, scope.sessionId), "MEMORY.md");
    const detail = f.memories.read(scope, a.path); f.memories.save(scope, a.path, detail.revision, detail.content.replace("有效条件", "新有效条件"));
    assert.ok(readFileSync(entry, "utf8").includes("保留验证"));
  } finally { await f.close(); }
});
test("correction during classification prevents late publication even when the runner returns success", async () => {
  const f = purposeFixture(); try {
    const scope = f.create(); f.detail(scope, "待纠正事实"); f.memories.scan(scope); const batch = f.tree.batch(f.workspace.id, Date.now() + memoryBatchWaitMs);
    f.memories.runner = { close: async () => {}, execute: async input => { await f.memories.correct(f.workspace.id, "待纠正事实"); return classification(input); } };
    await assert.rejects(f.memories.pipeline.organize(batch, selection, new AbortController().signal), { code: "REVISION_CONFLICT" }); assert.equal(f.tree.snapshot(f.workspace.id).purposes.length, 0);
  } finally { await f.close(); }
});
test("removed manual commands cannot mutate sources, indexes, corrections or usage", async () => {
  const f = purposeFixture(); try {
    const scope = f.create(); f.memories.scan(scope); f.publish(); const old = f.tree.snapshot(f.workspace.id);
    for (const op of ["memory.organize", "memory.organize.get", "memory.organize.cancel", "memory.summaries.clear"]) await assert.rejects(f.memories.command({ requestId: op, op, ...scope, params: { confirmed: true } }), { code: "UNKNOWN_OPERATION" });
    assert.deepEqual(f.tree.snapshot(f.workspace.id), old); f.store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id=?").run(f.workspace.id); assert.throws(() => f.memories.tree(f.workspace.id), { code: "AUTHORIZATION_REQUIRED" });
  } finally { await f.close(); }
});
