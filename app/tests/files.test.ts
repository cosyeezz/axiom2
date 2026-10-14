import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";
import { startServer } from "../src/server/index.js";
import { findFd } from "../src/server/files.js";
import { imagesInput, imagePayloadLimit } from "../src/server/images.js";
import { attachmentInput, attachmentName, attachmentsInput, attachmentPrompt, type Workspace, type Session } from "../src/shared/protocol.js";

test("file validation: arbitrary UTF-8 names, relative folder paths, combined count and UTF-8 byte limits", () => {
  assert.equal(attachmentName("folder\\nested\\无扩展"), "folder/nested/无扩展");
  assert.deepEqual(attachmentInput({ name: "folder/source.rs", text: "中文😀" }), { name: "folder/source.rs", text: "中文😀" });
  for (const name of ["/absolute", "C:\\test", "../escape", "a/../b", "a//b", "a/./b", "a\n", "a".repeat(1025)])
    assert.throws(() => attachmentName(name), { code: "INVALID_ATTACHMENT" });
  for (const text of ["binary\0", "\uD800", "中".repeat(33334)])
    assert.throws(() => attachmentInput({ name: "test.any", text }), { code: "INVALID_ATTACHMENT" });
  const file = { name: "file", text: "a".repeat(100000) };
  assert.equal(attachmentsInput(Array(10).fill(file)).length, 10);
  assert.throws(() => attachmentsInput(Array(10).fill(file), file), { code: "INVALID_ATTACHMENT" });
  assert.throws(() => attachmentsInput(Array(50).fill({ ...file, text: "" }), { ...file, text: "" }), { code: "INVALID_ATTACHMENT" });
  assert.throws(() => attachmentsInput([null]), { code: "INVALID_ATTACHMENT" });
  assert.throws(() => attachmentsInput(Array(50).fill({ ...file, text: "" }), null, 1), { code: "INVALID_ATTACHMENT" });
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=";
  const image = { id: "imag1", name: "folder\\nested\\" + "a".repeat(300) + ".png", mimeType: "image/png", data: png };
  assert.equal(imagesInput([image])[0].name, image.name.replace(/\\/g, "/"));
  for (const name of ["/absolute.png", "../escape.png", "a".repeat(1025)])
    assert.throws(() => imagesInput([{ ...image, name }]), { code: "INVALID_IMAGE" });
  const files = attachmentsInput([{ name: "new", text: "new-content" }], { name: "old", text: "legacy-content" });
  assert.match(attachmentPrompt("inspect", files), /legacy-content[\s\S]*new-content/);
});

test("scoped WS files: native @ values, no read receipts, upload idempotency, exact bytes, persistence", { timeout: 30000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-files-")), cwd = join(root, "project"), pi = join(root, "pi");
  mkdirSync(cwd); mkdirSync(pi); mkdirSync(join(cwd, "nested"));
  writeFileSync(join(cwd, "nested", "space name.rs"), "fn main() {}");
  const previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = pi;
  const app = await startServer({ root, port: 0 });
  const ws = new WebSocket(app.origin.replace("http", "ws") + "/ws", { origin: app.origin });
  try {
    await new Promise<void>((r, reject) => { ws.once("open", r); ws.once("error", reject); });
    const w = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: cwd, authorized: true } }) as Workspace;
    const s = app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: w.id }) as Session;
    const scope = { workspaceId: w.id, sessionId: s.id };
    const call = (op: string, params: unknown, target = scope, requestId = randomUUID(), escapeControls = false) => new Promise<any>((resolve, reject) => {
      const receive = (data: WebSocket.RawData) => { const v = JSON.parse(data.toString()); if (v.requestId !== requestId) return; ws.off("message", receive); v.ok ? resolve(v.data) : reject(v.error); };
      ws.on("message", receive);
      let payload = JSON.stringify({ requestId, op, params, ...target });
      if (escapeControls) {
        payload = payload.replace(/\\f/g, "\\u000c");
        assert.ok(Buffer.byteLength(payload) > 15 * 1024 * 1024);
        assert.ok(Buffer.byteLength(payload) < imagePayloadLimit);
      }
      ws.send(payload);
    });
    const id = randomUUID(), text = "Inspect\n@space";
    const got = await call("files.complete", { text, cursor: text.length }, scope, id);
    const native = await new CombinedAutocompleteProvider([], cwd, await findFd()).getSuggestions(text.split("\n"), 1, 6, { signal: AbortSignal.timeout(3000) });
    assert.deepEqual(got, native);
    assert.ok(got);
    assert.equal(got.items[0].value, '@"nested/space name.rs"');
    assert.equal(app.store.receipt(id).status, "not_found");
    assert.equal(await call("files.complete", { text: "hello", cursor: 5 }), null);
    await assert.rejects(call("files.complete", { text: "@", cursor: 2 }), { code: "INVALID_INPUT" });
    await assert.rejects(call("files.complete", { text: "@", cursor: 1 }, { ...scope, sessionId: randomUUID() }), { code: "SCOPE_MISMATCH" });
    await assert.rejects(call("files.upload", { name: "../escape", data: "" }), { code: "INVALID_ATTACHMENT" });
    await assert.rejects(call("files.upload", { name: "file", data: "!!!!" }), { code: "INVALID_UPLOAD" });
    const bytes = Buffer.alloc(10 * 1024 * 1024, 37), uploadId = randomUUID();
    const params = { name: "folder/manual.pdf", data: bytes.toString("base64") };
    const attachment = await call("files.upload", params, scope, uploadId);
    assert.match(attachment.text, /未自动解析/);
    assert.deepEqual(await call("files.upload", params, scope, uploadId), attachment);
    const dir = join(root, "attachments", w.id, s.id), names = readdirSync(dir);
    assert.equal(names.length, 1); assert.ok(names[0].endsWith(".pdf"));
    assert.deepEqual(readFileSync(join(dir, names[0])), bytes);
    await assert.rejects(call("files.upload", { name: "too-big", data: Buffer.alloc(bytes.length + 1).toString("base64") }), { code: "INVALID_UPLOAD" });
    const draft = { viewId: "files", text: "", attachment: { name: "legacy", text: "old" }, attachments: [attachment, { name: "folder/no-extension", text: "new" }], revision: 0 };
    for (const op of ["draft.save", "draft.get", "draft.list"])
      await assert.rejects(call(op, draft), { code: "UNKNOWN_OPERATION" });
    assert.deepEqual(readFileSync(join(dir, names[0])), bytes, "removing drafts does not remove uploaded bytes");
    // A legal maximum image + inline-text prompt exceeds the old 15 MiB frame limit.
    const imageBytes = Buffer.alloc(5 * 1024 * 1024);
    Buffer.from([137,80,78,71,13,10,26,10]).copy(imageBytes);
    const maxImages = [1, 2].map((i) => ({ id: `imag${i}`, name: `folder/nested/image${i}.png`, mimeType: "image/png", data: imageBytes.toString("base64") }));
    await assert.rejects(call("prompt", {
      text: "maximum combined payload", attachment: null,
      attachments: Array.from({ length: 10 }, (_, i) => ({ name: `${i}.txt`, text: "\f".repeat(100000) })),
      images: maxImages,
    }, scope, randomUUID(), true), { code: "MODEL_UNAVAILABLE" }); // Reaches model selection, not a WS frame-limit rejection.
    assert.equal(imagesInput(maxImages).length, 2);
    assert.equal(attachmentsInput(Array.from({ length: 10 }, (_, i) => ({ name: `${i}.txt`, text: "\f".repeat(100000) }))).length, 10);
    // Untrusted web origins cannot open the command channel.
    await new Promise<void>((resolve, reject) => {
      const bad = new WebSocket(app.origin.replace("http", "ws") + "/ws", { origin: "https://evil.example" });
      bad.on("error", () => {});
      bad.on("unexpected-response", (_req, res) => { assert.equal(res.statusCode, 403); bad.terminate(); resolve(); });
      bad.on("open", () => { bad.terminate(); reject(Error("cross-origin socket accepted")); });
    });
  } finally {
    ws.terminate(); await app.close(); rmSync(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  }
});
