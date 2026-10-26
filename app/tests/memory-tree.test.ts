import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryPurposes } from "../src/shared/memory-purposes.js";
import { memoryBatchWaitMs, memoryTopicBlock } from "../src/shared/memory-tree.js";
import { purposeFixture } from "./memory-purpose-fixture.js";
import { ProcessingRecords } from "../src/server/processing-records.js";
import type { ProcessingRecord } from "../src/shared/processing.js";

test("only completed H1 purposes in heading-only status trees qualify", () => {
  const entry = "# [Completed] 数据库发布\n## [Completed] 验证事务\n# [In progress] 部署\n## [Completed] 检查依赖\n# [Completed] 矛盾状态\n## [Waiting] 审批\n# [Completed] 保留失败尝试\n## [Abandoned] ~~旧方案~~\n### [In progress] ~~旧实现~~\n## [Completed] 新方案\n";
  assert.deepEqual(memoryPurposes(entry).filter(p => p.complete).map(p => p.title), ["数据库发布", "保留失败尝试"]);
  for (const invalid of ["# 固定标题\n## [Completed] 任务", "# [Completed] 任务\n正文", "## [Completed] 子目的", "# [Completed] 任务\n- [Completed] 列表"]) assert.deepEqual(memoryPurposes(invalid), []);
  assert.equal(memoryPurposes("# [已完成] 中文目的\n## [已完成] 中文步骤")[0].complete, true);
});
test("enqueue allocates opaque stable IDs once per terminal purpose, not per file revision", async () => {
  const f = purposeFixture(); try {
    const scope = f.create("# [Completed] 数据库发布\n## [Completed] 验证\n# [In progress] 界面发布\n");
    f.memories.scan(scope); const first = f.tree.entries(f.workspace.id)[0]; assert.match(first.id, /^p-[0-9a-f-]{36}$/);
    f.memories.scan(scope); assert.equal(f.tree.entries(f.workspace.id).length, 1);
    f.write(scope, "# [Completed] 数据库发布\n## [Completed] 验证 〔9〕\n# [Completed] 界面发布\n"); f.memories.scan(scope);
    assert.equal(f.tree.entries(f.workspace.id).length, 2); assert.equal(f.tree.entries(f.workspace.id)[0].id, first.id);
    assert.deepEqual(first.context, [{ text: "界面发布", state: "进行中" }]);
    const duplicate = f.create("# [Completed] 重复目的\n# [Completed] 重复目的\n"); f.memories.scan(duplicate);
    assert.equal(f.tree.entries(f.workspace.id).length, 2, "ambiguous duplicate titles fail closed");
  } finally { await f.close(); }
});
test("source scans revoke reopened goals and reuse the same ID on completion without version churn", async () => {
  const f = purposeFixture(); try {
    const scope = f.create(); f.memories.scan(scope); f.publish();
    const first = f.tree.entries(f.workspace.id)[0], initial = f.tree.snapshot(f.workspace.id);
    f.memories.scan(scope); assert.equal(f.tree.snapshot(f.workspace.id).version, initial.version);
    f.write(scope, "# [In progress] 验证目的\n## [Completed] 验证结果\n"); f.memories.scan(scope);
    const revoked = f.tree.snapshot(f.workspace.id); assert.equal(revoked.purposes.length, 0); assert.equal(revoked.version, initial.version + 1);
    assert.equal(f.tree.entries(f.workspace.id)[0].blocked, true); assert.equal(f.tree.entries(f.workspace.id)[0].processedAt, null);
    f.memories.scan(scope); assert.equal(f.tree.snapshot(f.workspace.id).version, revoked.version);
    f.write(scope, "# [Completed] 验证目的\n## [Completed] 验证结果\n"); f.memories.scan(scope);
    const restored = f.tree.entries(f.workspace.id)[0]; assert.equal(restored.id, first.id); assert.equal(restored.blocked, false);
    assert.equal(f.tree.tree(f.workspace.id).pending, 1); f.publish(); assert.equal(f.tree.snapshot(f.workspace.id).purposes[0].id, first.id);
  } finally { await f.close(); }
});
test("scan quarantines unsupported ordinal bindings, then publishes a canonical replacement without reviving the duplicate", async () => {
  const f = purposeFixture(); try {
    const scope = f.create(); f.memories.scan(scope); f.publish();
    const before = f.tree.snapshot(f.workspace.id), old = before.purposes[0], row = f.tree.entries(f.workspace.id)[0];
    old.source.key = '["unknown historical meaning",0]';
    f.store.db.prepare("UPDATE memory_purposes SET sourceKey=?,body=? WHERE id=?").run(old.source.key, JSON.stringify({ ...row, source: old.source }), old.id);
    f.store.db.prepare("UPDATE memory_purpose_indexes SET body=? WHERE workspaceId=?").run(JSON.stringify(before), f.workspace.id);
    f.memories.scan(scope);
    let entries = f.tree.entries(f.workspace.id); assert.equal(entries.length, 2); assert.equal(entries.find(p => p.id === old.id)?.blocked, true);
    assert.equal(f.tree.snapshot(f.workspace.id).purposes.length, 0); f.publish();
    const canonical = f.tree.snapshot(f.workspace.id); assert.equal(canonical.purposes.length, 1); assert.notEqual(canonical.purposes[0].id, old.id);
    f.memories.scan(scope); f.memories.scan(scope); entries = f.tree.entries(f.workspace.id);
    assert.equal(entries.length, 2); assert.equal(entries.find(p => p.id === old.id)?.blocked, true);
    assert.equal(f.tree.tree(f.workspace.id).pending, 0); assert.equal(f.tree.snapshot(f.workspace.id).version, canonical.version);
  } finally { await f.close(); }
});
test("a reference annotation requires a new explicit binding and subsequent renumbering cannot reuse it", async () => {
  const f = purposeFixture(); try {
    const scope = f.create(); f.memories.scan(scope); f.publish(); const before = f.tree.snapshot(f.workspace.id);
    f.write(scope, "# [Completed] 验证目的 〔3〕\n## [Completed] 验证结果\n"); f.memories.scan(scope);
    assert.equal(f.tree.entries(f.workspace.id).length, 2); assert.equal(f.tree.entries(f.workspace.id).find(p => p.id === before.purposes[0].id)?.blocked, true);
    f.publish(); const numbered = f.tree.snapshot(f.workspace.id).purposes[0]; assert.equal(numbered.text, "验证目的 〔3〕");
    f.write(scope, "# [Completed] 验证目的 〔4〕\n"); f.memories.scan(scope);
    assert.equal(f.tree.entries(f.workspace.id).find(p => p.id === numbered.id)?.blocked, true);
    assert.equal(f.tree.snapshot(f.workspace.id).purposes.length, 0);
  } finally { await f.close(); }
});
test("legacy plus unnumbered canonical peers stay quarantined across numbered-source scans", async () => {
  const f = purposeFixture(); try {
    const scope = f.create(); f.memories.scan(scope); f.publish();
    const snapshot = f.tree.snapshot(f.workspace.id), canonical = snapshot.purposes[0], row = f.tree.entries(f.workspace.id)[0];
    const legacy = { ...row, id: "legacy-ordinal", source: { ...row.source, key: '["unrelated old label",0]' } };
    f.store.db.prepare("INSERT INTO memory_purposes(id,workspaceId,sessionId,sourceKey,queuedAt,processedAt,body) VALUES(?,?,?,?,?,?,?)").run(legacy.id, f.workspace.id, scope.sessionId, legacy.source.key, row.queuedAt - 1, row.processedAt, JSON.stringify(legacy));
    snapshot.purposes.push(legacy); snapshot.roots[0].children.unshift({ id: legacy.id, purposeId: legacy.id, name: legacy.text, children: [] });
    f.store.db.prepare("UPDATE memory_purpose_indexes SET body=? WHERE workspaceId=?").run(JSON.stringify(snapshot), f.workspace.id);
    f.write(scope, "# [Completed] 验证目的 〔1〕\n## [Completed] 验证结果\n"); f.memories.scan(scope);
    const after = f.tree.snapshot(f.workspace.id); assert.deepEqual(after.purposes, []); assert.equal(f.tree.entries(f.workspace.id).find(p => p.id === canonical.id)?.blocked, true);
    f.memories.scan(scope); f.memories.scan(scope);
    assert.equal(f.tree.entries(f.workspace.id).find(p => p.id === legacy.id)?.blocked, true);
    assert.equal(f.tree.tree(f.workspace.id).pending, 1); assert.equal(f.tree.snapshot(f.workspace.id).version, after.version);
    assert.equal(f.tree.entries(f.workspace.id).find(p => p.source.key === JSON.stringify(["验证目的 〔1〕"]))?.blocked, false, "new numbered binding, not the superseded legacy row, is queued");
  } finally { await f.close(); }
});
test("context freezes nearest four same-file titles/statuses without indexing unfinished helpers", async () => {
  const f = purposeFixture(); try {
    const scope = f.create(Array.from({ length: 7 }, (_, i) => `# [${i === 3 ? "Completed" : "In progress"}] 语境${i}`).join("\n")); f.memories.scan(scope);
    const p = f.tree.entries(f.workspace.id)[0]; assert.equal(f.tree.entries(f.workspace.id).length, 1);
    assert.deepEqual(p.context.map(c => c.text), ["语境1", "语境2", "语境4", "语境5"]);
    f.write(scope, "# [Completed] 语境3\n# [Waiting] 后来改动\n"); f.memories.scan(scope);
    assert.deepEqual(f.tree.entries(f.workspace.id)[0].context, p.context);
  } finally { await f.close(); }
});
test("classification accepts semantic depth but rejects missing, duplicate, forged or rewritten titles and ID fields", async () => {
  const f = purposeFixture(); try {
    const scope = f.create("# [Completed] 事务发布\n# [Completed] 界面验证\n"); f.memories.scan(scope); const purposes = f.tree.entries(f.workspace.id), [a, b] = purposes;
    const valid = [{ name: "数据库", children: [{ name: "事务", children: [{ title: a.text }] }] }, { name: "界面", children: [{ title: b.text }] }];
    const roots = f.tree.classify(JSON.stringify(valid), purposes); assert.equal(roots[0].children[0].children[0].name, a.text);
    for (const value of [[], [{ title: a.text }], [{ name: "其他", children: [{ title: a.text }, { title: b.text }] }], [{ name: "事务", children: [{ title: a.text }, { title: a.text }] }], [{ name: "事务", children: [{ title: "forged" }] }], [{ topic: "旧机制", section: "旧字段", item: "旧事项", content: "旧摘要" }], [{ name: "事务", children: [{ title: a.text, text: "模型改写" }, { title: b.text }] }], [{ name: "事务", children: [{ purposeId: a.id }, { title: b.text }] }]]) assert.throws(() => f.tree.classify(JSON.stringify(value), purposes));
    assert.throws(() => memoryTopicBlock([{ name: "字".repeat(1001) }])); assert.doesNotMatch(memoryTopicBlock(roots), /p-|d-|sessionId|purposeId/);
  } finally { await f.close(); }
});
test("atomic publication preserves old purpose IDs, rejects stale versions and double claims", async () => {
  const f = purposeFixture(); try {
    const first = f.create(); f.memories.scan(first); const batch = f.publish(); const before = f.tree.snapshot(f.workspace.id);
    const second = f.create("# [Completed] 界面发布\n"); f.memories.scan(second); f.publish("语义分类");
    const after = f.tree.snapshot(f.workspace.id); assert.equal(after.version, before.version + 1); assert.equal(after.purposes.length, 2); assert.equal(after.purposes[0].id, before.purposes[0].id);
    assert.throws(() => f.tree.publish(f.workspace.id, batch, before.roots, before.version), { code: "REVISION_CONFLICT" });
    assert.throws(() => f.tree.publish(f.workspace.id, batch, after.roots, after.version), { code: "REVISION_CONFLICT" });
    assert.deepEqual(f.tree.snapshot(f.workspace.id), after);
  } finally { await f.close(); }
});
test("publication and application receipt roll back together on callback or commit failure", async () => {
  for (const failure of ["callback", "commit"] as const) {
    const f = purposeFixture(); let stop: (() => void) | undefined;
    const exec = f.store.db.exec.bind(f.store.db);
    try {
      const scope = f.create(); f.memories.scan(scope);
      const records = ProcessingRecords.for(f.store), id = records.start(scope, "memory.organize", "事务回执");
      const batch = f.tree.batch(f.workspace.id, Date.now() + memoryBatchWaitMs), before = f.tree.snapshot(f.workspace.id);
      const roots = f.tree.classify(JSON.stringify([{ name: "事务", children: batch.map(p => ({ title: p.text })) }]), batch);
      const body = () => String(f.store.db.prepare("SELECT body FROM processing_records WHERE id=?").get(id)!.body);
      const beforeBody = body(), beforeQueue = f.tree.entries(f.workspace.id);
      await new Promise(resolve => setImmediate(resolve));
      const observed: { version: number; state: string }[] = [];
      let publishing = false;
      stop = records.observe(workspaceId => {
        assert.equal(publishing, false, "observers run after the synchronous transaction ends");
        const record = records.command({ requestId: "fixture", op: "processing.get", workspaceId, params: { id } }) as ProcessingRecord;
        observed.push({ version: f.tree.snapshot(workspaceId).version, state: record.state });
      });
      if (failure === "commit") f.store.db.exec = (sql: string) => { if (sql === "COMMIT") throw Error("injected commit failure"); return exec(sql); };
      publishing = true;
      assert.throws(() => f.tree.publish(f.workspace.id, batch, roots, before.version, () => {
        records.annotate(id, { outcome: "applied" }); records.finish(id, "completed");
        assert.equal(observed.length, 0);
        if (failure === "callback") throw Error("injected callback failure");
      }), new RegExp(`injected ${failure} failure`));
      publishing = false; f.store.db.exec = exec;
      assert.deepEqual(f.tree.snapshot(f.workspace.id), before); assert.deepEqual(f.tree.entries(f.workspace.id), beforeQueue);
      assert.equal(body(), beforeBody, "receipt bytes roll back with the native index and queue");
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(observed, [{ version: before.version, state: "running" }], "a payload-free rollback invalidation never reveals uncommitted success");
      observed.length = 0; publishing = true;
      f.tree.publish(f.workspace.id, batch, roots, before.version, () => { records.annotate(id, { outcome: "applied" }); records.finish(id, "completed"); });
      assert.equal(observed.length, 0); publishing = false;
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(observed, [{ version: before.version + 1, state: "completed" }]);
      assert.equal(JSON.parse(body()).outcome, "applied"); assert.equal(f.tree.entries(f.workspace.id).filter(p => p.processedAt === null).length, 0);
    } finally { stop?.(); f.store.db.exec = exec; await f.close(); }
  }
});
test("count and oldest enqueue age share exact 50/30-minute boundaries", async () => {
  const f = purposeFixture(); try {
    const scope = f.create(); f.tree.enqueue(scope, "# [Completed] 边界目的\n", 1000);
    assert.equal(f.tree.batch(f.workspace.id, 1000 + memoryBatchWaitMs - 1).length, 0); assert.equal(f.tree.batch(f.workspace.id, 1000 + memoryBatchWaitMs).length, 1);
    f.tree.enqueue(scope, Array.from({ length: 49 }, (_, i) => `# [Completed] 第${i}个目的`).join("\n"), 2000);
    assert.equal(f.tree.batch(f.workspace.id, 2001).length, 50);
  } finally { await f.close(); }
});
