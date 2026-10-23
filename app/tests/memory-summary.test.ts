import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { tmpdir } from "./temporary.js";
import { Store } from "../src/server/storage.js";
import { Memories } from "../src/server/memories.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import { topicId } from "../src/server/memory-tree.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const minute = 60_000;
const selection = { provider: "fixture", id: "fixture", thinking: "off" as const };
const completed = "## 目标与范围\n改进记忆浏览\n\n## 任务进度\n整体状态：已完成\n整体进度：100%\n- [已完成] 改进浏览\n";
const record = { topic: "会话记忆浏览", section: "资料查找", item: "浏览验证", content: "关联资料验证通过" };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-memory-summary-")), project = join(root, "project"); mkdirSync(project);
  const store = new Store(root);
  const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id }, memories = new Memories(store, () => {}), directory = memoryDirectory(root, session.id);
  clearInterval((memories as any).timer); (memories as any).watcher?.close();
  const configure = (params: Record<string, unknown>) => memories.command({ requestId: randomUUID(), op: "memory.configure", ...scope, params });
  const model = (target = memories) => {
    let calls = 0;
    target.runner = { close: async () => {}, execute: async (input) => {
      calls++; assert.equal(input.kind, "organize"); assert.ok(JSON.parse(input.prompt).currentFile.content);
      return { answer: JSON.stringify([record]), incomplete: false };
    } }; return () => calls;
  };
  const entry = () => memories.catalog(scope.workspaceId).find((item) => item.sessionId === scope.sessionId)!;
  const write = async (suffix = "") => { writeFileSync(join(directory, "MEMORY.md"), completed + suffix); await memories.scanAsync(); };
  return { root, store, scope, memories, directory, configure, model, entry, write,
    async close() { await memories.close(); store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("legacy summaries migrate to tree contributions without resetting source stability", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() }); const f = fixture();
  try {
    await f.configure({ organizerModel: selection }); await f.write(); const original = f.entry();
    f.store.db.prepare("UPDATE memory_sources SET body=? WHERE sessionId=?").run(JSON.stringify({ ...original, status: "ready", summary: "旧摘要", summaryVersion: 1 }), f.scope.sessionId);
    const calls = f.model(); t.mock.timers.tick(31 * minute); await f.memories.organize();
    assert.equal(calls(), 1); assert.equal(f.entry().status, "ready"); assert.equal(f.entry().updatedAt, original.updatedAt);
    const raw = JSON.parse(String(f.store.db.prepare("SELECT body FROM memory_sources WHERE sessionId=?").get(f.scope.sessionId)!.body));
    assert.equal(raw.treeVersion, 1); assert.equal(raw.summary, ""); assert.equal("treeVersion" in f.entry(), false);
    assert.equal(f.memories.tree(f.scope.workspaceId).topics[0].name, record.topic);
    await f.memories.scanAsync(); t.mock.timers.tick(31 * minute); await f.memories.organize(); assert.equal(calls(), 1);
  } finally { await f.close(); }
});
test("entry and detail changes each restart quiet time while ordinary scans do not", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() }); const f = fixture();
  try {
    await f.configure({ organizerModel: selection, intervalMs: 1000 }); await f.write(); const start = f.entry().updatedAt, calls = f.model();
    t.mock.timers.tick(30 * minute); await f.memories.scanAsync(); assert.equal(f.entry().updatedAt, start);
    await f.memories.organize(); assert.equal(calls(), 0, "strictly more than thirty minutes");
    t.mock.timers.tick(1001); await f.memories.organize(); assert.equal(calls(), 1);
    await f.write("新增要求"); const changed = f.entry().updatedAt;
    t.mock.timers.tick(29 * minute); mkdirSync(join(f.directory, "references")); writeFileSync(join(f.directory, "references/detail.md"), "新增验证结果");
    await f.memories.scanAsync(); assert.ok(f.entry().updatedAt > changed);
    t.mock.timers.tick(minute); await f.memories.organize(); assert.equal(calls(), 1);
    t.mock.timers.tick(29 * minute + 1001); await f.memories.organize(); assert.equal(calls(), 3, "entry and detail each get one request");
  } finally { await f.close(); }
});
test("quiet time and activity survive restart and offline changes restart stability", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() }); const f = fixture();
  try {
    await f.configure({ organizerModel: selection, intervalMs: 1000 }); await f.write(); const start = f.entry().updatedAt;
    t.mock.timers.tick(20 * minute); f.memories.touch(f.scope); await f.memories.close(); t.mock.timers.tick(11 * minute);
    const restarted = new Memories(f.store, () => {}); clearInterval((restarted as any).timer); (restarted as any).watcher?.close();
    try {
      await restarted.scanAsync(); assert.equal(restarted.catalog(f.scope.workspaceId)[0].updatedAt, start);
      const calls = f.model(restarted); await restarted.organize(); assert.equal(calls(), 0);
      t.mock.timers.tick(20 * minute); await restarted.organize(); assert.equal(calls(), 1);
    } finally { await restarted.close(); }
    writeFileSync(join(f.directory, "MEMORY.md"), completed + "停服变化");
    const changed = new Memories(f.store, () => {}); clearInterval((changed as any).timer); (changed as any).watcher?.close();
    try { await changed.scanAsync(); assert.equal(changed.catalog(f.scope.workspaceId)[0].updatedAt, Date.now()); } finally { await changed.close(); }
  } finally { await f.close(); }
});
test("scanning eligible sources never starts organization outside its periodic cycle", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() }); const f = fixture();
  try {
    await f.configure({ organizerModel: selection }); await f.write(); const calls = f.model(); t.mock.timers.tick(31 * minute);
    await f.memories.scanAsync(); await new Promise((resolve) => setImmediate(resolve)); assert.equal(calls(), 0);
    await f.memories.organize(); assert.equal(calls(), 1);
  } finally { await f.close(); }
});
test("four-field content has no legacy 200-character summary restriction", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() }); const f = fixture();
  try {
    await f.configure({ organizerModel: selection }); await f.write(); t.mock.timers.tick(31 * minute);
    f.memories.runner = { close: async () => {}, execute: async () => ({ answer: JSON.stringify([{ ...record, content: "😀".repeat(300) }]), incomplete: false }) };
    await f.memories.organize(); assert.equal(f.entry().status, "ready");
    assert.equal(f.memories.tree(f.scope.workspaceId).topics[0].sections[0].items[0].contents[0].text, "😀".repeat(300));
  } finally { await f.close(); }
});
test("query requires a single explicit Topic and passes full linked sources without the organization budget", async () => {
  const f = fixture(); try {
    await f.configure({ queryModel: selection, readChars: 16000 }); await f.write("[详情](references/result.md)");
    mkdirSync(join(f.directory, "references")); writeFileSync(join(f.directory, "references/result.md"), "验证通过。".repeat(4000));
    const tree = f.memories.pipeline.tree;
    tree.publish(f.scope.workspaceId, { sessionId: f.scope.sessionId, path: "MEMORY.md", revision: f.memories.read(f.scope).revision, records: [], dependencies: [] }, [], [record], tree.signature(f.scope.workspaceId));
    const missingTopic = await f.memories.query(f.scope, "进展"); assert.equal(missingTopic.incomplete, true); assert.equal(missingTopic.answer, "");
    let calls = 0;
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      calls++; const data = JSON.parse(input.prompt);
      if (data.sections) return { answer: JSON.stringify([data.sections[0].id]), incomplete: false };
      assert.equal(data.documents.length, 2); assert.equal(data.documents.find((d: any) => d.path === "references/result.md").content.length, 20000);
      assert.equal(input.readChars, undefined); return { answer: "修复已验证通过。", incomplete: false };
    } };
    const result = await f.memories.query(f.scope, "资料浏览的进展", undefined, undefined, topicId(record.topic));
    assert.equal(calls, 2); assert.equal(result.answer, "修复已验证通过。"); assert.equal(result.readDocuments?.length, 2);
  } finally { await f.close(); }
});
