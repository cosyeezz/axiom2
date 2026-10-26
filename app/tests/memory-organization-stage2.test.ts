import assert from "node:assert/strict";
import { test } from "node:test";
import { purposeFixture, classification, selection } from "./memory-purpose-fixture.js";
import { memoryBatchWaitMs, type MemoryIndexNode } from "../src/shared/memory-tree.js";
import { projectMemoryTree } from "../src/shared/memory-query-projection.js";
import { organizationModelBudget } from "../src/server/memory-organization-capacity.js";
import { AppError } from "../src/shared/protocol.js";
import { Memories } from "../src/server/memories.js";
const ready = (f: ReturnType<typeof purposeFixture>) => f.tree.batch(f.workspace.id, Date.now() + memoryBatchWaitMs);
const small = (titles: string[]) => [{ name: "记忆机制", children: titles.map(title => ({ title })) }];
function chain(titles: string[], depth: number, width: number) {
  let children: unknown[] = titles.map(title => ({ title }));
  for (let i = 0; i < depth; i++) children = [{ name: "语".repeat(width), children }];
  return [{ name: "记忆机制", children }];
}
const size = (roots: MemoryIndexNode[]) => Array.from(projectMemoryTree(roots).catalog).length;

test("exact same titles are sent once and bind all independent purposes and documents", async () => {
  const f = purposeFixture(); try {
    for (let i = 0; i < 2; i++) { const scope = f.create(); f.detail(scope, `独立正文${i}`); f.memories.scan(scope); }
    let calls = 0;
    f.memories.runner = { close: async () => {}, execute: async input => {
      calls++; const data = JSON.parse(input.prompt); assert.deepEqual(Object.keys(data), ["existingTree", "titles"]);
      assert.deepEqual(data.titles, ["验证目的"]); return classification(input);
    } };
    await f.memories.pipeline.organize(ready(f), selection, new AbortController().signal);
    const leaf = f.tree.nodeSnapshot(f.workspace.id).roots[0].children[0];
    assert.equal(calls, 1); assert.equal(leaf.purposeIds?.length, 2); assert.equal(leaf.documentRefs?.length, 2);
    assert.equal(new Set(leaf.documentRefs?.map(ref => ref.sessionId)).size, 2);
    assert.equal(projectMemoryTree(f.tree.nodeSnapshot(f.workspace.id).roots).catalog, "目录：\n记忆事务");
  } finally { await f.close(); }
});

test("original title symbols are preserved outside semantic path validation", async () => {
  const f = purposeFixture(); try {
    const scope = f.create("# [Completed] API 路径校验 〔1〕 😀\n"); f.memories.scan(scope); f.publish();
    const snapshot = f.tree.nodeSnapshot(f.workspace.id), leaf = snapshot.roots[0].children[0];
    assert.equal(leaf.name, "API 路径校验 〔1〕 😀"); assert.equal(leaf.kind, "title");
    assert.deepEqual(JSON.parse(leaf.titlePath!), ["记忆事务", leaf.name]);
    assert.equal(projectMemoryTree(snapshot.roots).catalog, "目录：\n记忆事务");
  } finally { await f.close(); }
});

for (const failAt of [0, 2, 3]) test(`three-stage organization publishes once, failure stage ${failAt} keeps old tree`, async () => {
  const f = purposeFixture(); try {
    const scope = f.create(); f.memories.scan(scope); const initial = ready(f);
    const oldRoots = f.tree.classify(JSON.stringify(chain(initial.map(p => p.text), 44, 450)), initial);
    assert.ok(size(oldRoots) >= 20000 && size(oldRoots) <= 24000);
    f.tree.publish(f.workspace.id, initial, oldRoots, 0);
    const old = f.tree.snapshot(f.workspace.id);
    f.create("# [Completed] 新增目的\n"); f.memories.scan(); const batch = ready(f);
    let calls = 0, deadline: number | undefined;
    f.memories.runner = { close: async () => {}, execute: async input => {
      calls++; assert.deepEqual(f.tree.snapshot(f.workspace.id), old, "no stage is visible before commit");
      deadline ??= input.deadlineAt; assert.equal(input.deadlineAt, deadline);
      const data = JSON.parse(input.prompt);
      assert.equal(data.titles.length, calls === 1 ? 1 : 2);
      if (calls === failAt) throw Error("stage failed");
      // The admission candidate exceeds 24k. Exactly one compression is allowed.
      return { answer: JSON.stringify(calls === 2 ? chain(data.titles, 50, 500) : small(data.titles)), incomplete: false };
    } };
    const pending = f.memories.pipeline.organize(batch, selection, new AbortController().signal);
    if (failAt) { await assert.rejects(pending, /stage failed/); assert.deepEqual(f.tree.snapshot(f.workspace.id), old); }
    else { await pending; assert.equal(f.tree.snapshot(f.workspace.id).version, old.version + 1); assert.equal(f.tree.snapshot(f.workspace.id).purposes.length, 2); }
    assert.equal(calls, failAt || 3);
  } finally { await f.close(); }
});

test("a failed target compression is not retried and never publishes an oversized candidate", async () => {
  const f = purposeFixture(); try {
    const scope = f.create(); f.memories.scan(scope); const before = f.tree.snapshot(f.workspace.id); let calls = 0;
    f.memories.runner = { close: async () => {}, execute: async input => {
      calls++; return { answer: JSON.stringify(chain(JSON.parse(input.prompt).titles, 50, 500)), incomplete: false };
    } };
    await assert.rejects(f.memories.pipeline.organize(ready(f), selection, new AbortController().signal), { code: "MEMORY_LIMIT" });
    assert.equal(calls, 2); assert.deepEqual(f.tree.snapshot(f.workspace.id), before); assert.equal(ready(f).length, 0);
  } finally { await f.close(); }
});

for (const error of [new AppError("MEMORY_RETRYABLE", "explicit 429"), Error("format or unknown failure")]) test(`persistent retry ceiling for ${error.message}`, async () => {
  const f = purposeFixture(); try {
    const scope = f.create(); f.memories.scan(scope); let calls = 0;
    f.memories.runner = { close: async () => {}, execute: async () => { calls++; throw error; } };
    await assert.rejects(f.memories.pipeline.organize(ready(f), selection, new AbortController().signal));
    const row = f.tree.entries(f.workspace.id)[0];
    if (error instanceof AppError) {
      assert.ok(row.retryAfter >= Date.now() + 59000); assert.equal(f.tree.batch(f.workspace.id).length, 0);
      f.store.db.prepare("UPDATE memory_purposes SET retryAfter=0").run();
      await assert.rejects(f.memories.pipeline.organize(ready(f), selection, new AbortController().signal));
    }
    f.memories.scan(scope); assert.equal(ready(f).length, 0);
    const attempt = f.store.db.prepare("SELECT * FROM memory_organization_attempts").get()!;
    assert.equal(attempt.state, "paused"); assert.equal(attempt.attempts, error instanceof AppError ? 2 : 1);
    assert.equal(calls, error instanceof AppError ? 2 : 1);
  } finally { await f.close(); }
});

test("restart turns a running claim into unknown and never resends it after settings change", async () => {
  const f = purposeFixture(); let restarted: Memories | undefined;
  try {
    const scope = f.create(); f.memories.scan(scope); const batch = ready(f);
    f.tree.claim(f.workspace.id, batch, batch, 0, "interrupted"); await f.memories.close();
    restarted = new Memories(f.store, () => {}); clearInterval((restarted as any).timer); (restarted as any).watcher?.close(); (restarted as any).scheduleOrganization = () => {};
    await f.configure({ readChars: 240001 });
    assert.equal(restarted.pipeline.tree.batch(f.workspace.id, Date.now() + memoryBatchWaitMs).length, 0);
    assert.equal(f.store.db.prepare("SELECT state FROM memory_organization_attempts").get()!.state, "unknown");
    assert.equal(f.tree.snapshot(f.workspace.id).version, 0);
  } finally { await restarted?.close(); await f.close(); }
});

test("same-title binding changes during a request reject publication even when model text is unchanged", async () => {
  const f = purposeFixture(); try {
    const scope = f.create(); f.memories.scan(scope);
    f.memories.runner = { close: async () => {}, execute: async input => {
      f.detail(scope, "新增原文"); f.memories.scan(scope); return classification(input);
    } };
    await assert.rejects(f.memories.pipeline.organize(ready(f), selection, new AbortController().signal), { code: "REVISION_CONFLICT" });
    assert.equal(f.tree.snapshot(f.workspace.id).version, 0);
  } finally { await f.close(); }
});

test("capacity preflight reserves complete input and complete title output without truncation", () => {
  const input = { prompt: "中文", systemPrompt: "规则", outputReserve: 1024 };
  const required = Buffer.byteLength(input.prompt + input.systemPrompt) + 4096 + 1024;
  assert.deepEqual(organizationModelBudget(input, { contextWindow: required, maxTokens: 2000 }), { maxTokens: 1024 });
  assert.throws(() => organizationModelBudget(input, { contextWindow: required - 1, maxTokens: 2000 }), { code: "MEMORY_LIMIT" });
  assert.throws(() => organizationModelBudget(input, { contextWindow: required, maxTokens: 1023 }), { code: "MEMORY_LIMIT" });
});
