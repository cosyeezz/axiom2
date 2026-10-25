import assert from "node:assert/strict";
import { test } from "node:test";
import { purposeFixture, classification, selection } from "./memory-purpose-fixture.js";
import { memoryBatchWaitMs } from "../src/shared/memory-tree.js";
import { AppError } from "../src/shared/protocol.js";
import { MemoryTreeStore } from "../src/server/memory-tree.js";
import { projectMemoryTree } from "../src/shared/memory-query-projection.js";
const ready = (f: ReturnType<typeof purposeFixture>) => f.tree.batch(f.workspace.id, Date.now() + memoryBatchWaitMs);

test("query-only settings and scheduling changes cannot unlock paused organizer requests", async () => {
  const f = purposeFixture(); try {
    await f.configure({ organizerModel: selection }); const scope = f.create(); f.memories.scan(scope); let calls = 0;
    f.memories.runner = { close: async () => {}, execute: async () => { calls++; throw Error("nonretryable"); } };
    await assert.rejects(f.memories.pipeline.organize(ready(f), selection, new AbortController().signal));
    await f.configure({ queryModel: { ...selection, id: "unrelated" }, concurrency: 2, queue: 2, maxTurns: 1 });
    assert.equal(ready(f).length, 0); assert.equal(calls, 1);
    await f.configure({ readChars: 240001 }); assert.equal(ready(f).length, 1, "actual organizer capacity changes permit a fresh attempt");
  } finally { await f.close(); }
});

test("absolute deadline is checked after blocking final source reads", async () => {
  const f = purposeFixture(), now = Date.now; let offset = 0, advance = false;
  try {
    const scope = f.create(); f.memories.scan(scope); const batch = ready(f), read = f.memories.read.bind(f.memories);
    Date.now = () => now() + offset;
    f.memories.read = (...args) => { if (advance) { offset += 301000; advance = false; } return read(...args); };
    f.memories.runner = { close: async () => {}, execute: async input => { advance = true; return classification(input); } };
    await assert.rejects(f.memories.pipeline.organize(batch, selection, new AbortController().signal), { code: "MEMORY_BUDGET" });
    assert.equal(f.tree.snapshot(f.workspace.id).version, 0);
  } finally { Date.now = now; await f.close(); }
});

test("publication crossing deadline rolls back index, node entries, queue and receipt callback", async () => {
  const f = purposeFixture(), now = Date.now; let offset = 0;
  try {
    const scope = f.create(); f.memories.scan(scope); const batch = ready(f), roots = f.tree.classify(classification({ prompt: JSON.stringify({ titles: batch.map(p => p.text) }) }).answer, batch);
    const deadline = now() + 1000; Date.now = () => now() + offset;
    assert.throws(() => f.tree.publish(f.workspace.id, batch, roots, 0, () => { offset = 2000; }, undefined, deadline), { code: "MEMORY_BUDGET" });
    assert.equal(f.tree.snapshot(f.workspace.id).version, 0); assert.equal(f.tree.entries(f.workspace.id)[0].processedAt, null);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM memory_directory_titles").get()!.n, 0);
  } finally { Date.now = now; await f.close(); }
});

test("claim boundary enforces persisted 60 second backoff even for an explicitly reused batch", async () => {
  const f = purposeFixture(); try {
    const scope = f.create(); f.memories.scan(scope); const batch = ready(f); let calls = 0;
    f.memories.runner = { close: async () => {}, execute: async () => { calls++; throw new AppError("MEMORY_RETRYABLE", "429"); } };
    await assert.rejects(f.memories.pipeline.organize(batch, selection, new AbortController().signal));
    await assert.rejects(f.memories.pipeline.organize(batch, selection, new AbortController().signal), { code: "REVISION_CONFLICT" });
    assert.equal(calls, 1); assert.equal(f.store.db.prepare("SELECT attempts FROM memory_organization_attempts").get()!.attempts, 1);
  } finally { await f.close(); }
});

test("failure state and retry timestamp roll back together on a database fault", async () => {
  const f = purposeFixture(), prepare = f.store.db.prepare.bind(f.store.db);
  try {
    const scope = f.create(); f.memories.scan(scope); const batch = ready(f);
    const claim = f.tree.claim(f.workspace.id, batch, batch, 0, "fault-injection");
    f.store.db.prepare = ((sql: string) => { if (sql.startsWith("UPDATE memory_purposes SET error=")) throw Error("injected persistence fault"); return prepare(sql); }) as typeof f.store.db.prepare;
    assert.throws(() => f.tree.failure(batch, new AppError("MEMORY_RETRYABLE", "429"), claim), /injected persistence fault/);
    f.store.db.prepare = prepare;
    assert.equal(prepare("SELECT state FROM memory_organization_attempts").get()!.state, "running");
    assert.equal(f.tree.entries(f.workspace.id)[0].retryAfter, 0); assert.equal(ready(f).length, 0);
    f.tree.organization.recover(); assert.equal(prepare("SELECT state FROM memory_organization_attempts").get()!.state, "unknown");
  } finally { f.store.db.prepare = prepare; await f.close(); }
});

test("old ID trees migrate a same-title group once with all sources and prune emptied categories", async () => {
  const f = purposeFixture(); try {
    const a = f.create(), b = f.create(); for (const scope of [a, b]) { f.detail(scope, "独立来源"); f.memories.scan(scope); } f.publish();
    const old = f.tree.snapshot(f.workspace.id);
    old.roots = old.purposes.map((p, index) => ({ id: `old-${index}`, name: index ? "分类乙" : "分类甲", children: [{ id: p.id, purposeId: p.id, name: p.text, children: [] }] }));
    f.store.db.prepare("UPDATE memory_purpose_indexes SET body=? WHERE workspaceId=?").run(JSON.stringify(old), f.workspace.id);
    f.store.db.prepare("DELETE FROM memory_directory_layout WHERE workspace_id=?").run(f.workspace.id);
    const migrated = new MemoryTreeStore(f.store).nodeSnapshot(f.workspace.id);
    assert.equal(migrated.roots.length, 1); assert.equal(migrated.roots[0].children.length, 1);
    assert.equal(migrated.roots[0].children[0].purposeIds?.length, 2); assert.equal(migrated.roots[0].children[0].documentRefs?.length, 2);
    assert.equal(migrated.nameChars, Array.from(projectMemoryTree(migrated.roots).catalog).length);
    assert.deepEqual(new MemoryTreeStore(f.store).nodeSnapshot(f.workspace.id), migrated);
  } finally { await f.close(); }
});
