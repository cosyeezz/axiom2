import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { tmpdir } from "./temporary.js";
import { previewArchive } from "../src/server/preview-archive.js";
import { mediaMime, officePreview } from "../src/server/preview-formats.js";
import { Store } from "../src/server/storage.js";
import { DocumentFiles } from "../src/server/document-files.js";
import type { Session, Workspace } from "../src/shared/protocol.js";
import type { FilePreview } from "../src/shared/file-preview.js";
import { fixtureZip, wordFixture, sheetFixture, slidesFixture, wavFixture } from "./preview-fixtures.js";

test("ZIP members are listed, selectively expanded, CRC checked and never written", async () => {
  const zip = fixtureZip({ "folder/hello.txt": "hello", "readme.md": "# read" });
  const listed = await previewArchive(zip, "files.zip"); assert.equal(listed.entries.length, 2); assert.equal(listed.contents.size, 0);
  assert.equal((await previewArchive(zip, "files.zip", name => name.endsWith("hello.txt"))).contents.get("folder/hello.txt")?.toString(), "hello");
  for (const path of ["../escape", "/absolute", "folder/../escape", "C:/disk"]) await assert.rejects(previewArchive(fixtureZip({ [path]: "bad" }), "a.zip"));
  await assert.rejects(previewArchive(fixtureZip({ link: "target" }, 0o120777), "a.zip"), /特殊成员/);
  const corrupt = Buffer.from(zip); corrupt[30 + Buffer.byteLength("folder/hello.txt")] ^= 1;
  await assert.rejects(previewArchive(corrupt, "a.zip", () => true), /校验/);
  await assert.rejects(previewArchive(fixtureZip({ large: Buffer.alloc(8 * 1024 * 1024 + 1) }), "a.zip", () => true), /8 MiB/);
  const abort = new AbortController(); abort.abort(); await assert.rejects(previewArchive(zip, "a.zip", () => true, abort.signal));
});
test("gzip member preview and archive output budget", async () => {
  const result = await previewArchive(gzipSync("hello"), "note.txt.gz", () => true);
  assert.equal(result.contents.get("note.txt")?.toString(), "hello");
  await assert.rejects(previewArchive(fixtureZip(Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`file${i}`, ""]))), "a.zip"), /2000/);
});
test("gzip aborts during expansion and TAR rejects truncated, linked or unsafe members", async () => {
  const bytes = gzipSync(Buffer.alloc(64 * 1024 * 1024));
  const controller = new AbortController();
  const promise = previewArchive(bytes, "large.gz", () => false, controller.signal);
  const timer = setTimeout(() => controller.abort(), 1);
  try { await assert.rejects(promise, /取消|abort/i); } finally { clearTimeout(timer); }
  const tar = (name: string, type = "0", body = "hello") => {
    const header = Buffer.alloc(512); header.write(name, 0); header.write("0000644\0", 100); header.write(body.length.toString(8).padStart(11, "0") + "\0", 124); header.write(type, 156); header.write("ustar\0", 257);
    header.fill(32, 148, 156); header.write([...header].reduce((sum, b) => sum + b, 0).toString(8).padStart(6, "0") + "\0 ", 148);
    return Buffer.concat([header, Buffer.from(body), Buffer.alloc((512 - body.length % 512) % 512 + 1024)]);
  };
  const valid = tar("note.txt"); assert.equal((await previewArchive(valid, "a.tar", () => true)).contents.get("note.txt")?.toString(), "hello");
  assert.equal((await previewArchive(gzipSync(valid), "a.tgz", () => true)).entries.length, 1);
  for (const bytes of [Buffer.from("bad"), valid.subarray(0, 600), tar("../outside"), tar("link", "2")]) await assert.rejects(previewArchive(bytes, "a.tar"));
});
test("OOXML selects bounded parts and rejects entity declarations/malformed packages", async () => {
  for (const [name, bytes, main] of [["a.docx", wordFixture(), "word/document.xml"], ["a.xlsx", sheetFixture(), "xl/workbook.xml"], ["a.pptx", slidesFixture(), "ppt/presentation.xml"]] as const) {
    const result = await officePreview(bytes, name, AbortSignal.timeout(5000)); assert.equal(result.kind, "office"); assert.ok(result.officeParts?.some(part => part.name === main));
  }
  await assert.rejects(officePreview(fixtureZip({ "word/document.xml": '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>' }), "a.docx", AbortSignal.timeout(5000)), /实体/);
  await assert.rejects(officePreview(fixtureZip({ "other.xml": "<a/>" }), "a.xlsx", AbortSignal.timeout(5000)), /主体/);
  await assert.rejects(officePreview(fixtureZip({ "word/document.xml": "x".repeat(2 * 1024 * 1024 + 1) }), "a.docx", AbortSignal.timeout(5000)), /XML/);
});
test("audio/video signatures match declared extensions", () => {
  assert.equal(mediaMime(wavFixture(), "a.wav")?.mimeType, "audio/wav");
  assert.equal(mediaMime(Buffer.from("ID3example"), "a.mp3")?.kind, "audio");
  assert.equal(mediaMime(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), "a.webm")?.kind, "video");
  assert.equal(mediaMime(Buffer.from("not media"), "a.mp4"), null);
  assert.equal(mediaMime(wavFixture(), "a.mp3"), null);
});
test("document dispatch reauthorizes archive members, binds revisions and forbids saving", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-rich-preview-")), project = join(root, "project"); mkdirSync(project);
  const store = new Store(join(root, "data"));
  const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  let allowed = true;
  const files = new DocumentFiles(store, () => allowed ? { id: "reply", role: "assistant", text: "[zip](a.zip) [word](a.docx) [audio](a.wav)" } : null);
  const read = (href: string, extra = {}) => files.command({ requestId: randomUUID(), op: "files.document", ...scope, params: { messageId: "reply", href, ...extra } }) as Promise<FilePreview>;
  try {
    writeFileSync(join(project, "a.zip"), fixtureZip({ "note.txt": "archive text" })); writeFileSync(join(project, "a.docx"), wordFixture()); writeFileSync(join(project, "a.wav"), wavFixture());
    const archive = await read("a.zip"); assert.equal(archive.kind, "archive");
    const params = { entry: "note.txt", archiveRevision: archive.revision };
    const member = await read("a.zip", params); assert.equal(member.text, "archive text"); assert.equal(member.editable, false);
    assert.equal((await read("a.docx")).kind, "office"); assert.equal((await read("a.wav")).kind, "audio");
    await assert.rejects(read("a.zip", { entry: "note.txt" }), { code: "INVALID_INPUT" });
    allowed = false; await assert.rejects(read("a.zip", params), { code: "FILE_PREVIEW_FORBIDDEN" }); allowed = true;
    writeFileSync(join(project, "a.zip"), fixtureZip({ "note.txt": "changed" }));
    await assert.rejects(read("a.zip", params), { code: "REVISION_CONFLICT" });
    await assert.rejects(files.command({ requestId: randomUUID(), op: "files.save", ...scope, params: { messageId: "reply", href: "a.zip", ...params, revision: archive.revision, text: "overwrite" } }), { code: "INVALID_INPUT" });
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
