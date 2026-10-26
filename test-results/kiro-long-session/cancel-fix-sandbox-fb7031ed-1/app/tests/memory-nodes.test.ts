import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryTreeStore } from "../src/server/memory-tree.js";
import { preflightMemoryNodes } from "../src/server/memory-nodes.js";
import type { MemoryIndexNode } from "../src/shared/memory-tree.js";
import { purposeFixture, navigation, selection } from "./memory-purpose-fixture.js";
const flatten = (nodes: MemoryIndexNode[]): MemoryIndexNode[] => nodes.flatMap(node => [node, ...flatten(node.children)]);

test("numeric node IDs start at zero, survive restart/reordering and are never reused", async () => {
  const f = purposeFixture(); try {
    const scope = f.create("# [Completed] 首个目的\n# [Completed] 第二目的\n"); f.memories.scan(scope); f.publish();
    const before = flatten(f.tree.nodeSnapshot(f.workspace.id).roots), byPath = new Map(before.map(node => [node.titlePath, node.id]));
    assert.equal(before[0].id, "0"); assert.equal(before[0].parentId, "-1"); assert.equal(before[0].depth, 1); assert.deepEqual(before[0].ancestorIds, []);
    assert.equal(before[1].parentId, "0"); assert.deepEqual(before[1].ancestorIds, ["0"]);
    const raw = f.tree.snapshot(f.workspace.id); raw.roots[0].children.reverse();
    f.tree.publish(f.workspace.id, [], raw.roots, raw.version);
    const restarted = new MemoryTreeStore(f.store);
    for (const node of flatten(restarted.nodeSnapshot(f.workspace.id).roots)) assert.equal(node.id, byPath.get(node.titlePath));
    const counter = Number(f.store.db.prepare("SELECT next_id FROM memory_node_sequence").get()!.next_id);
    f.write(scope, "# [In progress] 首个目的\n# [Completed] 第二目的\n"); f.memories.scan(scope);
    assert.equal(flatten(f.tree.nodeSnapshot(f.workspace.id).roots).some(node => node.id === byPath.get("记忆事务 / 首个目的")), false);
    f.write(scope, "# [In progress] 首个目的\n# [Completed] 第二目的\n# [Completed] 第三个目的\n"); f.memories.scan(scope); f.publish();
    const added = flatten(f.tree.nodeSnapshot(f.workspace.id).roots).find(node => node.name === "第三个目的")!;
    assert.ok(Number(added.id) >= counter);
  } finally { await f.close(); }
});
test("workspace/path uniqueness merges directory and purpose identities without dropping any source", async () => {
  const f = purposeFixture(); try {
    const a = f.create("# [Completed] 同名\n"), b = f.create("# [Completed] 子目的\n"), c = f.create("# [Completed] 同名\n");
    for (const [scope, body] of [[a, "甲"], [b, "乙"], [c, "丙"]] as const) { f.detail(scope, body); f.memories.scan(scope); }
    const purposes = f.tree.entries(f.workspace.id), same = purposes.filter(p => p.text === "同名"), child = purposes.find(p => p.text === "子目的")!;
    const roots = f.tree.classify(JSON.stringify([{ name: "分类", children: [
      { purposeId: same[0].id }, { name: "同名", children: [{ purposeId: child.id }] }, { purposeId: same[1].id },
    ] }]), purposes);
    f.tree.publish(f.workspace.id, purposes, roots, 0);
    const snapshot = f.tree.nodeSnapshot(f.workspace.id), node = snapshot.roots[0].children[0];
    assert.equal(snapshot.roots[0].children.length, 1); assert.equal(node.children.length, 1);
    assert.deepEqual(node.purposeIds, same.map(p => p.id)); assert.equal(node.documentRefs?.length, 2);
    assert.equal(new Set(node.documentRefs?.map(ref => ref.sessionId)).size, 2);
    const row = f.store.db.prepare("SELECT * FROM memory_directory_nodes WHERE id=?").get(Number(node.id))!;
    assert.throws(() => f.store.db.prepare("INSERT INTO memory_directory_nodes SELECT 9999,workspace_id,title,parent_id,depth,ancestor_ids,title_path,purpose_ids,document_refs,position,active FROM memory_directory_nodes WHERE id=?").run(Number(node.id)), /UNIQUE/);
    assert.equal(row.title_path, "分类 / 同名");
    const report = JSON.parse(String(f.store.db.prepare("SELECT report FROM memory_node_indexes WHERE workspace_id=?").get(f.workspace.id)!.report));
    assert.deepEqual(report.mergedPaths, ["分类 / 同名"]);
  } finally { await f.close(); }
});
test("metadata migration is idempotent; normal unchanged-source scan backfills actual references", async () => {
  const f = purposeFixture(); try {
    const scope = f.create(); f.detail(scope, "可复用正文"); f.memories.scan(scope); f.publish();
    const legacy = f.tree.snapshot(f.workspace.id), originalPurpose = legacy.purposes[0].id;
    f.store.db.exec("DROP TABLE memory_directory_nodes; DROP TABLE memory_node_indexes; DROP TABLE memory_node_sequence; DROP TABLE memory_purpose_documents;");
    const migrated = new MemoryTreeStore(f.store), before = migrated.nodeSnapshot(f.workspace.id);
    assert.equal(before.version, legacy.version); assert.deepEqual(before.roots[0].children[0].documentRefs, []);
    const ids = flatten(before.roots).map(node => node.id);
    assert.deepEqual(flatten(new MemoryTreeStore(f.store).nodeSnapshot(f.workspace.id).roots).map(node => node.id), ids);
    f.memories.scan(scope); const populated = migrated.nodeSnapshot(f.workspace.id);
    assert.equal(populated.roots[0].children[0].documentRefs?.length, 1); assert.equal(populated.purposes[0].id, originalPurpose);
    const version = populated.version; f.memories.scan(scope);
    assert.equal(migrated.nodeSnapshot(f.workspace.id).version, version); assert.deepEqual(flatten(migrated.nodeSnapshot(f.workspace.id).roots).map(node => node.id), ids);
  } finally { await f.close(); }
});
test("an already classified purpose gains documents without requeueing or replacing IDs", async () => {
  const f = purposeFixture(); try {
    const scope = f.create(); f.detail(scope, "原有正文"); f.memories.scan(scope); f.publish();
    const before = f.tree.nodeSnapshot(f.workspace.id), purpose = f.tree.entries(f.workspace.id)[0];
    f.detail(scope, "后来新增详情", "## [Completed] 验证结果"); f.memories.scan(scope);
    const after = f.tree.nodeSnapshot(f.workspace.id), node = after.roots[0].children[0];
    assert.equal(after.version, before.version + 1); assert.equal(node.id, before.roots[0].children[0].id); assert.equal(node.documentRefs?.length, 2);
    assert.equal(f.tree.entries(f.workspace.id).length, 1); assert.equal(f.tree.entries(f.workspace.id)[0].processedAt, purpose.processedAt);
    f.memories.scan(scope); assert.equal(f.tree.nodeSnapshot(f.workspace.id).version, after.version);
  } finally { await f.close(); }
});
test("revoking one source retains the shared node, its other source, and its stable ID", async () => {
  const f = purposeFixture(); try {
    const a = f.create(), b = f.create(); for (const scope of [a, b]) { f.detail(scope, "独立来源"); f.memories.scan(scope); } f.publish();
    const before = f.tree.nodeSnapshot(f.workspace.id).roots[0].children[0]; assert.equal(before.documentRefs?.length, 2);
    f.write(a, "# [In progress] 验证目的\n"); f.memories.scan(a);
    const after = f.tree.nodeSnapshot(f.workspace.id).roots[0].children[0];
    assert.equal(after.id, before.id); assert.equal(after.purposeIds?.length, 1); assert.equal(after.documentRefs?.length, 1); assert.equal(after.documentRefs?.[0].sessionId, b.sessionId);
    f.memories.scan(a); assert.equal(f.tree.nodeSnapshot(f.workspace.id).roots[0].children[0].documentRefs?.length, 1);
  } finally { await f.close(); }
});
test("abandoned ancestors and original document states survive direct-reference reading", async () => {
  const f = purposeFixture(); try {
    await f.configure({ queryModel: selection });
    const entry = "# [Completed] 完成目标\n## [Abandoned] ~~旧尝试~~\n### [In progress] ~~旧步骤~~\n## [Completed] 新步骤\n";
    const scope = f.create(entry); f.detail(scope, "历史失败不可当作成功", "### [In progress] ~~旧步骤~~"); f.memories.scan(scope); f.publish();
    const ref = f.tree.nodeSnapshot(f.workspace.id).roots[0].children[0].documentRefs![0];
    assert.equal(ref.state, "已放弃"); assert.equal(ref.ancestors.at(-1)?.state, "已放弃"); assert.equal(ref.ancestors.at(-1)?.title, "旧尝试");
    let answered = false; f.memories.runner = { close: async () => {}, execute: async input => {
      const evidence = JSON.parse(input.prompt).evidence;
      if (evidence) { answered = true; assert.equal(evidence[0].state, "已放弃"); assert.equal(evidence[0].ancestors.at(-1).state, "已放弃"); }
      return navigation(input);
    } };
    assert.equal((await f.memories.query(scope, "旧尝试结果")).incomplete, false); assert.equal(answered, true);
  } finally { await f.close(); }
});
test("failed publication rolls back node IDs, references and migration metadata with the old index", async () => {
  const f = purposeFixture(); try {
    const scope = f.create(); f.detail(scope, "正文"); f.memories.scan(scope);
    const batch = f.tree.entries(f.workspace.id), roots = f.tree.classify(JSON.stringify([{ name: "事务", children: batch.map(p => ({ purposeId: p.id })) }]), batch);
    const nextId = f.store.db.prepare("SELECT next_id FROM memory_node_sequence").get()!.next_id;
    assert.throws(() => f.tree.publish(f.workspace.id, batch, roots, 0, () => { throw Error("injected transaction failure"); }), /injected/);
    assert.equal(f.tree.nodeSnapshot(f.workspace.id).roots.length, 0);
    assert.equal(f.store.db.prepare("SELECT next_id FROM memory_node_sequence").get()!.next_id, nextId);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS count FROM memory_node_indexes").get()!.count, 0);
    f.tree.publish(f.workspace.id, batch, roots, 0); assert.equal(f.tree.nodeSnapshot(f.workspace.id).roots[0].id, "0");
  } finally { await f.close(); }
});
test("migration reports legacy titles without renaming and refuses ambiguous path separators atomically", async () => {
  const f = purposeFixture(); try {
    const scope = f.create("# [Completed] Axiom2 〔1〕\n"); f.memories.scan(scope); f.publish();
    const legacy = f.tree.snapshot(f.workspace.id); assert.deepEqual(preflightMemoryNodes(legacy).legacyTitles, ["记忆事务 / Axiom2 〔1〕"]);
    const invalid = structuredClone(legacy); invalid.roots[0].name = "不应/清洗";
    f.store.db.prepare("UPDATE memory_purpose_indexes SET body=? WHERE workspaceId=?").run(JSON.stringify(invalid), f.workspace.id);
    f.store.db.exec("DELETE FROM memory_node_indexes; DELETE FROM memory_directory_nodes;");
    const nextId = f.store.db.prepare("SELECT next_id FROM memory_node_sequence").get()!.next_id;
    assert.throws(() => new MemoryTreeStore(f.store), /迁移预检/);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS count FROM memory_directory_nodes").get()!.count, 0);
    assert.equal(f.store.db.prepare("SELECT next_id FROM memory_node_sequence").get()!.next_id, nextId);
    assert.equal(f.tree.snapshot(f.workspace.id).roots[0].name, "不应/清洗", "never silently rewrite the original index");
  } finally { await f.close(); }
});
