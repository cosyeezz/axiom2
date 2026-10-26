import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, linkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "./temporary.js";
import { Store } from "../src/server/storage.js";
import { DocumentFiles, decodeFileText } from "../src/server/document-files.js";
import { hasFileLink, localFileLink, type FilePreview } from "../src/shared/file-preview.js";
import { htmlResourceLinks, htmlResourceTags } from "../src/shared/html-preview.js";
import type { ChatMessage } from "../src/shared/agent.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

test("file links preserve Windows, POSIX, Unicode, escaped spaces and line references; reject remote/device/HTML/code", () => {
  assert.deepEqual(localFileLink("F:/项目/说明.md:12"), { path: "F:/项目/说明.md", line: 12 });
  assert.deepEqual(localFileLink("/tmp/my%20file.md#L4"), { path: "/tmp/my file.md", line: 4 });
  assert.deepEqual(localFileLink("./spec%231.md"), { path: "./spec#1.md" });
  assert.equal(localFileLink("./spec%3A12"), null); // Never reinterpret an encoded filename as a line selector / Windows ADS.
  assert.deepEqual(localFileLink("example.ts:12"), { path: "example.ts", line: 12 });
  assert.deepEqual(localFileLink("./README:4"), { path: "./README", line: 4 });
  assert.deepEqual(localFileLink("file:///C:/notes.md#L8"), { path: "C:/notes.md", line: 8 });
  assert.deepEqual(localFileLink("file:///C:/notes.md"), { path: "C:/notes.md" });
  for (const href of ["https://example.com/a.md", "javascript:alert(1)", "data:text/plain,hi", "//server/a.md", "\\\\server\\a.md", "#local", "file://server/a.md", "C:/a.md:stream", "x%00.md"]) assert.equal(localFileLink(href), null, href);
  const href = "./文档.md";
  assert.equal(hasFileLink(`[文档](${href})`, href), true);
  assert.equal(hasFileLink(`\`[文档](${href})\``, href), false);
  assert.equal(hasFileLink(`~~~md\n[文档](${href})\n~~~`, href), false);
  assert.equal(hasFileLink(`<a href="${href}">文档</a>`, href), false);
});
test("file decoding handles UTF8/BOM/UTF16 and Chinese legacy encoding, rejects binary", () => {
  assert.equal(decodeFileText(Buffer.from("中文正文"))?.text, "中文正文");
  assert.equal(decodeFileText(Buffer.from("\ufeff中文"))?.text, "中文");
  assert.equal(decodeFileText(Buffer.concat([Buffer.from([255,254]), Buffer.from("中文", "utf16le")]))?.text, "中文");
  assert.equal(decodeFileText(Buffer.from([254,255,0x4e,0x2d,0x65,0x87]))?.text, "中文");
  assert.equal(decodeFileText(Buffer.from([0xd6,0xd0,0xce,0xc4]))?.text, "中文");
  assert.equal(decodeFileText(Buffer.from([0,1,2,3,4])), null);
});
test("document preview is tied to actual assistant link and session, bounded, read-only, with scoped reveal", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-document-")), project = join(root, "project"); mkdirSync(project);
  const store = new Store(join(root, "data"));
  const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  let message = { id: "reply", role: "assistant", text: "" } as ChatMessage;
  const revealed: string[] = [];
  const files = new DocumentFiles(store, (owner, id) => owner.sessionId === scope.sessionId && id === message.id ? message : null, async path => { revealed.push(path); });
  const call = (href: string, op = "files.document", override = {}) => files.command({ requestId: randomUUID(), ...scope, op, params: { messageId: "reply", href }, ...override });
  const link = (href: string) => { message = { ...message, role: "assistant", text: `[打开](<${href}>)` }; };
  try {
    const href = "./说明 文档.md:2", path = join(project, "说明 文档.md");
    writeFileSync(path, "# 说明\n\n中文内容 **正常**"); link(href);
    const data = await call(href) as FilePreview;
    assert.equal(data.kind, "markdown"); assert.equal(data.line, 2); assert.equal(data.text, "# 说明\n\n中文内容 **正常**");
    await call(href, "files.reveal"); assert.deepEqual(revealed, [path]);
    await assert.rejects(call("./other.md"), { code: "FILE_PREVIEW_FORBIDDEN" });
    await assert.rejects(call(href, "files.document", { params: { href, messageId: "reply", path } }), { code: "INVALID_INPUT" });
    const second = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    await assert.rejects(call(href, "files.document", { sessionId: second.id }), { code: "FILE_PREVIEW_FORBIDDEN" });
    message.role = "user"; await assert.rejects(call(href), { code: "FILE_PREVIEW_FORBIDDEN" });
    link(href); store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id=?").run(scope.workspaceId);
    await assert.rejects(call(href), { code: "AUTHORIZATION_REQUIRED" });
    store.db.prepare("UPDATE workspaces SET authorized=1 WHERE id=?").run(scope.workspaceId);
    for (const [name, content, expected] of [
      ["code.ts", "const greeting = '你好';", "code"], ["empty.txt", "", "text"], ["safe.html", "<script>alert(1)</script>", "code"],
      ["archive.zip", "PK123", "unsupported"], ["raw.bin", Buffer.from([0,1,2]), "unsupported"],
      ["huge.txt", Buffer.alloc(1024 * 1024 + 1, 65), "unsupported"], ["fake.png", "not image", "unsupported"],
      ["real.pdf", "%PDF-1.7\n", "pdf"],
    ] as const) {
      writeFileSync(join(project, name), content); link(name); assert.equal((await call(name) as FilePreview).kind, expected);
    }
    writeFileSync(join(project, "spec#1.md"), "# 编码文件名"); link("spec%231.md");
    assert.equal((await call("spec%231.md") as FilePreview).text, "# 编码文件名");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=", "base64");
    writeFileSync(join(project, "picture.png"), png); link("picture.png");
    assert.equal((await call("picture.png") as FilePreview).data, png.toString("base64"));
    link("missing.md"); await assert.rejects(call("missing.md"), { code: "FILE_READ_FAILED" });
    linkSync(path, join(project, "hardlink.md")); link("hardlink.md");
    await assert.rejects(call("hardlink.md"), { code: "FILE_PREVIEW_FORBIDDEN" });
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM runs").get()!.n, 0);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM external_requests").get()!.n, 0);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("HTML resource scanning skips inert text and preserves source positions", () => {
  const fake = `<link rel='stylesheet' href='fake.css'>`;
  const html = `<!--${fake}--><script>const fragment = "${fake}";</script><textarea>${fake}</textarea><title>${fake}</title><style>${fake}</style><template>${fake}</template><div data-example="${fake}"></div><link rel="stylesheet" href="p&#97;ge.css?a=1&amp;b=2"><script defer src='page.js'></script>`;
  assert.deepEqual(htmlResourceLinks(html), [{ href: "page.css?a=1&b=2", kind: "style" }, { href: "page.js", kind: "script" }]);
  assert.deepEqual(htmlResourceTags(html).map(tag => html.slice(tag.start, tag.end)), ['href="p&#97;ge.css?a=1&amp;b=2"', "src='page.js'"]);
});

test("HTML companion resources stay bounded and inside the linked document directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-html-resources-")), project = join(root, "project"); mkdirSync(project);
  const store = new Store(join(root, "data"));
  const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  let message: ChatMessage = { id: "html", role: "assistant", text: "[页面](page.html)" };
  const files = new DocumentFiles(store, () => message);
  const read = () => files.command({ requestId: randomUUID(), workspaceId: workspace.id, sessionId: session.id, op: "files.document", params: { messageId: "html", href: "page.html" } }) as Promise<FilePreview>;
  try {
    writeFileSync(join(project, "页面.css"), "body { color: red }");
    writeFileSync(join(project, "page.js"), "document.body.dataset.ready = 'true';");
    writeFileSync(join(root, "outside.css"), "secret");
    writeFileSync(join(project, ".secret.css"), "secret");
    linkSync(join(root, "outside.css"), join(project, "hardlink.css"));
    writeFileSync(join(project, "huge.css"), "x".repeat(1024 * 1024 + 1));
    writeFileSync(join(project, "bad.css"), Buffer.from([0xff, 0xff]));
    writeFileSync(join(project, "page.html"), `<link rel="stylesheet" href="%E9%A1%B5%E9%9D%A2.css?v=1&amp;mode=2"><script defer src="p&#97;ge.js"></script>` +
      ["../outside.css", "%2e%2e/outside.css", "&#46;&#46;/outside.css", "&#47;outside.css", ".secret.css", "hardlink.css", "huge.css", "bad.css", "https://example.com/a.css", "/outside.css", "missing.css"].map(href => `<link rel="stylesheet" href="${href}">`).join(""));
    const result = await read();
    assert.equal(result.kind, "code");
    assert.deepEqual(result.resources?.map(resource => [resource.kind, resource.text]), [["style", "body { color: red }"], ["script", "document.body.dataset.ready = 'true';"]]);
    // Encoded aliases are decoded before deduplication and path validation.
    assert.match(result.resourceNotice!, /^9 个/);
    // The auxiliary file remains unavailable as a standalone document link.
    await assert.rejects(files.command({ requestId: randomUUID(), workspaceId: workspace.id, sessionId: session.id, op: "files.document", params: { messageId: "html", href: "page.js" } }), { code: "FILE_PREVIEW_FORBIDDEN" });
    writeFileSync(join(project, "page.html"), Array.from({ length: 18 }, (_, i) => `<link rel="stylesheet" href="tiny${i}.css">`).join(""));
    for (let i = 0; i < 18; i++) writeFileSync(join(project, `tiny${i}.css`), "body{}");
    assert.equal((await read()).resources?.length, 16);
    message = { ...message, role: "user" };
    await assert.rejects(read(), { code: "FILE_PREVIEW_FORBIDDEN" });
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
