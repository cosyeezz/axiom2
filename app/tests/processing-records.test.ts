import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "./temporary.js";
import { join } from "node:path";
import { test } from "node:test";
import { Store } from "../src/server/storage.js";
import { ProcessingRecords } from "../src/server/processing-records.js";
import { Memories } from "../src/server/memories.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import { classification, navigation } from "./memory-purpose-fixture.js";
import { memoryDetails } from "../src/shared/memory-detail-paths.js";
import { memoryBatchWaitMs } from "../src/shared/memory-tree.js";
import type { ProcessingList, ProcessingRecord } from "../src/shared/processing.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";
const selection = { provider: "fixture", id: "fixture", thinking: "off" as const };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-processing-")), project = join(root, "project"); mkdirSync(project);
  const store = new Store(root);
  const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id }, records = ProcessingRecords.for(store);
  const list = (params = {}, target = scope) => records.command({ requestId: randomUUID(), op: "processing.list", workspaceId: target.workspaceId, params }) as ProcessingList;
  const get = (id: string, target = scope) => records.command({ requestId: randomUUID(), op: "processing.get", workspaceId: target.workspaceId, params: { id } }) as ProcessingRecord;
  return { root, store, scope, records, list, get, close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}
test("record pagination and filters isolate workspaces, authorization and removed sources", () => {
  const f = fixture(); try {
    const ids = Array.from({ length: 55 }, (_, i) => f.records.start(f.scope, "memory.query", `查询 ${i}`));
    f.records.finish(ids[54]!, "failed", "具体失败原因");
    const first = f.list(); assert.equal(first.items.length, 50); assert.equal(first.items[0]!.id, ids[54]);
    const second = f.list({ before: first.next }); assert.equal(second.items.length, 5); assert.equal(second.next, null);
    assert.equal(new Set([...first.items, ...second.items].map((r) => r.id)).size, 55);
    assert.equal(f.list({ state: "failed", query: "具体失败原因" }).items.length, 1);
    const otherPath = join(f.root, "other"); mkdirSync(otherPath);
    const other = f.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: otherPath, authorized: true } }) as Workspace;
    const otherScope = { ...f.scope, workspaceId: other.id }; assert.equal(f.list({}, otherScope).items.length, 0); assert.throws(() => f.get(ids[0]!, otherScope));
    f.store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id=?").run(f.scope.workspaceId); assert.throws(() => f.list()); assert.throws(() => f.get(ids[0]!));
    f.store.db.prepare("UPDATE workspaces SET authorized=1 WHERE id=?").run(f.scope.workspaceId);
    f.store.db.prepare("UPDATE sessions SET workspaceId=? WHERE id=?").run(other.id, f.scope.sessionId); assert.equal(f.list().items.length, 0); assert.throws(() => f.get(ids[0]!));
  } finally { f.close(); }
});
test("raw model success survives processing failure and late responses without rewriting terminal state", () => {
  const f = fixture(); try {
    const id = f.records.start(f.scope, "memory.organize", "整理");
    const call = f.records.callStart(id, "整理 MEMORY.md", { apiKey: "secret", prompt: "Bearer secret-value" }, selection);
    f.records.callSent(id, call); f.records.callFinish(id, call, { content: "我会完整读取会话记忆", usage: { output: 1 } });
    f.records.stage(id, "解析输出：MEMORY.md"); f.records.finish(id, "failed", "整理输出格式错误：模型应直接返回JSON数组");
    f.records.callFinish(id, call, "late", undefined, { output: 1 }); f.records.finish(id, "completed");
    const record = f.get(id); assert.equal(record.state, "failed"); assert.equal(record.calls[0]!.state, "completed"); assert.ok(record.calls[0]!.sentAt);
    assert.match(record.calls[0]!.output!.text, /我会完整读取/); assert.doesNotMatch(record.calls[0]!.input!.text, /secret/);
    const queued = f.records.start(f.scope, "memory.query", "排队取消"), pending = f.records.callStart(queued, "匹配", "input");
    f.records.finish(queued, "cancelled", "用户取消"); f.records.callFinish(queued, pending, "late");
    assert.equal(f.get(queued).calls[0]!.state, "cancelled"); assert.equal(f.get(queued).calls[0]!.output!.text, "late");
  } finally { f.close(); }
});
test("nested JSON credentials and extra source fields never leak into records", () => {
  const f = fixture(); try {
    const scope = { ...f.scope, excerpt: "password=scope-secret" };
    const id = f.records.start(scope, "memory.organize", '记录 {"apiKey":"title-secret"}');
    const call = f.records.callStart(id, "模型", { prompt: JSON.stringify({ apiKey: "nested-secret", password: "nested-password" }), access_token: "access-secret" });
    f.records.callFinish(id, call, { output: '{"refresh_token":"output-secret"}' });
    f.records.finish(id, "failed", '{"apiKey":"error-secret","password":"error-password"}');
    assert.doesNotMatch(JSON.stringify(f.get(id)), /nested-secret|nested-password|access-secret|output-secret|error-secret|error-password|title-secret|scope-secret/);
    assert.equal(Object.hasOwn(f.list().items[0]!, "excerpt"), false);
  } finally { f.close(); }
});
test("restarting interrupts active records and pending calls", () => {
  const f = fixture(); let reopened: Store | undefined;
  try {
    const id = f.records.start(f.scope, "memory.query", "重启"); f.records.callStart(id, "匹配", "input"); f.records.cancelling(id); f.store.close();
    reopened = new Store(f.root); const record = ProcessingRecords.for(reopened).command({ requestId: randomUUID(), op: "processing.get", workspaceId: f.scope.workspaceId, params: { id } }) as ProcessingRecord;
    assert.equal(record.state, "interrupted"); assert.equal(record.calls[0]!.state, "interrupted"); assert.match(record.error!, /重启/);
  } finally { reopened?.close(); rmSync(f.root, { recursive: true, force: true }); }
});
test("compression cancellation stays pending until acknowledged, application can reconcile a late commit", () => {
  const f = fixture(); try {
    const id = f.records.start(f.scope, "compression", "压缩");
    const job = { id, state: "running", phase: "applying", startedAt: Date.now(), endedAt: null as number | null, error: null as string | null, summary: "摘要", selection };
    f.records.syncCompression(f.scope, job); const call = f.records.callStart(id, "生成摘要", "input"); f.records.callFinish(id, call, "摘要");
    f.records.cancelling(id); job.error = "等待安全点确认取消"; f.records.syncCompression(f.scope, job);
    assert.equal(f.get(id).state, "cancelling"); assert.match(f.get(id).error!, /确认取消/);
    job.state = "cancelled"; job.endedAt = Date.now(); f.records.syncCompression(f.scope, job); assert.equal(f.get(id).state, "cancelled");
    job.state = "completed"; job.phase = "done"; job.error = null; f.records.syncCompression(f.scope, job);
    assert.equal(f.get(id).state, "completed"); assert.equal(f.get(id).calls[0]!.state, "completed");
    assert.ok(f.get(id).stages.length > 1, "new records retain observed stages");
    const legacy = { ...job, id: randomUUID(), startedAt: 1000, endedAt: 2000 }; f.records.syncCompression(f.scope, legacy);
    const imported = f.get(legacy.id);
    assert.equal(imported.legacy, true); assert.equal(imported.calls.length, 0); assert.deepEqual(imported.stages, []);
    assert.equal(imported.startedAt, 1000); assert.equal(imported.endedAt, 2000); assert.equal(imported.stage, "完成");
    // Reconcile records imported by earlier versions without retaining invented times.
    f.store.db.prepare("UPDATE processing_records SET body=? WHERE id=?").run(JSON.stringify({ ...imported, stages: [{ name: "完成", at: Date.now() }] }), legacy.id);
    f.records.syncCompression(f.scope, legacy);
    assert.deepEqual(f.get(legacy.id).stages, []);
  } finally { f.close(); }
});
test("pre-request source failures and query errors remain linked to their records", async () => {
  const f = fixture(), memories = new Memories(f.store, () => {}); clearInterval((memories as any).timer); (memories as any).watcher?.close();
  try {
    const file = join(memoryDirectory(f.root, f.scope.sessionId), "MEMORY.md"); writeFileSync(file, "# [Completed] 验证事实\n"); memories.scan(f.scope);
    const batch = memories.pipeline.tree.batch(f.scope.workspaceId, Date.now() + memoryBatchWaitMs);
    let calls = 0; memories.runner = { close: async () => {}, execute: async () => { calls++; throw Error("must not call"); } };
    await memories.command({ requestId: randomUUID(), op: "memory.configure", ...f.scope, params: { organizerModel: selection } });
    rmSync(file);
    await memories.pipeline.organize(batch, selection, new AbortController().signal);
    const record = f.get(f.list({ kind: "memory.organize" }).items[0]!.id); assert.equal(record.state, "failed"); assert.equal(record.calls.length, 0); assert.equal(calls, 0);
    assert.equal(memories.pipeline.tree.entries(f.scope.workspaceId)[0].blocked, true);
    assert.equal(record.sessionId, f.scope.sessionId);
    const query = await memories.query(f.scope, "缺失Topic"); assert.ok(query.processingId); assert.equal(f.get(query.processingId).state, "failed");
  } finally { await memories.close(); f.close(); }
});
test("natural-language organization output records a successful call and a failed parse; query links both stages", async () => {
  const f = fixture(), memories = new Memories(f.store, () => {}); clearInterval((memories as any).timer); (memories as any).watcher?.close();
  try {
    const entry = join(memoryDirectory(f.root, f.scope.sessionId), "MEMORY.md"); writeFileSync(entry, "# [Completed] 验证事实\n");
    const path = join(memoryDirectory(f.root, f.scope.sessionId), memoryDetails(memories.read(f.scope).content)[0].path);
    mkdirSync(join(memoryDirectory(f.root, f.scope.sessionId), "details"), { recursive: true }); writeFileSync(path, "当前事实"); memories.scan(f.scope);
    const tree = memories.pipeline.tree, batch = tree.batch(f.scope.workspaceId, Date.now() + memoryBatchWaitMs);
    memories.runner = { close: async () => {}, execute: async () => ({ answer: "我会完整读取会话记忆", incomplete: false }) };
    await assert.rejects(memories.pipeline.organize(batch, selection, new AbortController().signal));
    const failed = f.get(f.list({ kind: "memory.organize" }).items[0]!.id); assert.equal(failed.state, "failed"); assert.match(failed.stage, /批量语义分类/); assert.equal(failed.calls[0]!.state, "completed"); assert.match(failed.calls[0]!.output!.text, /我会完整读取/);
    tree.publish(f.scope.workspaceId, batch, tree.classify(classification({ prompt: JSON.stringify({ purposes: batch }) }).answer, batch), tree.snapshot(f.scope.workspaceId).version);
    memories.runner = { close: async () => {}, execute: async input => navigation(input, "当前事实") };
    await memories.pipeline.query(f.scope, "当前事实", selection, new AbortController().signal, Date.now() + 10000);
    const query = f.get(f.list({ kind: "memory.query" }).items[0]!.id); assert.equal(query.state, "completed"); assert.deepEqual(query.calls.map((c) => c.stage), ["directories", "directories", "details", "归纳原文答案"]); assert.ok(query.calls.every((c) => c.state === "completed"));
    assert.equal(query.result?.truncated, false);
  } finally { await memories.close(); f.close(); }
});
