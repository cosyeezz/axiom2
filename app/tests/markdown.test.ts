import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../src/client/chat/Markdown.js";

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));
const strong = (text: string) => `<strong><span>${text}</span></strong>`;

test("single input newlines stay visible alongside Markdown formatting", () => {
  for (const newline of ["\n", "\r\n"]) {
    const html = render(`第一行${newline}**第二行**${newline}第三行`);
    assert.equal(html, `<p><span>第一行</span><br/>${strong("第二行")}<br/><span>第三行</span></p>`);
  }
  assert.equal(render("第一段\n\n第二段"), "<p><span>第一段</span></p><p><span>第二段</span></p>");
  for (const source of ["- 第一行\n  第二行\n- 下一项", "> 第一行\n> 第二行"]) {
    assert.match(render(source), /第一行<\/span><br\/><span>第二行/);
  }
  const code = render("```text\n第一行\n第二行\n```");
  assert.ok(code.includes("<pre><code>第一行\n第二行</code></pre>"));
  assert.ok(!code.includes("<br"));
  const compact = renderToStaticMarkup(createElement(Markdown, { text: "第一行\n第二行", compact: true }));
  assert.ok(!compact.includes("<br"), "collapsed summaries stay on one line");
});

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

test("Chinese quoted bold renders next to prose on both sides", () => {
  const quote = "“整理索引时检查冲突，核实后修正或删除；用户明确否定的内容直接删除”";
  assert.equal(render(`可以，简化为**${quote}**就够了。`),
    `<p><span>可以，简化为</span>${strong(quote)}<span>就够了。</span></p>`);
  for (const label of ["“完成”", "‘完成’", "（完成）", "【完成】", "《完成》", "「完成」", "『完成』", "〔完成〕", "〈完成〉", "〖完成〗", "〘完成〙", "〚完成〛"]) {
    for (const prefix of ["中文", "text", "", "🙂"]) {
      assert.ok(render(`${prefix}**${label}**继续`).includes(strong(label)), `${prefix}${label}`);
    }
  }
  assert.equal(render("先**“检查”**再**“删除”**完成"),
    `<p><span>先</span>${strong("“检查”")}<span>再</span>${strong("“删除”")}<span>完成</span></p>`);
  assert.match(render("改为**“检查 *嵌套* 和 `code`”**继续"),
    /<strong>.*“检查.*<em>.*嵌套.*<\/em>.*<code>code<\/code>.*”.*<\/strong>/);
  for (const text of ["- 改为**“完成”**继续", "> 改为**“完成”**继续", "| 结果 |\n| --- |\n| 改为**“完成”**继续 |", "[改为**“完成”**继续](https://example.com)"]) {
    assert.ok(render(text).includes(strong("“完成”")), text);
  }
});

test("normal Markdown emphasis and ASCII punctuation retain their rules", () => {
  assert.ok(render("**验证**：43 项").includes(strong("验证")));
  assert.ok(render("**验证：** 43 项").includes(strong("验证：")));
  assert.ok(render("**bold** and __bold__").includes(strong("bold")));
  assert.ok(!render("**label:**43").includes("<strong>"));
  assert.ok(!render('text**"quoted"**more').includes("<strong>"));
  assert.ok(!render("改为*“斜体”*继续").includes("<em>"));
  assert.ok(!render("改为__“加粗”__继续").includes("<strong>"));
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

test("quoted bold keeps code, escaped delimiters and streaming prefixes literal", () => {
  const source = "改为**“完成”**继续";
  assert.equal(render(`\`${source}\``), `<p><code>${source}</code></p>`);
  assert.ok(render(`\`\`\`text\n${source}\n\`\`\``).includes(`<pre><code>${source}</code></pre>`));
  for (const text of ["改为\\*\\*“完成”\\*\\*继续", "改为**“完成", "改为**“完成”*", "改为**“完成”\\**继续"]) {
    assert.ok(!render(text).includes("<strong>"), text);
  }
  assert.ok(render(source).includes(strong("“完成”")));
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
