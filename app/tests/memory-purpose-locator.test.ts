import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryPurposes } from "../src/shared/memory-purposes.js";
import { canonicalMemoryPurpose, locateMemoryPurpose, queryMemorySnapshot } from "../src/shared/memory-purpose-locator.js";
import { emptyMemoryTree, type MemoryPurpose } from "../src/shared/memory-tree.js";
import { projectMemoryTree } from "../src/shared/memory-query-projection.js";

const purpose = (text: string, key = JSON.stringify([text.normalize("NFC")]), sessionId = "source", id = key): MemoryPurpose => ({ id, text, source: { sessionId, path: "MEMORY.md", key } });
test("exact bindings and uniquely reference-annotated historical titles, never arbitrary renames", () => {
  const p = purpose("目标");
  assert.equal(locateMemoryPurpose(p, memoryPurposes("# [Completed] 目标"))?.complete, true);
  assert.equal(locateMemoryPurpose(p, memoryPurposes("# [Completed] 目标 〔12〕")), undefined, "annotations require an independently published binding, not a guess from the source");
  assert.equal(locateMemoryPurpose(p, memoryPurposes("# [Completed] 目标 〔12〕"), [p, purpose("目标 〔12〕")])?.title, "目标 〔12〕");
  for (const title of ["目标改名", "目标〔12〕", "目标 〔0〕", "目标 〔01〕"]) assert.equal(locateMemoryPurpose(p, memoryPurposes(`# [Completed] ${title}`)), undefined);
  assert.equal(locateMemoryPurpose(p, memoryPurposes("# [Completed] 目标 〔1〕\n# [Completed] 目标 〔2〕")), undefined);
  assert.equal(locateMemoryPurpose(purpose("目标 〔1〕"), memoryPurposes("# [Completed] 目标 〔2〕")), undefined);
  assert.equal(locateMemoryPurpose(purpose("目标", '["different"]'), memoryPurposes("# [Completed] 目标 〔1〕")), undefined);
  assert.equal(locateMemoryPurpose(p, memoryPurposes("# [Waiting] 目标 〔1〕"), [p, purpose("目标 〔1〕")])?.complete, false);
  assert.equal(locateMemoryPurpose(p, memoryPurposes("# [Completed] 目标 〔1〕\n## [In progress] 未完成步骤"), [p, purpose("目标 〔1〕")])?.complete, false);
  assert.equal(locateMemoryPurpose(p, memoryPurposes("# [Completed] 目标\n正文")), undefined);
});
test("legacy ordinal locators require a unique independently stored canonical peer in the same session", () => {
  const old = purpose("目标", '["historical-label",0]'), current = purpose("目标 〔9〕");
  assert.equal(canonicalMemoryPurpose(old, [old]), old, "legacy ordinal alone cannot locate a file");
  assert.equal(canonicalMemoryPurpose(old, [old, current]), current);
  assert.equal(locateMemoryPurpose(old, memoryPurposes("# [Completed] 目标 〔9〕"), [old, current])?.complete, true);
  assert.equal(canonicalMemoryPurpose(old, [purpose("目标 〔9〕", undefined, "other")]), old);
  assert.equal(canonicalMemoryPurpose(old, [current, purpose("目标 〔10〕")]), old, "multiple numbered candidates fail closed");
  const exact = purpose("目标"); assert.equal(canonicalMemoryPurpose(old, [current, exact]), exact, "an exact title takes precedence over an annotation");
  for (const key of ['["x",-1]', '["x",1.5]', '["x","0"]', '["x",0,0]', '{}', 'invalid']) {
    const malformed = purpose("目标", key); assert.equal(canonicalMemoryPurpose(malformed, [current]), malformed);
  }
  const numbered = purpose("目标 〔1〕", '["old",0]'); assert.equal(canonicalMemoryPurpose(numbered, [current]), numbered);
});
test("an unnumbered alias cannot bypass an explicitly numbered published identity", () => {
  const old = purpose("目标"), numbered = purpose("目标 〔1〕"), changed = memoryPurposes("# [Completed] 目标 〔2〕");
  assert.equal(locateMemoryPurpose(old, changed, [old, numbered]), undefined);
  assert.equal(locateMemoryPurpose(old, memoryPurposes("# [Completed] 目标 〔1〕"), [old, numbered])?.complete, true);
  assert.equal(locateMemoryPurpose(old, memoryPurposes("# [Completed] 目标 〔1〕"), [old, numbered, purpose("目标 〔2〕")]), undefined);
  assert.equal(locateMemoryPurpose(old, memoryPurposes("# [Completed] 目标\n# [Completed] 目标 〔1〕"), [old, numbered])?.title, "目标", "distinct exact bindings remain exact");
  assert.equal(locateMemoryPurpose(old, changed, [old, purpose("目标 〔1〕", undefined, "other")]), undefined, "a different session cannot prove this binding");
});
test("legacy alias pruning leaves duplicate semantic paths available for lossless node migration", () => {
  const old = purpose("重复目的", '["重复目的",0]', "source", "legacy"), current = purpose("重复目的");
  const a = purpose("另一目的"), b = purpose("更多目的");
  const leaf = (p: MemoryPurpose) => ({ id: p.id, purposeId: p.id, name: p.text, children: [] });
  const snapshot = { ...emptyMemoryTree(), purposes: [old, current, a, b], roots: [
    { id: "first", name: "目录", children: [leaf(old), leaf(a)] },
    { id: "second", name: "目录", children: [leaf(current), leaf(b)] },
  ] };
  const view = queryMemorySnapshot(snapshot);
  assert.deepEqual(view.purposes.map(p => p.id), [current.id, a.id, b.id]);
  assert.equal(view.roots.length, 2, "migration, not alias pruning, is responsible for merging paths");
  assert.equal(view.nameChars, Array.from("目录：\n目录\n目录").length);
  assert.throws(() => projectMemoryTree(view.roots), /歧义/, "strict matching still rejects unmerged paths");
  assert.equal(snapshot.roots[0].children.length, 2, "raw legacy input remains unchanged");
});
test("snapshot projection prunes only proven duplicate legacy leaves, without mutation or changing version", () => {
  const old = purpose("目标", '["old-label",0]', "source", "legacy"), current = purpose("目标 〔3〕", undefined, "source", "current");
  const unsupported = purpose("未知来源", '["unknown",0]', "source", "unproven");
  const snapshot = { ...emptyMemoryTree(), version: 9, purposes: [old, current, unsupported], roots: [{ id: "directory", name: "核验记录", children: [old, current, unsupported].map(p => ({ id: p.id, purposeId: p.id, name: p.text, children: [] })) }] };
  const before = structuredClone(snapshot), view = queryMemorySnapshot(snapshot);
  assert.equal(view.version, 9); assert.deepEqual(view.purposes.map(p => p.id), ["current", "unproven"]);
  assert.deepEqual(view.roots[0].children.map(p => p.id), ["current", "unproven"]);
  assert.deepEqual(snapshot, before); assert.equal(queryMemorySnapshot(view), view);
});
