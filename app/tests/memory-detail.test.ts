import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { assertMemoryEdit, guardMemoryEdit, memoryDetail } from "../src/server/memory-detail.js";
import { digest } from "../src/server/memory-files.js";
import { pendingMemoryRead, recordMemoryRead } from "../src/server/memory-recovery.js";

function fixture(body = "# 固定目标\n## [进行中] 实现\n- [未开始] 验证\n") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "axiom-detail-"))), entry = join(root, "MEMORY.md"), details = join(root, "references", "details.md");
  writeFileSync(entry, body);
  return { root, entry, details, revision: () => digest(readFileSync(entry)), close: () => rmSync(root, { recursive: true, force: true }) };
}
test("single-detail lifecycle allocates monotonic IDs and associates exactly one main line", () => {
  const f = fixture(); try {
    const one = memoryDetail(f.entry, { action: "write", anchor: "## [进行中] 实现", entryRevision: f.revision(), content: "第一次失败\n随后修复" });
    assert.equal(one.id, 1); assert.equal(one.linked, true);
    assert.match(readFileSync(f.entry, "utf8"), /## \[进行中\] 实现 〔1〕/);
    assert.equal(memoryDetail(f.entry, { action: "read", id: 1 }).content, "第一次失败\n随后修复");
    const two = memoryDetail(f.entry, { action: "write", anchor: "# 固定目标", entryRevision: f.revision(), content: "整体范围" });
    assert.equal(two.id, 2); assert.match(readFileSync(f.entry, "utf8"), /^# 固定目标 〔2〕/);
    const before = memoryDetail(f.entry, { action: "read", id: 1 });
    const updated = memoryDetail(f.entry, { action: "write", id: 1, revision: before.revision, oldText: "随后修复", newText: "随后修复并验证" });
    assert.equal(updated.content, "第一次失败\n随后修复并验证");
    assert.throws(() => memoryDetail(f.entry, { action: "write", id: 1, revision: before.revision, content: "覆盖" }), /修订冲突/);
    assert.equal(memoryDetail(f.entry, { action: "read", id: 2 }).content, "整体范围");
    const link = memoryDetail(f.entry, { action: "write", id: 1, revision: updated.revision, anchor: "- [未开始] 验证", entryRevision: f.revision() });
    assert.equal(link.content, updated.content); assert.match(readFileSync(f.entry, "utf8"), /验证 〔1〕/);
  } finally { f.close(); }
});
test("unique line association cannot hit an earlier substring and preserves CRLF/BOM revisions", () => {
  const f = fixture("\uFEFF# 固定目标\r\n说明：## [进行中] 实现\r\n## [进行中] 实现\r\n"); try {
    const first = memoryDetail(f.entry, { action: "write", anchor: "## [进行中] 实现", entryRevision: f.revision(), content: "正文" });
    assert.equal(first.entryRevision, f.revision());
    assert.equal(readFileSync(f.entry, "utf8"), "\uFEFF# 固定目标\r\n说明：## [进行中] 实现\r\n## [进行中] 实现 〔1〕\r\n");
    writeFileSync(f.details, "\uFEFF" + readFileSync(f.details, "utf8").replaceAll("\n", "\r\n"));
    const read = memoryDetail(f.entry, { action: "read", id: 1 });
    const next = memoryDetail(f.entry, { action: "write", id: 1, revision: read.revision, content: "第二版" });
    assert.equal(next.revision, digest(readFileSync(f.details)));
    assert.doesNotThrow(() => memoryDetail(f.entry, { action: "write", id: 1, revision: next.revision, content: "第三版" }));
  } finally { f.close(); }
});
test("reject invalid input, anchors, partial edits, damaged bounds, locks and aborted writes", () => {
  const f = fixture(); try {
    for (const input of [{ action: "read", id: 1 }, { action: "write", content: "无主项" }, { action: "write", anchor: "不存在", content: "无主项", entryRevision: f.revision() }] as const) assert.throws(() => memoryDetail(f.entry, input));
    const one = memoryDetail(f.entry, { action: "write", anchor: "# 固定目标", entryRevision: f.revision(), content: "重复 重复" });
    assert.throws(() => memoryDetail(f.entry, { action: "write", id: 1, revision: one.revision, oldText: "重复", newText: "新" }), /唯一原文/);
    assert.throws(() => memoryDetail(f.entry, { action: "write", id: 1, revision: one.revision, content: "<!-- detail:2:start -->" }), /受管标记/);
    assert.throws(() => memoryDetail(f.entry, { action: "write", id: 1, revision: one.revision, content: "新" }, AbortSignal.abort()));
    writeFileSync(join(f.root, ".memory-detail.lock"), "locked");
    assert.throws(() => memoryDetail(f.entry, { action: "write", id: 1, revision: one.revision, content: "新" }), /占用/);
    rmSync(join(f.root, ".memory-detail.lock"));
    writeFileSync(f.details, "<!-- detail-next:2 -->\n<!-- detail:1:start -->\n破坏");
    assert.throws(() => memoryDetail(f.entry, { action: "read", id: 1 }), /边界/);
  } finally { f.close(); }
});
test("controlled edits enforce immutable title, existing references and managed file boundary", () => {
  const f = fixture(); try {
    assert.throws(() => guardMemoryEdit(f.entry, "write", { path: f.details, content: "覆盖" }), /memory_detail/);
    assert.throws(() => guardMemoryEdit(f.entry, "edit", { path: f.entry, edits: [{ oldText: "固定目标", newText: "改标题" }] }), /不能修改/);
    assert.throws(() => assertMemoryEdit(f.entry, readFileSync(f.entry, "utf8"), "# 固定目标\n- [未开始] 引用 〔99〕"), /不存在/);
    assert.doesNotThrow(() => guardMemoryEdit(f.entry, "edit", { path: f.entry, edits: [{ oldText: "[未开始] 验证", newText: "[已完成] 验证" }] }));
  } finally { f.close(); }
});
test("recovery confirms complete paginated reads only within one revision", () => {
  const f = fixture("首行\n第二行\n尾行"); try {
    const manager = SessionManager.inMemory(f.root);
    manager.appendMessage({ role: "user", content: "任务", timestamp: Date.now() });
    manager.appendCompaction("摘要", manager.getLeafId()!, 1000);
    const read = (offset: number, text: string, parentToolCallId?: string) => recordMemoryRead(manager, f.entry, f.root, { toolName: "read", input: { path: f.entry, offset, limit: 1 }, isError: false, content: [{ type: "text", text }], parentToolCallId });
    assert.equal(read(1, "首行\n"), false); assert.equal(read(3, "尾行", "child"), false);
    writeFileSync(f.entry, "改首行\n第二行\n尾行");
    assert.equal(read(2, "第二行\n"), false); assert.equal(read(3, "尾行"), false);
    assert.ok(pendingMemoryRead(manager)); assert.equal(read(1, "改首行\n"), true); assert.equal(pendingMemoryRead(manager), null);
  } finally { f.close(); }
});
