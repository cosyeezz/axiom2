import assert from "node:assert/strict";
import test from "node:test";
import { mergeRecalledDrafts } from "../src/client/chat/recall-drafts.js";
import type { Draft } from "../src/shared/protocol.js";
const empty: Draft = { text: "", attachment: null, attachments: [], images: [] };

test("recall preserves current typing, order and duplicate queued text", () => {
  const current = { ...empty, text: "new typing" };
  assert.equal(mergeRecalledDrafts(current, []).text, "new typing");
  assert.equal(mergeRecalledDrafts(current, [{ ...empty, text: "same" }, { ...empty, text: "same" }]).text, "same\n\nsame\n\nnew typing");
});
test("recall restores attachments and images without changing the current draft's references", () => {
  const attachment = { id: "file1", name: "a.ts", kind: "file" as const, path: "F:/a.ts", text: "" };
  const image = { id: "imag1", name: "p.png", mimeType: "image/png", data: "exact-original" };
  const current: Draft = { text: "current [file1] [imag1]", attachment: null, attachments: [attachment], images: [image] };
  const recalled: Draft = { text: "old [file1] [imag1] [file2]", attachment: { name: "legacy.txt", text: "inline" }, attachments: [attachment], images: [image] };
  const merged = mergeRecalledDrafts(current, [recalled, recalled]);
  assert.equal(merged.text, "old [file3] [imag2] [file2]\n\nold [file4] [imag3] [file2]\n\ncurrent [file1] [imag1]");
  assert.deepEqual(merged.attachments?.map((a) => a.id), ["file1", undefined, "file3", undefined, "file4"]);
  assert.deepEqual(merged.images?.map((i) => [i.id, i.data]), [["imag1", "exact-original"], ["imag2", "exact-original"], ["imag3", "exact-original"]]);
  assert.equal(current.text, "current [file1] [imag1]");
  assert.equal(recalled.attachments?.[0].id, "file1", "never mutate command receipts or previous draft");
});
test("literal file/image/folder references in restored quotes keep their original spelling", () => {
  const literal = "> 原方案中的 [file1]、[imag1]、[folder1] 只是引用原文。";
  const current: Draft = { ...empty, text: "新输入 [file1] [imag1] [folder1]", attachments: [
    { id: "file1", name: "a.ts", kind: "file", path: "F:/a.ts", text: "" },
    { id: "folder1", name: "project", kind: "folder", path: "F:/project", text: "" },
  ], images: [{ id: "imag1", name: "p.png", mimeType: "image/png", data: "bytes" }] };
  const result = mergeRecalledDrafts(current, [{ ...empty, text: literal }, { ...empty, text: literal }]);
  assert.equal(result.text, `${literal}\n\n${literal}\n\n${current.text}`);
  assert.deepEqual(result.attachments, current.attachments);
  assert.deepEqual(result.images, current.images);
});
test("empty editor restores local IDs unchanged and legacy content losslessly", () => {
  const draft: Draft = { ...empty, text: "inspect [folder1]", attachment: { name: "legacy", text: "body" }, attachments: [{ id: "folder1", name: "project", kind: "folder", path: "F:/project", text: "" }] };
  const merged = mergeRecalledDrafts(empty, [draft]);
  assert.equal(merged.text, draft.text);
  assert.deepEqual(merged.attachments, [draft.attachment, ...draft.attachments!]);
});
