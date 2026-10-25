import assert from "node:assert/strict";
import { test } from "node:test";
import { Memories } from "../src/server/memories.js";
import { AppError } from "../src/shared/protocol.js";
import { memoryBatchWaitMs } from "../src/shared/memory-tree.js";
import { purposeFixture, selection, classification } from "./memory-purpose-fixture.js";
const headings = (count: number, prefix = "完成目的") => Array.from({ length: count }, (_, i) => `# [Completed] ${prefix}${i}`).join("\n");
const until = async (condition: () => boolean) => { const end = Date.now() + 5000; while (!condition()) { assert.ok(Date.now() < end, "timed out"); await new Promise(r => setTimeout(r, 5)); } };
const age = (f: ReturnType<typeof purposeFixture>) => f.store.db.prepare("UPDATE memory_purposes SET queuedAt=queuedAt-?").run(memoryBatchWaitMs);

test("49 fresh purposes wait; 50 trigger one batch and completion never drains a fresh remainder", async () => {
  const f = purposeFixture(); try {
    await f.configure({ organizerModel: selection }); let calls = 0;
    f.memories.runner = { close: async () => {}, execute: async input => { calls++; return classification(input); } };
    const scope = f.create(headings(49)); f.memories.scan(scope); await f.memories.organize(); assert.equal(calls, 0);
    f.write(scope, headings(51)); f.memories.scan(scope); await f.memories.organize(); assert.equal(calls, 1);
    assert.equal(f.tree.tree(f.workspace.id).purposes.length, 50); assert.equal(f.tree.tree(f.workspace.id).pending, 1);
    await f.memories.organize(); assert.equal(calls, 1); age(f); await f.memories.organize(); assert.equal(calls, 2);
    assert.equal(f.tree.tree(f.workspace.id).purposes.length, 51); await f.memories.organize(); assert.equal(calls, 2);
  } finally { await f.close(); }
});
test("count/timer triggers share one slot and preserve new purposes arriving in flight", async () => {
  const f = purposeFixture(); let release!: () => void, entered = false;
  const gate = new Promise<void>(r => { release = r; });
  try {
    await f.configure({ organizerModel: selection }); const scope = f.create(headings(50)); f.memories.scan(scope); let calls = 0;
    f.memories.runner = { close: async () => release(), execute: async input => { calls++; entered = true; await gate; return classification(input); } };
    const pending = f.memories.organize(); await until(() => entered);
    await Promise.all([f.memories.organize(), f.memories.organize()]); assert.equal(calls, 1);
    f.write(scope, headings(51)); f.memories.scan(scope); release(); await pending;
    assert.equal(f.tree.tree(f.workspace.id).pending, 1); await f.memories.organize(); assert.equal(calls, 1);
  } finally { release(); await f.close(); }
});
test("cold restart preserves oldest enqueue time and terminal purposes never enqueue twice", async () => {
  const f = purposeFixture(); let restarted: Memories | undefined;
  try {
    const scope = f.create(); f.memories.scan(scope); const first = f.tree.entries(f.workspace.id)[0]; age(f); await f.configure({ organizerModel: selection }); await f.memories.close();
    restarted = new Memories(f.store, () => {}); clearInterval((restarted as any).timer); (restarted as any).watcher?.close(); (restarted as any).scheduleOrganization = () => {};
    let calls = 0; restarted.runner = { close: async () => {}, execute: async input => { calls++; return classification(input); } };
    await restarted.scanAsync(scope); assert.equal(restarted.pipeline.tree.entries(f.workspace.id)[0].id, first.id);
    await restarted.organize(); assert.equal(calls, 1); await restarted.scanAsync(scope); await restarted.organize(); assert.equal(calls, 1);
  } finally { await restarted?.close(); await f.close(); }
});
test("batch failure retains prior tree and pending IDs with persisted retry backoff", async () => {
  const f = purposeFixture(); try {
    await f.configure({ organizerModel: selection }); const scope = f.create(); f.memories.scan(scope); f.publish(); const old = f.tree.snapshot(f.workspace.id);
    f.write(scope, "# [Completed] 验证目的\n# [Completed] 新目的\n"); f.memories.scan(scope); age(f); let calls = 0;
    f.memories.runner = { close: async () => {}, execute: async () => { calls++; throw new AppError("MEMORY_RETRYABLE", "temporary"); } };
    await f.memories.organize(); assert.deepEqual(f.tree.snapshot(f.workspace.id), old); assert.equal(f.tree.tree(f.workspace.id).failed, 1);
    await f.memories.organize(); assert.equal(calls, 1);
    f.store.db.prepare("UPDATE memory_purposes SET retryAfter=0").run(); f.memories.runner.execute = async input => { calls++; return classification(input); };
    await f.memories.organize(); assert.equal(calls, 2); assert.equal(f.tree.tree(f.workspace.id).purposes.length, 2);
  } finally { await f.close(); }
});
test("one stale pending locator is isolated without poisoning valid purposes", async () => {
  const f = purposeFixture(); try {
    await f.configure({ organizerModel: selection }); const stale = f.create(), good = f.create("# [Completed] 有效目的\n"); f.memories.scan();
    f.write(stale, "# [In progress] 验证目的\n"); age(f); let calls = 0;
    f.memories.runner = { close: async () => {}, execute: async input => { calls++; return classification(input); } }; await f.memories.organize();
    assert.equal(calls, 1); assert.deepEqual(f.tree.tree(f.workspace.id).purposes.map(p => p.source.sessionId), [good.sessionId]); assert.equal(f.tree.entries(f.workspace.id).find(p => p.source.sessionId === stale.sessionId)!.blocked, true);
  } finally { await f.close(); }
});
for (const action of ["reopen", "revoke", "close"] as const) test(`publication rejects ${action} during classification`, async () => {
  const f = purposeFixture(); let release!: () => void, entered = false; const gate = new Promise<void>(r => { release = r; });
  try {
    await f.configure({ organizerModel: selection }); const scope = f.create(); f.memories.scan(scope); age(f);
    f.memories.runner = { close: async () => release(), execute: async input => { entered = true; await gate; return classification(input); } };
    const pending = f.memories.organize(); await until(() => entered);
    if (action === "reopen") f.write(scope, "# [In progress] 验证目的\n");
    if (action === "revoke") f.store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id=?").run(f.workspace.id);
    if (action === "close") await f.memories.close(); release(); await pending;
    assert.equal(f.tree.snapshot(f.workspace.id).purposes.length, 0);
  } finally { release(); await f.close(); }
});
