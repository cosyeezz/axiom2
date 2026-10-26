import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { memoryDirectory } from "../src/server/memory-files.js";
import { memoryBatchWaitMs } from "../src/shared/memory-tree.js";
import { purposeFixture, selection, classification, navigation } from "./memory-purpose-fixture.js";

test("purpose classification does not generate summaries, change raw source timing, or repeat on detail changes/rename", async () => {
  const f = purposeFixture(); try {
    await f.configure({ organizerModel: selection }); const scope = f.create(); const d = f.detail(scope, "原始结论"); f.memories.scan(scope);
    const before = f.memories.catalog(f.workspace.id)[0], queuedAt = f.tree.entries(f.workspace.id)[0].queuedAt; let calls = 0;
    f.memories.runner = { close: async () => {}, execute: async input => { calls++; return classification(input); } };
    await f.memories.pipeline.organize(f.tree.batch(f.workspace.id, queuedAt + memoryBatchWaitMs), selection, new AbortController().signal);
    const indexed = f.memories.catalog(f.workspace.id)[0]; assert.equal(indexed.updatedAt, before.updatedAt); assert.equal(indexed.status, "ready"); assert.equal(indexed.summary, ""); assert.deepEqual(indexed.keywords, []);
    const detail = f.memories.read(scope, d.path); f.memories.save(scope, d.path, detail.revision, "新的结论");
    f.store.execute({ requestId: "rename", op: "session.rename", ...scope, params: { title: "新会话名称" } }); f.memories.rename(scope); f.memories.scan(scope);
    await f.memories.organize(); assert.equal(calls, 1); assert.equal(f.tree.entries(f.workspace.id).length, 1); assert.equal(f.tree.entries(f.workspace.id)[0].queuedAt, queuedAt);
  } finally { await f.close(); }
});
test("old persisted settings/summary tables remain untouched but never drive new classification", async () => {
  const f = purposeFixture(); try {
    const scope = f.create(); f.memories.scan(scope); const row = f.store.db.prepare("SELECT body FROM memory_sources WHERE sessionId=?").get(scope.sessionId)!;
    f.store.db.prepare("UPDATE memory_sources SET body=? WHERE sessionId=?").run(JSON.stringify({ ...JSON.parse(String(row.body)), title: "旧模型标题", sourceTitle: "真实来源", summary: "旧生成摘要", keywords: ["旧关键词"], dependencies: [{ path: "forged" }] }), scope.sessionId);
    f.store.db.prepare("INSERT INTO memory_preferences VALUES(1,?)").run(JSON.stringify({ intervalMs: 1, topicNameReviewThresholdChars: 1, readChars: 64000 }));
    assert.ok(!("intervalMs" in f.memories.preferences())); assert.ok(!("topicNameReviewThresholdChars" in f.memories.preferences())); assert.equal(f.memories.catalog(f.workspace.id)[0].summary, "");
    assert.deepEqual(f.memories.catalog(f.workspace.id)[0].keywords, []); assert.ok(!("dependencies" in f.memories.catalog(f.workspace.id)[0]));
    for (const patch of [{ intervalMs: 1 }, { topicNameReviewThresholdChars: 1 }]) await assert.rejects(f.configure(patch), { code: "INVALID_INPUT" });
    assert.equal(JSON.parse(String(f.store.db.prepare("SELECT body FROM memory_sources WHERE sessionId=?").get(scope.sessionId)!.body)).summary, "旧生成摘要", "no unauthorized data migration or clearing");
  } finally { await f.close(); }
});
test("unorganized sources never report classification errors, including missing memory and empty templates", async () => {
  const f = purposeFixture(); try {
    const missing = f.create(); rmSync(join(memoryDirectory(f.root, missing.sessionId), "MEMORY.md"));
    const empty = f.create(""), active = f.create("# [In progress] 尚未完成\n"), pending = f.create();
    for (const scope of [missing, empty, active, pending]) f.memories.scan(scope);
    const catalog = f.memories.catalog(f.workspace.id), missingEntry = catalog.find(entry => entry.sessionId === missing.sessionId)!;
    assert.equal(missingEntry.reason, "missing"); assert.equal(missingEntry.error, "记忆读取失败");
    assert.equal(catalog.find(entry => entry.sessionId === pending.sessionId)?.status, "pending");
    assert.ok(catalog.every(entry => entry.organizationError === undefined));
    assert.equal(f.tree.tree(f.workspace.id).pending, 1); assert.equal(f.tree.tree(f.workspace.id).failed, 0);
  } finally { await f.close(); }
});
test("classification errors remain separate from missing sources and clear after a successful retry", async () => {
  const f = purposeFixture(); try {
    const scope = f.create(); f.memories.scan(scope);
    f.memories.runner = { close: async () => {}, execute: async () => { throw Error("classification fixture failed"); } };
    const batch = f.tree.batch(f.workspace.id, Date.now() + memoryBatchWaitMs);
    await assert.rejects(f.memories.pipeline.organize(batch, selection, new AbortController().signal), /classification fixture failed/);
    let entry = f.memories.catalog(f.workspace.id).find(entry => entry.sessionId === scope.sessionId)!;
    assert.equal(entry.organizationError, "classification fixture failed"); assert.equal(entry.error, entry.organizationError);
    rmSync(join(memoryDirectory(f.root, scope.sessionId), "MEMORY.md")); f.memories.scan(scope);
    entry = f.memories.catalog(f.workspace.id).find(entry => entry.sessionId === scope.sessionId)!;
    assert.equal(entry.reason, "missing"); assert.equal(entry.error, "记忆读取失败");
    assert.equal(entry.organizationError, "classification fixture failed", "source failure must not replace an actual classification error");
    f.write(scope, "# [Completed] 验证目的\n## [Completed] 验证结果\n"); f.memories.scan(scope);
    f.memories.runner = { close: async () => {}, execute: async input => classification(input) };
    await f.memories.pipeline.organize(f.tree.batch(f.workspace.id, Date.now() + memoryBatchWaitMs), selection, new AbortController().signal);
    entry = f.memories.catalog(f.workspace.id).find(entry => entry.sessionId === scope.sessionId)!;
    assert.equal(entry.status, "ready"); assert.equal(entry.error, undefined); assert.equal(entry.organizationError, undefined);
    assert.equal(f.tree.tree(f.workspace.id).failed, 0);
  } finally { await f.close(); }
});
test("oversized classification refuses before any model request without dropping IDs or prior index", async () => {
  const f = purposeFixture(); try {
    await f.configure({ readChars: 16000 }); const scope = f.create(); f.memories.scan(scope); f.publish(); const old = f.tree.snapshot(f.workspace.id);
    f.write(scope, "# [Completed] 验证目的\n" + Array.from({ length: 49 }, (_, i) => `# [Completed] 新目的${i}${"长".repeat(59)}`).join("\n")); f.memories.scan(scope); let calls = 0;
    f.memories.runner = { close: async () => {}, execute: async () => { calls++; throw Error("must not call"); } };
    await assert.rejects(f.memories.pipeline.organize(f.tree.batch(f.workspace.id, Date.now() + memoryBatchWaitMs), selection, new AbortController().signal), { code: "MEMORY_LIMIT" });
    assert.equal(calls, 0); assert.equal(f.tree.entries(f.workspace.id).length, 50); assert.deepEqual(f.tree.snapshot(f.workspace.id), old); assert.equal(f.tree.tree(f.workspace.id).failed, 49);
  } finally { await f.close(); }
});
test("query reads complete selected details and direct explicit text links without classification read budget", async () => {
  const f = purposeFixture(); try {
    await f.configure({ queryModel: selection, readChars: 16000 }); const scope = f.create(); f.detail(scope, "查询结果 [详细依据](../references/result.md)");
    const directory = memoryDirectory(f.root, scope.sessionId); mkdirSync(join(directory, "references"), { recursive: true }); writeFileSync(join(directory, "references/result.md"), "验证通过。".repeat(4000)); f.memories.scan(scope); f.publish();
    let calls = 0; f.memories.runner = { close: async () => {}, execute: async input => {
      calls++; const data = JSON.parse(input.prompt); assert.equal(input.readChars, undefined);
      if (data.evidence) assert.equal(data.evidence.find((e: any) => e.content.startsWith("验证通过")).content.length, 20000);
      return navigation(input, "修复已验证通过。");
    } };
    const result = await f.memories.query(scope, "资料浏览进展"); assert.equal(result.answer, "修复已验证通过。"); assert.equal(calls, 2); assert.equal(result.readDocuments?.length, 2);
  } finally { await f.close(); }
});
