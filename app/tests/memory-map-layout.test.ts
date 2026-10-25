import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutMemoryMap, mapNodeHeight, memoryMapNodes, type MemoryMapNode } from "../src/client/memory/memory-map-layout.js";
const leaf = (id: string, label = id): MemoryMapNode => ({ id, label, kind: "Purpose", children: [] });
const branch = (id: string, children: MemoryMapNode[]): MemoryMapNode => ({ id, label: id, kind: "Directory", children: children.map(child => ({ ...child, parent: id })) });
const roots = [branch("开发", [branch("界面", [leaf("purpose-a", "画布交互设计"), leaf("purpose-b", "搜索结果定位")]), leaf("purpose-c", "原文来源")]), branch("工作流", [leaf("purpose-d", "压缩记录")])];
test("mind map starts with balanced root branches, root connections, no overlapping nodes", () => {
  const layout = layoutMemoryMap(roots, new Set());
  assert.equal(layout.positions.length, 2); assert.equal(layout.edges.length, 2);
  const [right, left] = layout.positions;
  assert.equal(right.side, 1); assert.equal(left.side, -1);
  assert.ok(right.x > layout.root.x + layout.root.width); assert.ok(left.x + left.width < layout.root.x);
  assert.equal(right.y, left.y);
});
test("expanded parents are centered on their subtree and descendants never overlap", () => {
  const layout = layoutMemoryMap(roots, new Set(["开发", "界面", "工作流"]));
  assert.equal(layout.positions.length, 7); assert.equal(layout.edges.length, 7);
  const byId = new Map(layout.positions.map(node => [node.id, node]));
  const a = byId.get("purpose-a")!, b = byId.get("purpose-b")!, parent = byId.get("界面")!;
  assert.equal(parent.y, (a.y + b.y) / 2);
  for (const node of layout.positions) {
    assert.ok(node.x >= 0 && node.y >= 0 && node.x + node.width <= layout.width && node.y + mapNodeHeight <= layout.height);
    for (const other of layout.positions) if (node.id !== other.id && node.x === other.x) assert.ok(Math.abs(node.y - other.y) >= mapNodeHeight);
  }
  assert.equal(layoutMemoryMap(roots, new Set(["界面"])).positions.length, 2, "collapsing an ancestor hides all descendants");
});
test("search reveals matching paths without mutating manual expansion", () => {
  const expanded = new Set(["工作流"]);
  const found = layoutMemoryMap(roots, expanded, "搜索结果");
  assert.deepEqual(found.positions.map(node => node.id), ["开发", "界面", "purpose-b"]);
  assert.deepEqual([...expanded], ["工作流"]);
  assert.equal(layoutMemoryMap(roots, expanded, " no results ").positions.length, 0);
  assert.equal(layoutMemoryMap(roots, expanded).positions.length, 3);
});
test("stable sides survive filtering and expansion; purpose sources remain available", () => {
  const found = layoutMemoryMap(roots, new Set(), "压缩"); assert.equal(found.positions[0].side, -1);
  const [node] = memoryMapNodes([{ id: "source", name: "Purpose", purposeId: "p", children: [] }], [{ id: "p", text: "Purpose", source: { sessionId: "s", path: "MEMORY.md", key: "k" } }]);
  assert.equal(node.purpose?.source.sessionId, "s");
  assert.equal(layoutMemoryMap([node], new Set(), "memory.MD").positions.length, 1);
});
test("partial tree views preserve the supplied full breadcrumb", () => {
  const [directory, title] = memoryMapNodes([
    { id: "0", name: "语义子目录", titlePath: "完整目录 / 语义子目录", children: [] },
    { id: "1", name: "原题", kind: "title", titlePath: JSON.stringify(["完整目录", "原题"]), children: [] },
  ], []);
  assert.equal(directory.displayPath, "完整目录 / 语义子目录");
  assert.equal(title.displayPath, "完整目录 / 原题");
});
test("original-title display breadcrumbs stay readable and separate from reversible identity", () => {
  const [root] = memoryMapNodes([{ id: "0", name: "语义目录", kind: "directory", children: [
    { id: "1", name: "原题 / 任意符号 😀", kind: "title", children: [], titlePath: JSON.stringify(["语义目录", "原题 / 任意符号 😀"]) },
  ] }], []);
  assert.equal(root.children[0].kind, "Purpose");
  assert.equal(root.children[0].displayPath, "语义目录 / 原题 / 任意符号 😀");
  assert.deepEqual(JSON.parse(root.children[0].titlePath!), ["语义目录", "原题 / 任意符号 😀"]);
});
test("empty, depth-64 and broad layouts return finite bounds", () => {
  assert.equal(layoutMemoryMap([], new Set()).positions.length, 0);
  let deep = leaf("deep"); const expanded = new Set<string>();
  for (let i = 0; i < 64; i++) { expanded.add(`level-${i}`); deep = branch(`level-${i}`, [deep]); }
  const layout = layoutMemoryMap([deep], expanded); assert.equal(layout.positions.length, 65); assert.ok(Number.isFinite(layout.width));
  const broad = layoutMemoryMap([branch("wide", Array.from({ length: 4000 }, (_, i) => leaf(`leaf-${i}`)))], new Set(["wide"]));
  assert.equal(broad.positions.length, 4001); assert.ok(Number.isFinite(broad.height));
});
