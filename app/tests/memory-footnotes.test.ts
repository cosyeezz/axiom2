import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../src/client/chat/Markdown.js";
import { markdownLocalLinks } from "../src/shared/markdown.js";
import { hasFileLink } from "../src/shared/file-preview.js";
import { memoryExcerpt, parseMemory } from "../src/shared/memory.js";
import { referencedPaths } from "../src/server/memory-files.js";
import { resolve } from "node:path";

const source = `## 目标与范围
完成迁移并核对结果。[^report]

## 任务进度
整体状态：已完成
整体进度：100%
当前进展：验证完成。[^report]
- [已完成] 迁移并验证[^report]

[^report]: [验证报告](<references/验证 报告.md>)
    - [未开始] 引用中的旧任务示例
    整体状态：阻塞
    整体进度：约 10%
`;

test("footnote metadata and reference markers never become progress fields, tasks or excerpts", () => {
  const progress = parseMemory(source);
  assert.equal(progress.goal, "完成迁移并核对结果。");
  assert.equal(progress.state, "已完成"); assert.equal(progress.percent, 100);
  assert.deepEqual(progress.tasks, [{ title: "迁移并验证", state: "已完成" }]);
  assert.equal(memoryExcerpt(source), "完成迁移并核对结果。");
  assert.equal(parseMemory("## 目标与范围\n目标\n\n[^fake]: ignored\n    ## 任务进度\n    - [进行中] 不是真实任务").tasks.length, 0);
});

test("footnote links share the same parser for displayed navigation and external read authorization", () => {
  assert.deepEqual(markdownLocalLinks(source), [{ href: "references/验证 报告.md", label: "验证报告" }]);
  assert.deepEqual(referencedPaths(resolve("MEMORY.md"), source), [resolve("references/验证 报告.md")]);
  const code = "`[忽略](secret.md)`\n\n```md\n[^code]: [忽略](private.md)\n```\n\n<!-- [忽略](hidden.md) -->\n";
  assert.deepEqual(markdownLocalLinks(code), []);
  assert.deepEqual(referencedPaths(resolve("MEMORY.md"), code), []);
  assert.deepEqual(markdownLocalLinks("事实[^id]\n\n[^id]: [来源][file]\n\n[file]: references/source.md"), [{ href: "references/source.md", label: "来源" }]);
  const duplicate = "正文[^x]\n\n[^x]: [第一](references/first.md)\n\n[^x]: [隐藏](references/hidden.md)";
  assert.deepEqual(markdownLocalLinks(duplicate), [{ href: "references/first.md", label: "第一" }]);
  assert.deepEqual(referencedPaths(resolve("MEMORY.md"), duplicate), [resolve("references/first.md")]);
  assert.equal(hasFileLink(duplicate, "references/hidden.md"), false);
  const rendered = renderToStaticMarkup(createElement(Markdown, { text: "正文[^x]\n\n[^x]: [来源](references/a%20b.md#details)", onLocalLink: () => {} }));
  assert.ok(rendered.includes('href="references/a%20b.md#details"'), "memory links with fragments remain navigable");
});

test("footnotes render safe reference and return links, with unique IDs across repeated references and documents", () => {
  const html = renderToStaticMarkup(createElement(Fragment, null,
    createElement(Markdown, { text: source }), createElement(Markdown, { text: source })));
  assert.equal((html.match(/aria-label="查看引用 1"/g) ?? []).length, 6);
  assert.equal((html.match(/aria-label="返回引用 1"/g) ?? []).length, 2);
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  const unsafe = renderToStaticMarkup(createElement(Markdown, { text: "正文[^x]\n\n[^x]: <script>alert(1)</script> [危险](javascript:alert%281%29)" }));
  assert.ok(!unsafe.includes("<script>")); assert.ok(!unsafe.includes('href="javascript:'));
});

test("code, escaped references and incomplete definitions remain literal while definitions can arrive on a later page", () => {
  const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));
  for (const text of ["正文[^pending]", "`[^code]`\n\n[^code]: code", "\\[^escape]\n\n[^escape]: escaped"]) assert.ok(!render(text).includes('aria-label="查看引用'));
  assert.ok(render("正文[^pending]\n\n[^pending]: 后续页的资料").includes('aria-label="查看引用 1"'));
  const compact = renderToStaticMarkup(createElement(Markdown, { text: source, compact: true }));
  assert.ok(!/<a\s|<section\s/.test(compact));
});
