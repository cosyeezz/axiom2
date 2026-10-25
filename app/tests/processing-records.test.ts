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
test("coalesced payload-free observations link original calls and exclude private reasoning", async () => {
  const f = fixture(); let notifications = 0;
  const stop = f.records.observe(workspaceId => { assert.equal(workspaceId, f.scope.workspaceId); notifications++; });
  const stopThrowing = f.records.observe(() => { throw Error("broken observer"); });
  try {
    const id = f.records.start(f.scope, "session.title", "标题", undefined, undefined, false, { runId: "original-run", groupId: "original-run", toolCallId: "original-call" });
    f.records.stage(id, "等待执行资源", selection);
    const call = f.records.callStart(id, "生成标题", "only-public-input", selection);
    f.records.callFinish(id, call, { role: "assistant", content: [{ type: "thinking", thinking: "PRIVATE_REASONING_SENTINEL", thinkingSignature: "PRIVATE_SIGNATURE" }, { type: "text", text: "公开标题", textSignature: "PRIVATE_TEXT_SIGNATURE" }], providerMetadata: { private: "PRIVATE_METADATA" }, usage: { output: 4 }, stopReason: "stop" });
    f.records.annotate(id, { outcome: "not_applied" }); f.records.finish(id, "completed");
    assert.equal(notifications, 0); await new Promise(resolve => setImmediate(resolve)); assert.equal(notifications, 1);
    assert.deepEqual(Object.keys(f.records.invalidation(f.scope.workspaceId)), ["revision"]);
    assert.equal(f.list({ toolCallId: "original-call" }).items[0]!.id, id);
    assert.equal(f.list({ toolCallId: "other-call" }).items.length, 0);
    const record = f.get(id); assert.equal(record.runId, "original-run"); assert.equal(record.outcome, "not_applied");
    assert.match(record.calls[0]!.output!.text, /公开标题/); assert.doesNotMatch(JSON.stringify(record), /PRIVATE_/);
    assert.equal(Number(f.store.db.prepare("SELECT count(*) AS n FROM processing_records").get()!.n), 1);
    f.store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id=?").run(f.scope.workspaceId);
    assert.throws(() => f.records.invalidation(f.scope.workspaceId), { code: "AUTHORIZATION_REQUIRED" });
  } finally { stop(); stopThrowing(); f.close(); }
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
    assert.equal(imported.startedAt, 1000); assert.equal(imported.endedAt, 2000); assert.equal(imported.stage, "摘要已应用");
    // Reconcile records imported by earlier versions without retaining invented times.
    f.store.db.prepare("UPDATE processing_records SET body=? WHERE id=?").run(JSON.stringify({ ...imported, stages: [{ name: "完成", at: Date.now() }] }), legacy.id);
    f.records.syncCompression(f.scope, legacy);
    assert.deepEqual(f.get(legacy.id).stages, []);
  } finally { f.close(); }
});
test("nested and legacy private blocks are projected out while public model configuration survives", () => {
  const f = fixture(); try {
    const model = { ...selection, thinking: "high" as const };
    const blocks = ["thinking", "reasoning", "redacted_thinking"].map(type => ({ type, thinking: "PRIVATE_NESTED", data: "PRIVATE_DATA" }));
    const input = { selection: model, wrapper: blocks[0], array: [...blocks, { type: "text", text: "PUBLIC_TEXT" }],
      nested: JSON.stringify({ wrapper: blocks[1], providerMetadata: { secret: "PRIVATE_METADATA" }, visible: "PUBLIC_JSON" }),
      messages: [{ role: "assistant", content: [...blocks, { type: "text", text: "PUBLIC_MESSAGE", textSignature: "PRIVATE_SIGNATURE" },
        { type: "toolCall", id: "public-call", name: "read", arguments: { path: "PUBLIC_PATH" } }] }] };
    const id = f.records.start(f.scope, "memory.query", "公开记录"), call = f.records.callStart(id, "公开阶段", input, model);
    f.records.callFinish(id, call, input); f.records.finish(id, "completed", undefined, input);
    const record = f.get(id);
    assert.doesNotMatch(JSON.stringify(record), /PRIVATE_/);
    assert.match(record.calls[0]!.input!.text, /PUBLIC_TEXT/); assert.match(record.calls[0]!.output!.text, /PUBLIC_MESSAGE/);
    assert.match(record.result!.text, /PUBLIC_JSON/); assert.match(record.result!.text, /PUBLIC_PATH/);
    assert.equal(record.calls[0]!.selection!.thinking, "high");
    assert.equal(JSON.parse(record.calls[0]!.input!.text).selection.thinking, "high");
    for (const block of blocks) {
      const rootId = f.records.start(f.scope, "memory.query", "根块"), rootCall = f.records.callStart(rootId, "根块", block);
      f.records.callFinish(rootId, rootCall, JSON.stringify(block));
      assert.equal(f.get(rootId).calls[0]!.input!.text, ""); assert.equal(f.get(rootId).calls[0]!.output!.text, "");
    }
    // Bypass the new write path: old body and summary must be safe at read time too.
    const legacy = { ...record, providerMetadata: { hidden: "PRIVATE_LEGACY" }, reasoning_details: "PRIVATE_DETAILS",
      calls: [{ ...record.calls[0]!, input: { text: JSON.stringify(input), truncated: false }, output: { text: JSON.stringify(input), truncated: false } }],
      result: { text: JSON.stringify({ wrapper: blocks[2], visible: "PUBLIC_LEGACY" }), truncated: false } };
    f.store.db.prepare("UPDATE processing_records SET summary=?,body=? WHERE id=?").run(JSON.stringify(legacy), JSON.stringify(legacy), id);
    assert.doesNotMatch(JSON.stringify(f.get(id)), /PRIVATE_/); assert.doesNotMatch(JSON.stringify(f.list()), /PRIVATE_/);
    assert.match(f.get(id).result!.text, /PUBLIC_LEGACY/);
    assert.match(String(f.store.db.prepare("SELECT body FROM processing_records WHERE id=?").get(id)!.body), /PRIVATE_LEGACY/, "read projection does not migrate stored history");
  } finally { f.close(); }
});
test("truncated legacy model JSON is hidden without rewriting history or exposing a search oracle", () => {
  const f = fixture(); try {
    const message = { role: "assistant", content: [{ type: "thinking", thinking: "PRIVATE_TRUNCATED_REASONING", signature: "PRIVATE_TRUNCATED_SIGNATURE" }, { type: "text", text: "PUBLIC_OUTPUT" + "x".repeat(2_000_000) }], providerMetadata: { hidden: "PRIVATE_TRUNCATED_METADATA" } };
    const unicodeDocuments = [String.raw`{"provider\u004detadata":{"secret":"PRIVATE_TRUNCATED_UNICODE_METADATA"}}`,
      String.raw`{"\u0074ype":"thinking","thinking":"PRIVATE_TRUNCATED_UNICODE_BLOCK"}`,
      String.raw`{"role":"assistant","\u0074hinking":"PRIVATE_TRUNCATED_UNICODE_ASSISTANT"}`];
    const documents = [JSON.stringify(message).slice(0, 2_000_000), JSON.stringify([message]).slice(0, 2_000_000),
      JSON.stringify({ nested: JSON.stringify(message).slice(0, 500), visible: "PUBLIC_WRAPPER" }),
      JSON.stringify(JSON.stringify(message)).slice(0, 2_000_000), JSON.stringify(JSON.stringify(message)),
      ...["Model response: ", "```json\n", "[diagnostic] "].flatMap(prefix =>
        [JSON.stringify(message), JSON.stringify(JSON.stringify(message))].map(body => (prefix + body).slice(0, 2_000_000))),
      '日志：' + JSON.stringify({ wrapper: { reasoning_details: "PRIVATE_TRUNCATED_DETAILS" } }),
      '日志：' + JSON.stringify(JSON.stringify({ providerMetadata: { value: "PRIVATE_TRUNCATED_METADATA" } })),
      '旧助手：' + JSON.stringify({ role: "assistant", thinking: "PRIVATE_TRUNCATED_THINKING" }),
      ...unicodeDocuments.flatMap(document => ["日志：" + document, "日志：" + JSON.stringify(document), "```json\n" + JSON.stringify(JSON.stringify(document))]),
      String.raw`日志：{\u0022type\u0022:\u0022th\u0069nking\u0022,\u0022thinking\u0022:\u0022PRIVATE_TRUNCATED_UNICODE_SYNTAX\u0022}`,
      String.raw`日志：{"\u005cu0074ype":"thinking","thinking":"PRIVATE_TRUNCATED_NESTED_UNICODE"}`,
      // More nested Unicode decoding than the bounded detector accepts is hidden.
      "日志：" + unicodeDocuments[1]!.replace(/\\/g, "\\u005c" + "u005c".repeat(8))];
    for (const document of documents) {
      const id = f.records.start(f.scope, "memory.query", "历史结构化诊断"); f.records.finish(id, "completed");
      const record = f.get(id), legacy = { ...record, error: document,
        calls: [{ id: "legacy-call", stage: "模型", state: "completed", startedAt: 1, endedAt: 2, selection,
          input: { text: document, truncated: true }, output: { text: document, truncated: true } }], result: { text: document, truncated: true } };
      const { calls, stages, result, ...summary } = legacy, body = JSON.stringify(legacy), header = JSON.stringify(summary);
      f.store.db.prepare("UPDATE processing_records SET summary=?,body=? WHERE id=?").run(header, body, id);
      const publicRecord = f.get(id);
      assert.doesNotMatch(JSON.stringify(publicRecord), /PRIVATE_TRUNCATED_/);
      assert.equal(publicRecord.calls[0]!.input!.truncated, true); assert.equal(publicRecord.calls[0]!.selection!.thinking, "off");
      if (document.startsWith("{\"nested\"")) assert.match(publicRecord.result!.text, /PUBLIC_WRAPPER/);
      if (document.length === 2_000_000) assert.match(publicRecord.calls[0]!.output!.text, /已隐藏/);
      assert.deepEqual({ ...f.store.db.prepare("SELECT summary,body FROM processing_records WHERE id=?").get(id) }, { summary: header, body }, "viewing must not rewrite legacy bytes");
    }
    assert.doesNotMatch(JSON.stringify(f.list()), /PRIVATE_TRUNCATED_/);
    assert.equal(f.list({ query: "PRIVATE_TRUNCATED_REASONING" }).items.length, 0);
    const plain = f.records.start(f.scope, "memory.query", "普通文本"), call = f.records.callStart(plain, "模型", "普通诊断 {不是JSON}");
    f.records.callFinish(plain, call, "[link](file.md)");
    assert.equal(f.get(plain).calls[0]!.input!.text, "普通诊断 {不是JSON}"); assert.equal(f.get(plain).calls[0]!.output!.text, "[link](file.md)");
    const config = "模型配置：" + JSON.stringify(selection), configCall = f.records.callStart(plain, "普通 reasoning 文本", config);
    assert.equal(f.get(plain).calls[1]!.input!.text, config, "public thinking configuration is not a private block");
    f.records.callFinish(plain, configCall, "普通 reasoning 是业务名，不是私有字段");
    assert.equal(f.get(plain).calls[1]!.output!.text, "普通 reasoning 是业务名，不是私有字段");
    const encodedConfig = String.raw`模型配置：{"provider":"fixture","thinking":"h\u0069gh"}`;
    const encodedCall = f.records.callStart(plain, "公开 Unicode 配置", encodedConfig);
    assert.equal(f.get(plain).calls[2]!.input!.text, encodedConfig);
    const slashes = "普通日志：" + "\\".repeat(100_000) + " unsupported escapes";
    f.records.callFinish(plain, encodedCall, slashes); assert.equal(f.get(plain).calls[2]!.output!.text, slashes);
  } finally { f.close(); }
});
test("search uses only public projections and paginates past hidden non-matches", () => {
  const f = fixture(); try {
    const expected: string[] = [];
    for (let i = 0; i < 120; i++) {
      const id = f.records.start(f.scope, "memory.query", i % 2 ? `公开匹配 ${i}` : `其他 ${i}`);
      if (i % 2) expected.unshift(id);
      const row = f.store.db.prepare("SELECT summary FROM processing_records WHERE id=?").get(id)!;
      f.store.db.prepare("UPDATE processing_records SET summary=? WHERE id=?").run(JSON.stringify({ ...JSON.parse(String(row.summary)), providerMetadata: { hidden: "PRIVATE_SEARCH_SENTINEL" }, apiKey: "PRIVATE_CREDENTIAL" }), id);
    }
    assert.equal(f.list({ query: "PRIVATE_SEARCH_SENTINEL" }).items.length, 0);
    assert.equal(f.list({ query: "PRIVATE_CREDENTIAL" }).items.length, 0);
    const first = f.list({ query: "公开匹配" }); assert.equal(first.items.length, 50); assert.ok(first.next);
    const second = f.list({ query: "公开匹配", before: first.next }); assert.equal(second.items.length, 10); assert.equal(second.next, null);
    assert.deepEqual([...first.items, ...second.items].map(item => item.id), expected);
    assert.doesNotMatch(JSON.stringify([...first.items, ...second.items]), /PRIVATE_/);
  } finally { f.close(); }
});
test("soft-removed sources retain workspace memory history but revocation and hard removal deny reads", () => {
  const f = fixture(); try {
    const id = f.records.start(f.scope, "memory.query", "保留历史"); f.records.finish(id, "completed");
    f.store.db.prepare("UPDATE sessions SET deletedAt=? WHERE id=?").run(Date.now(), f.scope.sessionId);
    assert.equal(f.get(id).id, id); assert.equal(f.list().items.length, 1);
    f.store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id=?").run(f.scope.workspaceId);
    assert.throws(() => f.get(id), { code: "AUTHORIZATION_REQUIRED" }); assert.throws(() => f.list(), { code: "AUTHORIZATION_REQUIRED" });
    f.store.db.prepare("UPDATE workspaces SET authorized=1 WHERE id=?").run(f.scope.workspaceId);
    // Direct deletion is a boundary fixture, not a newly introduced product operation.
    f.store.db.prepare("DELETE FROM sessions WHERE id=?").run(f.scope.sessionId);
    assert.throws(() => f.get(id), { code: "NOT_FOUND" }); assert.equal(f.list().items.length, 0);
  } finally { f.close(); }
});
test("generated compression without an application receipt stays unconfirmed until native reconciliation", () => {
  const f = fixture(); try {
    const id = f.records.start(f.scope, "compression", "压缩"), job = { id, state: "completed", phase: "applying", stage: "等待安全点校验并应用", startedAt: Date.now(), endedAt: Date.now(), error: null, summary: "公开摘要", selection };
    f.records.syncCompression(f.scope, job);
    assert.equal(f.get(id).state, "interrupted"); assert.equal(f.get(id).outcome, undefined); assert.equal(f.get(id).stage, "应用状态待核实");
    assert.match(f.get(id).error!, /没有确认应用结果/);
    job.phase = "done"; job.stage = "摘要已应用"; f.records.syncCompression(f.scope, job);
    assert.equal(f.get(id).state, "completed"); assert.equal(f.get(id).outcome, "applied"); assert.equal(f.get(id).error, null);
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
    const record = f.get(f.list({ kind: "memory.organize" }).items[0]!.id); assert.equal(record.state, "invalidated"); assert.equal(record.calls.length, 0); assert.equal(calls, 0);
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
    const failed = f.get(f.list({ kind: "memory.organize" }).items[0]!.id); assert.equal(failed.state, "failed"); assert.equal(failed.stage, "校验分类结果"); assert.equal(failed.calls[0]!.state, "completed"); assert.match(failed.calls[0]!.output!.text, /我会完整读取/);
    tree.publish(f.scope.workspaceId, batch, tree.classify(classification({ prompt: JSON.stringify({ titles: batch.map(p => p.text) }) }).answer, batch), tree.snapshot(f.scope.workspaceId).version);
    memories.runner = { close: async () => {}, execute: async input => navigation(input, "当前事实") };
    await memories.pipeline.query(f.scope, "当前事实", selection, new AbortController().signal, Date.now() + 10000);
    const query = f.get(f.list({ kind: "memory.query" }).items[0]!.id); assert.equal(query.state, "completed"); assert.deepEqual(query.calls.map((c) => c.stage), ["全树一次匹配", "归纳原文答案"]); assert.ok(query.calls.every((c) => c.state === "completed"));
    assert.equal(query.result?.truncated, false);
  } finally { await memories.close(); f.close(); }
});
