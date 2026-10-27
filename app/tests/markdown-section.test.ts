import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync, linkSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { tmpdir } from "./temporary.js";
import { localFileLink, hasFileLink, type FilePreview } from "../src/shared/file-preview.js";
import { markdownSection } from "../src/shared/markdown-section.js";
import { Markdown } from "../src/client/chat/Markdown.js";
import { DocumentFiles } from "../src/server/document-files.js";
import { Store } from "../src/server/storage.js";
import type { ChatMessage } from "../src/shared/agent.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

test("local chapter fragments split before decoding, preserve line links and reject unsafe paths", () => {
  for (const href of ["docs/design.md#10-工具定义提示词定稿", "docs/design.md#10-%E5%B7%A5%E5%85%B7%E5%AE%9A%E4%B9%89%E6%8F%90%E7%A4%BA%E8%AF%8D%E5%AE%9A%E7%A8%BF"])
    assert.deepEqual(localFileLink(href), { path: "docs/design.md", fragment: "10-工具定义提示词定稿" });
  assert.deepEqual(localFileLink("file://localhost/tmp/a%23b.md#hello"), { path: "/tmp/a#b.md", fragment: "hello" });
  assert.deepEqual(localFileLink("a%2523b.md#hello"), { path: "a%23b.md", fragment: "hello" });
  assert.deepEqual(localFileLink("a.md#"), { path: "a.md" });
  assert.deepEqual(localFileLink("a.md#L12C3"), { path: "a.md", line: 12 });
  assert.deepEqual(localFileLink("a.md:12#hello"), { path: "a.md", line: 12, fragment: "hello" });
  assert.deepEqual(localFileLink("a.md#hello:12"), { path: "a.md", fragment: "hello:12" });
  assert.deepEqual(localFileLink("\u200b/tmp/a.md#hello"), { path: "/tmp/a.md", fragment: "hello" });
  for (const href of ["#hello", "https://example.com/a.md#hello", "javascript:alert(1)#hello", "//server/a.md#hello", "file://server/a.md#hello", "a.md?query#hello", "a.md#%ZZ", "a.md#%00", "a.md#%0a", "a%00.md#hello", "C:/a.md:stream#hello"])
    assert.equal(localFileLink(href), null, href);
});

const source = "# 全文标题\n\n前文不能丢。\n\n## 10. 工具定义提示词定稿\n\n目标章节 **正文** [外链][ref]，脚注[^note]。\n\n### 10.1 子章节\n\n子章节正文\n\n```md\n## 假标题\n```\n\n## 11. 下一章节\n\n后文也不能丢。\n\n[ref]: https://example.com/reference\n[^note]: 末尾定义的脚注。\n";
test("chapter boundaries include children, ignore fenced headings, preserve original source lines", () => {
  const section = markdownSection(source, "10-工具定义提示词定稿")!;
  assert.ok(section); assert.equal(section.title, "10. 工具定义提示词定稿");
  assert.equal(section.startLine, 5); assert.equal(section.endLine, 15);
  assert.ok(section.text.startsWith("## 10.")); assert.ok(section.text.includes("子章节正文")); assert.ok(section.text.includes("## 假标题"));
  assert.ok(!section.text.includes("全文标题")); assert.ok(!section.text.includes("下一章节"));
  assert.deepEqual(markdownSection(source.replace(/\n/g, "\r\n"), "10-工具定义提示词定稿"), section);
  assert.equal(markdownSection(source, "假标题"), null); assert.equal(markdownSection(source, "missing"), null);
  const html = renderToStaticMarkup(createElement(Markdown, { text: source, blockRange: section.blocks }));
  assert.ok(html.includes("子章节正文")); assert.ok(html.includes('href="https://example.com/reference"'));
  assert.ok(html.includes("末尾定义的脚注。")); assert.ok(!html.includes("后文也不能丢")); assert.ok(!html.includes("全文标题"));
});
test("heading slugs handle Unicode, inline markup, Setext, repeats and explicit suffix collisions", () => {
  const text = "# **Hello** `World` [Link](https://example.com)!\n\na\n\n# Hello World Link!\n\nb\n\n# Hello World Link-1\n\nc\n\n中文标题\n========\n\nd\n\n## e\u0301 与_下划线\n\ne\n\n> # 引用标题\n";
  assert.equal(markdownSection(text, "hello-world-link")?.text.split("\n").at(-1), "a");
  assert.equal(markdownSection(text, "hello-world-link-1")?.text.split("\n").at(-1), "b");
  assert.equal(markdownSection(text, "hello-world-link-1-1")?.text.split("\n").at(-1), "c");
  assert.equal(markdownSection(text, "中文标题")?.title, "中文标题");
  assert.equal(markdownSection(text, "e\u0301-与_下划线")?.title, "e\u0301 与_下划线");
  assert.equal(markdownSection(text, "引用标题"), null);
});

test("heading entities are decoded once in prose, never in inline code", () => {
  const text = "# A &amp; B\n\nfirst\n\n# &#20013;&#x6587; &eacute;\n\nsecond\n\n# Literal `&amp;`\n\nthird\n\n# &amp;copy;\n\nfourth\n";
  assert.equal(markdownSection(text, "a--b")?.title, "A & B");
  assert.equal(markdownSection(text, "中文-é")?.title, "中文 é");
  assert.equal(markdownSection(text, "literal-amp")?.title, "Literal &amp;");
  assert.equal(markdownSection(text, "copy")?.title, "&copy;");
});
test("section footnotes retain transitive external definitions and terminate cycles", () => {
  const text = "# Target\n\ntext[^a]\n\n# Other\n\nother[^unused]\n\n[^a]: 第一脚注 see [^b]\n[^b]: 第二脚注 back [^a]\n[^unused]: 不属于本章节的脚注\n";
  const section = markdownSection(text, "target")!;
  const html = renderToStaticMarkup(createElement(Markdown, { text, blockRange: section.blocks }));
  assert.ok(html.includes("第一脚注")); assert.ok(html.includes("第二脚注"));
  assert.ok(!html.includes("不属于本章节的脚注")); assert.ok(!html.includes("[^b]"));
  assert.equal((html.match(/id="[^"]*-note-\d+"/g) ?? []).length, 2);
});

test("chapter reads, reveal and save keep exact original href authorization and full file revisions", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-chapter-")), project = join(root, "project"); mkdirSync(project);
  const store = new Store(join(root, "data"));
  const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const other = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id }, href = "a%23b.md#10-工具定义提示词定稿", path = join(project, "a#b.md");
  let message: ChatMessage = { id: "reply", role: "assistant", text: `[章节](${href})` };
  const revealed: string[] = [];
  const files = new DocumentFiles(store, (owner, id) => owner.sessionId === session.id && id === message.id ? message : null, async path => { revealed.push(path); });
  const call = (ref = href, op = "files.document", extra = {}, sessionId = session.id) => files.command({ requestId: randomUUID(), ...scope, sessionId, op, params: { messageId: "reply", href: ref, ...extra } });
  try {
    writeFileSync(path, source);
    assert.equal(hasFileLink(message.text, href), true);
    const file = await call() as FilePreview;
    assert.equal(file.kind, "markdown"); assert.equal(file.text, source); assert.equal(file.path, path);
    for (const ref of ["a%23b.md", "a%23b.md#11-下一章节", "a%23b.md#10-%E5%B7%A5%E5%85%B7%E5%AE%9A%E4%B9%89%E6%8F%90%E7%A4%BA%E8%AF%8D%E5%AE%9A%E7%A8%BF"])
      await assert.rejects(call(ref), { code: "FILE_PREVIEW_FORBIDDEN" });
    await assert.rejects(call(href, "files.document", {}, other.id), { code: "FILE_PREVIEW_FORBIDDEN" });
    message.role = "user"; await assert.rejects(call(), { code: "FILE_PREVIEW_FORBIDDEN" }); message.role = "assistant";
    await call(href, "files.reveal"); assert.deepEqual(revealed, [path]);
    const edited = source.replace("目标章节", "已编辑章节");
    await call(href, "files.save", { revision: file.revision, text: edited });
    assert.equal(readFileSync(path, "utf8"), edited);
    assert.ok(edited.includes("前文不能丢")); assert.ok(edited.includes("后文也不能丢"));
    await assert.rejects(call(href, "files.save", { revision: file.revision, text: "stale" }), { code: "REVISION_CONFLICT" });
    for (const [name, create] of [["symbolic.md", symlinkSync], ["hard.md", linkSync]] as const) {
      create(path, join(project, name)); message = { ...message, text: `[章节](${name}#hello)` };
      await assert.rejects(call(`${name}#hello`), { code: "FILE_PREVIEW_FORBIDDEN" });
    }
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
