import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../src/client/chat/Markdown.js";

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));
const strong = (text: string) => `<strong><span>${text}</span></strong>`;

test("Chinese bold labels render without a space before the following text", () => {
  for (const text of ["**验证：**43 项相关测试、25 项 Steering 浏览器检查通过", "**验证：**通过", "**验证：**passed"]) {
    const html = render(text);
    assert.ok(html.includes(strong("验证：")), html);
    assert.ok(!html.includes("**"));
  }
  for (const label of ["“完成”", "（完成）", "【完成】", "完成。", "完成！", "完成；"]) {
    assert.ok(render(`**${label}**继续`).includes(strong(label)), label);
  }
});

test("Chinese bold works inside lists, quotes, tables, links and nested emphasis", () => {
  for (const text of ["- **验证：**43 项", "> **验证：**43 项", "| 结果 |\n| --- |\n| **验证：**43 项 |", "[**验证：**43 项](https://example.com)"]) {
    assert.ok(render(text).includes(strong("验证：")), text);
  }
  const html = render("**检查 *嵌套* 和 `code`：**通过");
  assert.match(html, /<strong>.*<em>.*嵌套.*<\/em>.*<code>code<\/code>.*：.*<\/strong>/);
});

test("normal Markdown emphasis and ASCII punctuation retain their rules", () => {
  assert.ok(render("**验证**：43 项").includes(strong("验证")));
  assert.ok(render("**验证：** 43 项").includes(strong("验证：")));
  assert.ok(render("**bold** and __bold__").includes(strong("bold")));
  assert.ok(!render("**label:**43").includes("<strong>"));
  assert.match(render("*斜体* ~~删除~~"), /<em>.*斜体.*<\/em>.*<del>.*删除.*<\/del>/);
});

test("code, escaped delimiters and unmatched streaming prefixes stay literal", () => {
  const source = "**验证：**43";
  assert.equal(render(`\`${source}\``), `<p><code>${source}</code></p>`);
  const code = render(`\`\`\`text\n${source}\n\`\`\``);
  assert.ok(code.includes(`<pre><code>${source}</code></pre>`));
  assert.ok(!code.includes("<strong>"));
  for (const text of ["\\*\\*验证：\\*\\*43", "**验证：", "**验证：\\**43"]) {
    assert.ok(!render(text).includes("<strong>"), text);
  }
  assert.ok(render(source).includes(strong("验证：")), "completed streaming text is reparsed");
});

test("mask preserves punctuation, whitespace, escapes and adjacent bold spans", () => {
  const html = render("**验证：**43 **结果：**通过");
  assert.equal(html, `<p>${strong("验证：")}<span>43 </span>${strong("结果：")}<span>通过</span></p>`);
  assert.ok(render("**检查 `：**` 内容：**继续").includes("<code>：**</code>"));
});

test("HTML stays literal and unsafe links/images remain inert", () => {
  const html = render('**验证：**43 <script>alert(1)</script> [危险](javascript:alert%281%29) ![远程](https://example.com/a.png)');
  assert.ok(html.includes(strong("验证：")));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!/<script|<img|<a\s/.test(html));
});
