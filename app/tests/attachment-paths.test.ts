import assert from "node:assert/strict";
import { test } from "node:test";
import { attachmentInput, attachmentsInput, attachmentPrompt, attachmentDisplayText, type PickedAttachment } from "../src/shared/protocol.js";
import { assignReferences, removeAttachmentReferences } from "../src/client/chat/attachment-placeholders.js";
import { insertImageReferences } from "../src/client/chat/image-placeholders.js";
import { chatMessage } from "../src/server/transcript.js";

const items: PickedAttachment[] = [
  { name: "notes.txt", path: "C:\\project\\notes.txt", kind: "file" },
  { name: "截图.png", path: "C:\\project\\截图.png", kind: "image" },
  { name: "empty folder", path: "C:\\project\\empty folder", kind: "folder" },
];
test("mixed path references are stable, reserved text IDs are never reused", () => {
  const added = assignReferences("前[imag3]后", [{ id: "file2" }], items);
  assert.deepEqual(added.map((a) => a.id), ["file3", "imag4", "folder1"]);
  const insertion = insertImageReferences("前文后文", 2, 2, added.map((a) => a.id!));
  assert.equal(insertion.text, "前文[file3] [imag4] [folder1]后文");
  assert.equal(removeAttachmentReferences(insertion.text, ["imag4"]), "前文[file3]  [folder1]后文");
  assert.deepEqual(attachmentsInput(added), added);
});
test("absolute paths are data and mappings are available to agent but hidden in user transcript", () => {
  const added = assignReferences("", [], items);
  const prompt = attachmentPrompt("检查[file1] [imag1] [folder1]", added);
  for (const item of items) assert.ok(prompt.includes(JSON.stringify(item.path)));
  assert.equal(attachmentDisplayText(prompt), "检查[file1] [imag1] [folder1]");
  assert.equal(chatMessage({ role: "user", content: prompt }, "test")?.text, "检查[file1] [imag1] [folder1]");
  assert.equal(chatMessage({ role: "custom", customType: "axiom-append", display: true, content: prompt }, "test")?.text, "检查[file1] [imag1] [folder1]");
  assert.equal(attachmentDisplayText("自定义附件路径映射文字"), "自定义附件路径映射文字");
  assert.equal(attachmentInput({ ...added[0], path: "/tmp/notes.txt" })?.path, "/tmp/notes.txt");
  assert.equal(attachmentInput({ ...added[0], path: "\\\\server\\share\\notes.txt" })?.path, "\\\\server\\share\\notes.txt");
});
test("path validation rejects malformed IDs, kinds, relative paths and duplicate refs", () => {
  const valid = assignReferences("", [], items)[0];
  for (const patch of [{ id: "imag1" }, { id: "file0" }, { id: "file1\ninstruction" }, { kind: "other" }, { path: "relative" }, { path: "C:relative" }, { path: "/a\0b" }, { path: "/a\nb" }])
    assert.throws(() => attachmentInput({ ...valid, ...patch }), { code: "INVALID_ATTACHMENT" });
  assert.throws(() => attachmentsInput([valid, valid]), { code: "INVALID_ATTACHMENT" });
  assert.throws(() => attachmentsInput(Array.from({ length: 51 }, (_, i) => ({ ...valid, id: `file${i + 1}` }))), { code: "INVALID_ATTACHMENT" });
  assert.equal(attachmentPrompt("legacy", [{ name: "old.txt", text: "old contents" }]).includes("old contents"), true);
});
