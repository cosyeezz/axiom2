import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/server/storage.js";
import { Memories } from "../src/server/memories.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import { topicId } from "../src/server/memory-tree.js";
import { parseMemoryRecords, type MemoryRecord } from "../src/shared/memory-tree.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";
const selection = { provider: "fixture", id: "fixture", thinking: "off" as const };
const record = (topic = "数据库事务", item = "事务发布", content = "同一来源原子替换"): MemoryRecord => ({ topic, section: "发布与并发校验", item, content });
const completed = "## 目标与范围\n验证记忆流程\n\n## 任务进度\n整体状态：已完成\n整体进度：100%\n- [已完成] 验证记忆流程\n";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-memory-tree-")), project = join(root, "project"); mkdirSync(project);
  const store = new Store(root);
  const workspace = store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: project, authorized: true } }) as Workspace;
  const memories = new Memories(store, () => {}); clearInterval((memories as any).timer); (memories as any).watcher?.close();
  const create = () => { const session = store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: workspace.id }) as Session; return { workspaceId: workspace.id, sessionId: session.id }; };
  const scope = create(), tree = memories.pipeline.tree;
  const save = (scope: Scope, records: MemoryRecord[], path = "MEMORY.md", revision = "v1") => tree.publish(workspace.id, { sessionId: scope.sessionId, path, revision, records: [], dependencies: [] }, [], records, tree.signature(workspace.id));
  const write = (content: string, path = "MEMORY.md", source = scope) => { const directory = memoryDirectory(root, source.sessionId); mkdirSync(join(directory, "references"), { recursive: true }); writeFileSync(join(directory, path), content); memories.scan(source); };
  return { root, store, memories, tree, scope, create, save, write, workspace,
    async close() { await memories.close(); store.close(); rmSync(root, { recursive: true, force: true }); } };
}
test("four-field validation rejects missing, extra, empty and vague records", () => {
  assert.deepEqual(parseMemoryRecords(JSON.stringify([record()])), [record()]);
  for (const value of [{}, [{ ...record(), source: "forged" }], [{ ...record(), content: " " }], [{ ...record(), topic: "其他" }]]) assert.throws(() => parseMemoryRecords(JSON.stringify(value)));
});
test("file replacement preserves sibling files and different sources, identical records merge provenance", async () => {
  const f = fixture(); try {
    const b = f.create(); f.save(f.scope, [record()]); f.save(f.scope, [record("数据库事务", "隔离级别")], "references/details.md"); f.save(b, [record()]);
    let tree = f.tree.tree(f.workspace.id); assert.equal(tree.topics[0].sections[0].items.find((item) => item.name === "事务发布")!.contents[0].sources.length, 2);
    f.save(f.scope, [record("数据库事务", "事务发布", "更新后的限定")], "MEMORY.md", "v2");
    tree = f.tree.tree(f.workspace.id); const items = tree.topics[0].sections[0].items;
    assert.equal(items.length, 2); assert.equal(items.find((item) => item.name === "事务发布")!.contents.length, 2);
    assert.equal(f.tree.files(f.workspace.id).length, 3);
    assert.equal(tree.nameChars, Array.from("数据库事务").length);
  } finally { await f.close(); }
});
test("old topic routes survive current-file rename and repeated partial reclassification", async () => {
  const f = fixture(); try {
    f.save(f.scope, [record("事务机制", "事项一"), record("事务机制", "事项二")]);
    f.save(f.scope, [record("事务发布", "事项一"), record("事务发布", "事项二")], "MEMORY.md", "v2");
    assert.equal(f.tree.sections(f.workspace.id, topicId("事务机制"))[0].items.length, 2);
    const file = f.tree.files(f.workspace.id)[0], extra = f.create();
    f.tree.publish(f.workspace.id, { sessionId: extra.sessionId, path: "MEMORY.md", revision: "x", records: [], dependencies: [] }, [{ file, index: 0, record: file.records[0] }], [record("并发控制", "事项一")], f.tree.signature(f.workspace.id));
    assert.deepEqual(new Set(f.tree.sections(f.workspace.id, topicId("事务机制")).map((section) => section.topic)), new Set(["事务发布", "并发控制"]));
  } finally { await f.close(); }
});
test("stale publication and altered existing contents cannot mutate contributions", async () => {
  const f = fixture(); try {
    f.save(f.scope, [record()]); const before = f.tree.signature(f.workspace.id), file = f.tree.files(f.workspace.id)[0];
    assert.throws(() => f.tree.publish(f.workspace.id, file, [], [], "stale"), /记忆树已变化/);
    assert.throws(() => f.tree.publish(f.workspace.id, file, [{ file, index: 0, record: file.records[0] }], [record("事务机制", "事务发布", "伪造修改")], before), /内容或顺序被修改/);
    assert.equal(f.tree.signature(f.workspace.id), before);
  } finally { await f.close(); }
});
test("organizer sends exactly one complete request per changed file, no tools, and skips successful revisions", async () => {
  const f = fixture(); try {
    f.write(completed); f.write("补充依据", "references/details.md"); const calls: any[] = [];
    f.memories.runner = { close: async () => {}, execute: async (input) => { calls.push(input); const data = JSON.parse(input.prompt); assert.throws(() => input.read(f.scope.sessionId, "MEMORY.md")); return { answer: JSON.stringify([record("事务机制", data.currentFile.path)]), incomplete: false }; } };
    await f.memories.pipeline.organize(f.scope, selection, new AbortController().signal, () => {});
    assert.equal(calls.length, 2); assert.ok(calls.every((input) => input.systemPrompt.includes("四个具体非空字符串")));
    await f.memories.pipeline.organize(f.scope, selection, new AbortController().signal, () => {}); assert.equal(calls.length, 2);
    f.write("补充依据已更新", "references/details.md");
    await f.memories.pipeline.organize(f.scope, selection, new AbortController().signal, () => {}); assert.equal(calls.length, 3);
    assert.equal(f.tree.files(f.workspace.id).length, 2);
  } finally { await f.close(); }
});
test("query misses cost one request, hits cost two independent requests with complete sources", async () => {
  const f = fixture(); try {
    f.write(completed); const document = f.memories.read(f.scope);
    f.save(f.scope, [record()], "MEMORY.md", document.revision);
    const calls: any[] = []; let hit = false;
    f.memories.runner = { close: async () => {}, execute: async (input) => { calls.push(input); const data = JSON.parse(input.prompt); return { answer: data.sections ? JSON.stringify(hit ? [data.sections[0].id] : []) : "同一来源原子替换", incomplete: false }; } };
    const query = () => f.memories.pipeline.query(f.scope, topicId("数据库事务"), "写入竞争如何处理？", selection, new AbortController().signal, Date.now() + 30000);
    assert.equal((await query()).answer, ""); assert.equal(calls.length, 1);
    hit = true; const result = await query(); assert.equal(calls.length, 3); assert.equal(result.sources.length, 1); assert.equal(result.readDocuments?.length, 1);
    assert.match(calls[1].systemPrompt, /不以关键词重合为必要条件/); assert.match(calls[2].systemPrompt, /不裁定哪一方正确/);
    assert.equal(JSON.parse(calls[2].prompt).documents[0].content, completed);
  } finally { await f.close(); }
});
test("query rejects forged section ids and changed evidence after answer generation", async () => {
  const f = fixture(); try {
    f.write(completed); f.save(f.scope, [record()], "MEMORY.md", f.memories.read(f.scope).revision);
    f.memories.runner = { close: async () => {}, execute: async () => ({ answer: '["outside"]', incomplete: false }) };
    const query = () => f.memories.pipeline.query(f.scope, topicId("数据库事务"), "事务", selection, new AbortController().signal, Date.now() + 30000);
    await assert.rejects(query(), /匹配范围无效/);
    f.memories.runner = { close: async () => {}, execute: async (input) => { const data = JSON.parse(input.prompt); if (data.sections) return { answer: JSON.stringify([data.sections[0].id]), incomplete: false }; f.write("来源变化"); return { answer: "旧内容", incomplete: false }; } };
    await assert.rejects(query(), /读取依据已变化/);
  } finally { await f.close(); }
});
test("pure deletions notify subscribers and cancellation cannot prune contributions", async () => {
  const f = fixture(); try {
    f.write(completed); f.write("待删除资料", "references/deleted.md");
    f.memories.runner = { close: async () => {}, execute: async (input) => ({ answer: JSON.stringify([record("事务机制", JSON.parse(input.prompt).currentFile.path)]), incomplete: false }) };
    await f.memories.pipeline.organize(f.scope, selection, new AbortController().signal, () => {});
    rmSync(join(memoryDirectory(f.root, f.scope.sessionId), "references/deleted.md"));
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(f.memories.pipeline.organize(f.scope, selection, cancelled.signal, () => {}));
    assert.equal(f.tree.files(f.workspace.id).length, 2);
    let published = 0, calls = 0; f.memories.publishTree = () => { published++; };
    f.memories.runner = { close: async () => {}, execute: async () => { calls++; throw Error("should not request"); } };
    await f.memories.pipeline.organize(f.scope, selection, new AbortController().signal, () => {});
    assert.equal(f.tree.files(f.workspace.id).length, 1); assert.equal(calls, 0); assert.equal(published, 1);
  } finally { await f.close(); }
});
for (const during of [false, true]) test(`reclassification verifies prior dependencies ${during ? "during" : "before"} its request`, async () => {
  const f = fixture(); try {
    const artifacts = join(memoryDirectory(f.root, f.scope.sessionId), "artifacts"); mkdirSync(artifacts);
    const external = join(artifacts, "basis.md"); writeFileSync(external, "依据v1");
    f.write(completed + `\n[依据](${external})`);
    f.memories.runner = { close: async () => {}, execute: async () => ({ answer: JSON.stringify([record("事务机制")]), incomplete: false }) };
    await f.memories.pipeline.organize(f.scope, selection, new AbortController().signal, () => {});
    const other = f.create(); f.write(completed, "MEMORY.md", other);
    await f.memories.command({ op: "memory.configure", requestId: randomUUID(), ...f.scope, params: { topicNameReviewThresholdChars: 1 } });
    if (!during) writeFileSync(external, "依据v2");
    let existing = -1;
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      const data = JSON.parse(input.prompt); existing = data.existingRecords.length;
      if (during) writeFileSync(external, "请求中修改");
      return { answer: JSON.stringify([...data.existingRecords.map((record: MemoryRecord) => ({ ...record, topic: "并发事务" })), record("事务校验")]), incomplete: false };
    } };
    const run = () => f.memories.pipeline.organize(other, selection, new AbortController().signal, () => {});
    if (during) { await assert.rejects(run(), /读取依据已变化/); assert.equal(existing, 1); }
    else { await run(); assert.equal(existing, 0); }
    assert.equal(f.tree.files(f.workspace.id).find((file) => file.sessionId === f.scope.sessionId)!.records[0].topic, "事务机制");
  } finally { await f.close(); }
});
test("empty and malformed matching responses are failures, only [] means no match", async () => {
  const f = fixture(); try {
    f.write(completed); f.save(f.scope, [record()], "MEMORY.md", f.memories.read(f.scope).revision);
    for (const answer of ["", " ", "{}", '["outside"]']) {
      f.memories.runner = { close: async () => {}, execute: async () => ({ answer, incomplete: false }) };
      await assert.rejects(f.memories.pipeline.query(f.scope, topicId("数据库事务"), "事务", selection, new AbortController().signal, Date.now() + 30000));
    }
  } finally { await f.close(); }
});
test("automatic organization requires complete tasks, strictly more than thirty minutes, and no resumed activity", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const f = fixture(); try {
    await f.memories.command({ op: "memory.configure", requestId: randomUUID(), ...f.scope, params: { organizerModel: selection, intervalMs: 1000 } });
    f.write(completed.replace("已完成", "进行中")); let calls = 0;
    f.memories.runner = { close: async () => {}, execute: async () => { calls++; return { answer: JSON.stringify([record()]), incomplete: false }; } };
    t.mock.timers.tick(31 * 60000); await f.memories.organize(); assert.equal(calls, 0);
    f.write(completed); t.mock.timers.tick(30 * 60000); await f.memories.organize(); assert.equal(calls, 0);
    f.memories.touch(f.scope); t.mock.timers.tick(1001); await f.memories.organize(); assert.equal(calls, 0);
    t.mock.timers.tick(30 * 60000); await f.memories.organize(); assert.equal(calls, 1);
    t.mock.timers.tick(31 * 60000); await f.memories.organize(); assert.equal(calls, 1);
    f.write(completed + "新要求"); t.mock.timers.tick(31 * 60000);
    f.memories.runner = { close: async () => {}, execute: async () => { f.memories.touch(f.scope); return { answer: JSON.stringify([record("事务重试")]), incomplete: false }; } };
    await f.memories.organize(); assert.equal(f.tree.tree(f.workspace.id).topics[0].name, "数据库事务");
  } finally { await f.close(); }
});
