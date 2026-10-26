import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createEditToolDefinition, createWriteToolDefinition } from "@earendil-works/pi-coding-agent";
import { tmpdir } from "./temporary.js";
import { assertMemoryTreeEdit, memoryDetails, memoryTitleSegment } from "../src/shared/memory-detail-paths.js";
import { guardMemoryWrite, memoryFileOperations } from "../src/server/memory-write-guard.js";
import { availableMemoryDetails } from "../src/server/memory-detail-files.js";
const tree = "# [In progress] Goal\n## [Not started] Verify\n# [Completed] Other\n## [Completed] Verify\n";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-title-details-")), entry = join(root, "memory/session/MEMORY.md");
  mkdirSync(dirname(entry), { recursive: true }); writeFileSync(entry, tree);
  const operations = memoryFileOperations(() => entry);
  return { root, entry, operations, close: () => rmSync(root, { recursive: true, force: true }) };
}
test("full title ancestry isolates same-named steps and ignores status/strikethrough", () => {
  assert.deepEqual(memoryDetails(tree).map(d => d.path), ["details/Goal.md", "details/Goal/Verify.md", "details/Other.md", "details/Other/Verify.md"]);
  const cancelled = tree.replace("[In progress] Goal", "~~[Abandoned] Goal~~ #");
  assert.deepEqual(memoryDetails(cancelled).map(d => d.path), memoryDetails(tree).map(d => d.path));
  assert.doesNotThrow(() => assertMemoryTreeEdit(tree, cancelled));
  assert.doesNotThrow(() => assertMemoryTreeEdit(tree, tree + "# [Not started] Next\n"));
});
test("existing headings cannot be renamed, deleted or moved; literal numeric text remains identity", () => {
  for (const next of [tree.replace("Goal", "Renamed"), tree.replace("## [Not started] Verify\n", ""), tree.replace("## [Not started] Verify", "# [Not started] Verify")])
    assert.throws(() => assertMemoryTreeEdit(tree, next), /不能改名/);
  assert.throws(() => assertMemoryTreeEdit("# [Waiting] A〔1〕", "# [Waiting] A〔2〕"), /不能改名/);
  assert.doesNotThrow(() => assertMemoryTreeEdit("", "# [Waiting] (验收)\n## [Not started] [客户确认]"));
});
test("main tree rejects prose, links, comments, footnotes and invalid nesting", () => {
  for (const text of ["# Goal", tree + "正文", tree + "<!-- hidden -->", "# [Waiting] A[^x]", "# [Waiting] [A](a.md)", "## [Waiting] A", "# [Waiting] A\n### [Waiting] B", tree + "\u0000"])
    assert.throws(() => assertMemoryTreeEdit("", text));
});
test("file-safe titles reject aliases, unsafe filenames and title-path collisions", () => {
  for (const title of [".", "..", "a/b", "a\\b", "NUL", "COM¹.txt", "LPT2", "a.", "a ", "a:b", "a.md", "A.MD", "\ud800", "\udc00", "字".repeat(67)]) assert.throws(() => memoryTitleSegment(title));
  for (const [a, b] of [["Goal", "goal"], ["é", "e\u0301"], ["Ａ", "A"], ["ß", "SS"]])
    assert.throws(() => memoryDetails(`# [Waiting] ${a}\n# [Waiting] ${b}`), /重名/);
  for (const text of ["# [Waiting] A\n# [Waiting] A.md\n## [Waiting] B", "# [Waiting] A.md\n## [Waiting] B\n# [Waiting] A"])
    assert.throws(() => memoryDetails(text), /文件名|路径冲突/);
});
test("native multi-edit validates the final original-snapshot candidate, preserves BOM/CRLF and literal dollars", async () => {
  const f = fixture(); try {
    const entry = "\ufeff" + tree.replaceAll("\n", "\r\n"); writeFileSync(f.entry, entry);
    const tool = createEditToolDefinition(f.root, { operations: f.operations });
    await tool.execute("edit", { path: f.entry, edits: [
      { oldText: "[Not started] Verify", newText: "[In progress] Verify" },
      { oldText: "# [Completed] Other", newText: "# [Waiting] Other" },
    ] }, undefined, undefined, {} as never);
    assert.equal(readFileSync(f.entry, "utf8"), entry.replace("[Not started] Verify", "[In progress] Verify").replace("# [Completed] Other", "# [Waiting] Other"));
    const path = join(dirname(f.entry), "details/Goal.md"); mkdirSync(dirname(path)); writeFileSync(path, "one\ntwo\n");
    await tool.execute("dollars", { path, edits: [{ oldText: "one", newText: "$& two" }, { oldText: "two", newText: "last" }] }, undefined, undefined, {} as never);
    assert.equal(readFileSync(path, "utf8"), "$& two\nlast\n");
    const before = readFileSync(f.entry);
    await assert.rejects(tool.execute("rename", { path: f.entry, edits: [{ oldText: "Goal", newText: "Changed" }] }, undefined, undefined, {} as never), /不能改名/);
    assert.deepEqual(readFileSync(f.entry), before);
    await assert.rejects(tool.execute("overlap", { path, edits: [{ oldText: "$& two", newText: "x" }, { oldText: "two", newText: "y" }] }, undefined, undefined, {} as never));
  } finally { f.close(); }
});
test("native write creates details on demand, rejects orphan/NUL details and foreign memory", async () => {
  const f = fixture(); try {
    assert.deepEqual(availableMemoryDetails(dirname(f.entry), tree), []);
    const tool = createWriteToolDefinition(f.root, { operations: f.operations }), path = join(dirname(f.entry), "details/Goal/Verify.md");
    await tool.execute("detail", { path, content: "evidence" }, undefined, undefined, {} as never);
    assert.equal(readFileSync(path, "utf8"), "evidence");
    assert.equal(readFileSync(f.entry, "utf8"), tree);
    assert.deepEqual(availableMemoryDetails(dirname(f.entry), tree).map(d => d.path), ["details/Goal/Verify.md"]);
    await assert.rejects(tool.execute("orphan", { path: join(dirname(path), "Missing.md"), content: "no" }, undefined, undefined, {} as never), /现有标题/);
    assert.throws(() => guardMemoryWrite(f.entry, path, "a\u0000b"), /NUL/);
    const foreign = join(f.root, "memory/foreign/MEMORY.md"); mkdirSync(dirname(foreign)); writeFileSync(foreign, tree);
    await assert.rejects(tool.execute("foreign", { path: foreign, content: tree }, undefined, undefined, {} as never), /其他来源记忆只读/);
  } finally { f.close(); }
});
test("discovery distinguishes genuinely absent directories from damaged ancestor links", () => {
  const f = fixture(); try {
    assert.deepEqual(availableMemoryDetails(dirname(f.entry), tree), []);
    symlinkSync(join(f.root, "missing"), join(dirname(f.entry), "details"));
    assert.throws(() => availableMemoryDetails(dirname(f.entry), tree), /链接/);
  } finally { f.close(); }
});
test("dangling detail links cannot create an outside file", async () => {
  const f = fixture(); try {
    const path = join(dirname(f.entry), "details/Goal.md"), outside = join(f.root, "outside.md"); mkdirSync(dirname(path)); symlinkSync(outside, path);
    assert.throws(() => guardMemoryWrite(f.entry, path, "unsafe"));
    await assert.rejects(f.operations.writeFile(path, "unsafe")); assert.equal(existsSync(outside), false);
  } finally { f.close(); }
});
