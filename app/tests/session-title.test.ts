import assert from "node:assert/strict";
import { test } from "node:test";
import { chatMessage } from "../src/server/transcript.js";
import { extractSessionTitle, stripSessionTitle, validSessionTitle } from "../src/server/session-title.js";

const assistant = (text: string) => ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop" });

// Worker lifecycle and IPC behavior are covered through the product entry point
// in title-generation.test.ts, rather than a separate direct-fork harness.
test("title validation normalizes whitespace and counts Unicode code points", () => {
  assert.equal(validSessionTitle("  会话\n 标题\t "), "会话 标题");
  assert.equal(validSessionTitle("😀".repeat(10)), "😀".repeat(10));
  for (const value of [null, 1, {}, "", " \n ", "😀".repeat(11), "12345678901", "a\0b", "<x>", "\ud800"])
    assert.equal(validSessionTitle(value), undefined);
});

test("extract only a standalone leading title, including multiline and CRLF", () => {
  for (const [raw, title, body] of [
    ["<title>会话标题</title>\n正文", "会话标题", "正文"],
    ["\n \n  <TITLE>\n 多行\n标题 \n</TITLE> \n正文", "多行 标题", "正文"],
    ["\r\n<title>标题</title>\r\n    code", "标题", "    code"],
    ["<title>😀😀</title>", "😀😀", ""],
  ]) {
    assert.equal(extractSessionTitle(raw), title);
    assert.equal(stripSessionTitle(raw), body);
    assert.equal(stripSessionTitle(raw, true), body);
  }
});

test("code, HTML, inline markers, nonleading and invalid titles remain untouched", () => {
  const ordinary = [
    "正文\n<title>标题</title>",
    "```html\n<title>标题</title>\n```",
    "```html\nexample\n```\n<title>标题</title>",
    "    <title>标题</title>",
    "\t<title>标题</title>",
    "`<title>标题</title>`",
    "> <title>标题</title>",
    "- <title>标题</title>",
    "示例 <title>标题</title>",
    "<title>标题</title> 是HTML",
    "<head>\n<title>网站</title>\n</head>",
    "<!doctype html>\n<html><head><title>网站</title></head></html>",
    '<title lang="zh">网站</title>',
    "<title><b>网站</b></title>",
    "<title></title>\n正文",
    "<title>12345678901</title>\n正文",
    "<title>第一行</title><title>第二行</title>",
    "<summary>摘要</summary>\n<progress>进度</progress>",
  ];
  for (const raw of ordinary) {
    assert.equal(extractSessionTitle(raw), undefined, raw);
    assert.equal(stripSessionTitle(raw), raw, raw);
    assert.equal(stripSessionTitle(raw, true), raw, raw);
  }
  const raw = "<title>标题</title>\n正文\n<title>保留正文</title>";
  assert.equal(stripSessionTitle(raw), "正文\n<title>保留正文</title>");
});

test("streaming holds only a possible leading marker; unfinished final text is restored", () => {
  const marker = "\n <title>\n标题\n</title>";
  for (let i = 0; i <= marker.length; i++)
    assert.equal(stripSessionTitle(marker.slice(0, i), true), "", `prefix ${i}`);
  for (const raw of ["<", "<tit", "<title>标题", "<title>标题</tit"])
    assert.equal(stripSessionTitle(raw), raw);
  for (const raw of ["<table>", "<title>12345678901", "<title><html>", "正文\n<tit", "```\n<tit", "    <tit"])
    assert.equal(stripSessionTitle(raw, true), raw);
  assert.equal(stripSessionTitle("<title>标题</title>\n正文\n<tit", true), "正文\n<tit");
});

test("live and historical projection filters assistant text only without mutating messages", () => {
  const text = "<title>标题</title>\n正文";
  const original = { ...assistant(text), content: [
    { type: "thinking", thinking: text },
    { type: "text", text: "<title>标题" },
    { type: "text", text: "</title>\n正文" },
    { type: "toolCall", id: "call", name: "read", arguments: { path: text } },
  ] };
  const snapshot = structuredClone(original);
  assert.equal(chatMessage(original, "id", true)?.text, "正文");
  assert.equal(chatMessage(original, "id")?.text, "正文");
  assert.equal(chatMessage(original, "id")?.thinking, text);
  assert.match(chatMessage(original, "id")!.calls![0].input, /<title>/);
  assert.deepEqual(original, snapshot);
  for (const role of ["user", "toolResult", "custom", "compactionSummary"])
    assert.equal(chatMessage({ role, display: true, content: text }, "id")?.text, text);
});
