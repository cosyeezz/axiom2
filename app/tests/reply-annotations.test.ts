import assert from "node:assert/strict";
import test from "node:test";
import { annotationPresentation, annotationPrompt, clearSentAnnotations, getAnnotations, saveAnnotation, updateAnnotations, type ReplyAnnotation } from "../src/client/chat/reply-annotations.js";
const scope = () => ({ workspaceId: crypto.randomUUID(), sessionId: crypto.randomUUID() });
const note = (text = "改用批量提交"): ReplyAnnotation => ({ id: crypto.randomUUID(), messageId: "reply-1", block: 2, source: "原方案", quote: "原方案", text });
test("annotation drafts and editor survive closing mode without leaking across workspaces or sessions", () => {
  const owner = scope(), child = { ...owner, sessionId: crypto.randomUUID() }, other = { ...owner, workspaceId: crypto.randomUUID() };
  updateAnnotations(owner, { enabled: true, editor: note() }); saveAnnotation(owner);
  updateAnnotations(owner, { editor: note("仍在输入"), enabled: false });
  assert.equal(getAnnotations(owner).items.length, 1);
  assert.equal(getAnnotations(owner).editor?.text, "仍在输入");
  assert.equal(getAnnotations(child).items.length, 0); assert.equal(getAnnotations(other).editor, null);
  updateAnnotations(owner, { enabled: true });
  assert.equal(getAnnotations(owner).editor?.text, "仍在输入");
});
test("clearing a captured annotation batch preserves later additions and edited comments", () => {
  const owner = scope(), sent = [note()];
  updateAnnotations(owner, { items: sent });
  updateAnnotations(owner, { editor: { ...sent[0], text: "更新意见" } }); saveAnnotation(owner);
  updateAnnotations(owner, { editor: note("新增意见") }); saveAnnotation(owner);
  clearSentAnnotations(owner, sent);
  assert.deepEqual(getAnnotations(owner).items.map((item) => item.text), ["更新意见", "新增意见"]);
});
test("typing updates the editor without changing the snapshot observed by source blocks", () => {
  const owner = scope(), editor = note("");
  updateAnnotations(owner, { enabled: true, editor });
  const before = annotationPresentation(owner);
  for (const text of ["a", "ab", "abc"]) {
    updateAnnotations(owner, { editor: { ...editor, text } });
    assert.equal(annotationPresentation(owner), before);
    assert.equal(getAnnotations(owner).editor?.text, text);
  }
  saveAnnotation(owner);
  assert.notEqual(annotationPresentation(owner), before);
  assert.equal(annotationPresentation(owner).items[0].text, "abc");
});
test("batch submission carries immutable original quotes, reply identity and each comment without the whole source", () => {
  const item = { ...note(), quote: "需要修改的部分\n第二行", source: "整段包括其他内容", text: "缩短超时并解释原因" };
  const prompt = annotationPrompt([item, note("第二条意见")]);
  assert.ok(prompt.includes('回复 "reply-1"，内容块 3'));
  assert.ok(prompt.includes("> 需要修改的部分\n> 第二行"));
  assert.ok(prompt.includes(item.text)); assert.ok(prompt.includes("第二条意见"));
  assert.ok(!prompt.includes("整段包括其他内容"));
  assert.equal(annotationPrompt([]), "");
});
