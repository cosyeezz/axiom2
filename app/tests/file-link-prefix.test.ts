import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { DocumentFiles } from "../src/server/document-files.js";
import { Store } from "../src/server/storage.js";
import type { ChatMessage } from "../src/shared/agent.js";
import { hasFileLink, localFileLink, type FilePreview } from "../src/shared/file-preview.js";
import { markdown, markdownTokens } from "../src/shared/markdown.js";
import type { Session, Workspace } from "../src/shared/protocol.js";
import { tmpdir } from "./temporary.js";

test("invisible absolute-link prefixes do not turn local paths into relative paths", () => {
  for (const prefix of ["\u200b", "\u200c", "\ufeff", "\u200b\u200c\ufeff\u200b"]) {
    for (const [href, path] of [
      ["/tmp/latency-findings.md", "/tmp/latency-findings.md"],
      ["/tmp/中文%20文档.md", "/tmp/中文 文档.md"],
      ["C:/notes.md", "C:/notes.md"],
      ["C:\\notes.md", "C:/notes.md"],
      ["file:///tmp/notes.md", "/tmp/notes.md"],
      ["file://localhost/tmp/notes.md", "/tmp/notes.md"],
    ]) assert.deepEqual(localFileLink(prefix + href), { path });
    assert.deepEqual(localFileLink(prefix + "/tmp/notes.md#L4"), { path: "/tmp/notes.md", line: 4 });
    assert.deepEqual(localFileLink(prefix + "file:///C:/notes.md#L8"), { path: "C:/notes.md", line: 8 });
    for (const href of ["//server/share.md", "\\\\server\\share.md", "file://server/share.md", "https://example.com/notes.md", "javascript:alert(1)", "data:text/plain,hi", "#local", "C:/notes.md:stream", "C:relative.md", "/tmp/x%00.md", "\\\\?\\C:\\notes.md", "\\\\.\\pipe\\notes.md"])
      assert.equal(localFileLink(prefix + href), null, JSON.stringify(prefix + href));
  }
  // Do not silently rename legitimate relative paths or characters inside filenames.
  for (const href of ["\u200bnotes.md", "\u200cnotes.md", "\ufeffnotes.md", "./\u200bnotes.md", "./\u200cnotes.md", "/tmp/\u200bnotes.md", "/tmp/\u200cnotes.md", "/tmp/\ufeffnotes.md", "/tmp/notes.md\u200b", "/tmp/notes.md\u200c", "\u200d/tmp/notes.md", "\u2060/tmp/notes.md"])
    assert.deepEqual(localFileLink(href), { path: href });
  assert.deepEqual(localFileLink("%E2%80%8B/tmp/notes.md"), { path: "\u200b/tmp/notes.md" });
  assert.deepEqual(localFileLink("%E2%80%8C/tmp/notes.md"), { path: "\u200c/tmp/notes.md" });
});

test("prefixed Markdown links retain the exact original authorization href", () => {
  const clean = "/tmp/latency-findings.md";
  // Unlike FEFF (Markdown whitespace), these prefixes survive tokenization.
  for (const prefix of ["\u200b", "\u200c"]) {
    const href = prefix + clean, text = `详见[耗时诊断](${href})。`;
    const hrefs: string[] = [];
    markdown.walkTokens(markdownTokens(text), token => { if (token.type === "link") hrefs.push(token.href); });
    assert.deepEqual(hrefs, [href]);
    assert.equal(hasFileLink(text, href), true);
    assert.equal(hasFileLink(text, clean), false);
  }
});

test("document preview reads a prefixed absolute link without widening session authorization", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-link-prefix-"));
  mkdirSync(join(root, "project"));
  const store = new Store(join(root, "data"));
  const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: join(root, "project"), authorized: true } }) as Workspace;
  const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const other = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const path = join(root, "latency-findings.md");
  let message: ChatMessage = { id: "reply", role: "assistant", text: "" };
  const files = new DocumentFiles(store, (owner, id) => owner.sessionId === session.id && id === message.id ? message : null);
  const read = (href: string, sessionId = session.id) => files.command({ requestId: randomUUID(), ...scope, sessionId, op: "files.document", params: { messageId: message.id, href } }) as Promise<FilePreview>;
  try {
    writeFileSync(path, "# 耗时诊断\n\n中文正文正常。\n");
    const paths = process.platform === "darwin" && path.startsWith("/private/tmp/") ? [path, path.replace(/^\/private/, "")] : [path];
    for (const linkedPath of paths) for (const prefix of ["\u200b", "\u200c"]) {
      const href = prefix + linkedPath;
      message = { ...message, role: "assistant", text: `详见[耗时诊断](${href})。` };
      const file = await read(href);
      assert.equal(file.kind, "markdown"); assert.equal(file.path, path);
      assert.equal(file.text, "# 耗时诊断\n\n中文正文正常。\n");
      await assert.rejects(read(linkedPath), { code: "FILE_PREVIEW_FORBIDDEN" });
      await assert.rejects(read(href, other.id), { code: "FILE_PREVIEW_FORBIDDEN" });
      message.role = "user";
      await assert.rejects(read(href), { code: "FILE_PREVIEW_FORBIDDEN" });
    }
    // A real zero-width character in a filename is not stripped.
    for (const prefix of ["\u200b", "\u200c"]) {
      const literal = join(root, prefix + "notes.md");
      writeFileSync(literal, "# Literal filename");
      message = { ...message, role: "assistant", text: `[文件](${literal})` };
      assert.equal((await read(literal)).text, "# Literal filename");
    }
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
