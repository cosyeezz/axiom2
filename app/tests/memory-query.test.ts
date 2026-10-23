import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "./temporary.js";
import { test } from "node:test";
import { Store } from "../src/server/storage.js";
import { Memories } from "../src/server/memories.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import { topicId } from "../src/server/memory-tree.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";
const selection = { provider: "fixture", id: "fixture", thinking: "off" as const };
const topic = "查询来源验证";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-memory-query-")), project = join(root, "project"); mkdirSync(project);
  const store = new Store(root), workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const memories = new Memories(store, () => {}); clearInterval((memories as any).timer); (memories as any).watcher?.close();
  const create = (content = "当前来源事实") => {
    const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    writeFileSync(join(memoryDirectory(root, session.id), "MEMORY.md"), content); memories.scan(scope);
    const tree = memories.pipeline.tree;
    tree.publish(workspace.id, { sessionId: session.id, path: "MEMORY.md", revision: memories.read(scope).revision, records: [], dependencies: [] }, [],
      [{ topic, section: session.id, item: "来源核验", content }], tree.signature(workspace.id));
    return scope;
  };
  const scope = create();
  store.db.prepare("INSERT INTO memory_preferences VALUES(1,?)").run(JSON.stringify({ queryModel: selection }));
  const query = (question = "当前事实", signal?: AbortSignal, target = memories) => target.query(scope, question, signal, undefined, topicId(topic));
  const reply = (input: { prompt: string }, selected = scope) => {
    const data = JSON.parse(input.prompt);
    return { answer: data.sections ? JSON.stringify(data.sections.filter((s: any) => s.name === selected.sessionId).map((s: any) => s.id)) : data.documents.find((d: any) => d.sessionId === selected.sessionId)?.content ?? "", incomplete: false };
  };
  return { root, store, memories, scope, create, query, reply, async close() { await memories.close(); store.close(); rmSync(root, { recursive: true, force: true }); } };
}
test("cold restart retains all topics and reads only matched sources beyond 24 entries", async () => {
  const f = fixture(); let restarted: Memories | undefined;
  try {
    const selected = f.create("模型迁移完成验证"); for (let i = 0; i < 24; i++) f.create(`无关来源${i}`);
    await f.memories.close(); restarted = new Memories(f.store, () => {}); clearInterval((restarted as any).timer); (restarted as any).watcher?.close();
    let calls = 0;
    restarted.runner = { close: async () => {}, execute: async (input) => {
      calls++; const data = JSON.parse(input.prompt);
      if (data.sections) { assert.equal(data.sections.length, 26); assert.ok(!input.prompt.includes("模型迁移完成验证")); }
      else { assert.equal(data.documents.length, 1); assert.equal(data.documents[0].sessionId, selected.sessionId); }
      return f.reply(input, selected);
    } };
    const result = await f.query("迁移进展", undefined, restarted); assert.equal(result.answer, "模型迁移完成验证"); assert.equal(calls, 2); assert.equal(result.sources.length, 1);
  } finally { await restarted?.close(); await f.close(); }
});
test("query does not scan sources or advance generations, and organizer status changes are harmless", async () => {
  const f = fixture(); try {
    await f.memories.scanAsync(f.scope); const internal = f.memories as any, generation = internal.generation(f.scope);
    internal.scanAsync = async () => { throw Error("query must not scan"); };
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      if (JSON.parse(input.prompt).documents) {
        const entry = f.memories.catalog(f.scope.workspaceId)[0]; f.store.db.prepare("UPDATE memory_sources SET body=? WHERE sessionId=?").run(JSON.stringify({ ...entry, status: "error" }), f.scope.sessionId);
      }
      return f.reply(input);
    } };
    const results = await Promise.all([f.query(), f.query()]); assert.ok(results.every((r) => r.answer === "当前来源事实" && !r.incomplete)); assert.equal(internal.generation(f.scope), generation);
  } finally { await f.close(); }
});
for (const change of ["source", "correction", "authorization"] as const) test(`query suppresses stale output after ${change} changes`, async () => {
  const f = fixture(); try {
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      const result = f.reply(input);
      if (JSON.parse(input.prompt).documents) {
        if (change === "source") writeFileSync(join(memoryDirectory(f.root, f.scope.sessionId), "MEMORY.md"), "新事实");
        else if (change === "correction") await f.memories.correct(f.scope.workspaceId, "当前来源事实");
        else f.store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id=?").run(f.scope.workspaceId);
      }
      return result;
    } };
    const result = await f.query(); assert.equal(result.answer, ""); assert.equal(result.incomplete, true);
  } finally { await f.close(); }
});
for (const action of ["cancel", "timeout", "close"] as const) test(`query promptly settles ${action} even when a runner ignores cancellation`, async () => {
  const f = fixture(); let release!: () => void, enter!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; }), entered = new Promise<void>((resolve) => { enter = resolve; });
  const alive = setInterval(() => {}, 1000);
  try {
    if (action === "timeout") f.store.db.prepare("UPDATE memory_preferences SET body=? WHERE id=1").run(JSON.stringify({ queryModel: selection, timeoutMs: 50 }));
    let signal: AbortSignal | undefined;
    f.memories.runner = { close: async () => {}, execute: async (input) => { signal = input.signal; enter(); await hold; return f.reply(input); } };
    const controller = new AbortController(), pending = f.query("当前事实", controller.signal); await entered;
    if (action === "cancel") controller.abort(); else if (action === "close") await f.memories.close();
    if (action === "cancel") await assert.rejects(pending, { name: "AbortError" });
    else { const result = await pending; assert.equal(result.answer, ""); assert.equal(result.incomplete, true); if (action === "timeout") assert.equal(result.reason, "timeout"); }
    assert.equal(signal?.aborted, true); release();
  } finally { clearInterval(alive); release?.(); await f.close(); }
});
test("failed matches remain distinct from a valid empty match", async () => {
  const f = fixture(); try {
    for (const answer of ["", "not JSON", "{}", '["forged"]', "[]"]) {
      f.memories.runner = { close: async () => {}, execute: async () => ({ answer, incomplete: false }) };
      const result = await f.query(); assert.equal(result.answer, ""); assert.equal(result.incomplete, answer !== "[]");
    }
  } finally { await f.close(); }
});
