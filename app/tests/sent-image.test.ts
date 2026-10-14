import { projectionFixture } from "./projection-fixture.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { startServer } from "../src/server/index.js";
import { chatMessage, openTranscript, transcriptMessages, transcriptImage } from "../src/server/transcript.js";
import { imageContent, imageMetadata } from "../src/server/images.js";
import { attachmentDisplay, attachmentPrompt, type Attachment, type Command, type ImageAttachment, type Scope, type Session, type Workspace } from "../src/shared/protocol.js";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=";
const photo = (name = "first.png"): ImageAttachment => ({ id: "imag1", name, mimeType: "image/png", data: png });
const reference = (path = "C:/pictures/a.png"): Attachment => ({ id: "imag1", kind: "image", name: "a.png", path, text: "" });
const command = (scope: Scope, op: string, params: Record<string, unknown> = {}): Command => ({ ...scope, op, params, requestId: randomUUID() });
function saveTranscript(file: string, cwd: string, entries: any[]) {
  writeFileSync(file, [JSON.stringify({ type: "session", version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd }),
    ...entries.map((entry, index) => JSON.stringify({ parentId: index ? entries[index - 1].id : null, timestamp: new Date().toISOString(), ...entry }))].join("\n") + "\n");
}

test("sent path images: validated suffix metadata, original body, live/history and append parity", () => {
  const body = "keep [imag1] and ordinary text\n用户正文";
  const attachment = reference(), content = attachmentPrompt(body, [attachment, { id: "file1", kind: "file", path: "C:/notes.txt", name: "notes.txt", text: "" }]);
  const live = chatMessage({ role: "user", content }, "user")!;
  assert.equal(live.text, body);
  assert.deepEqual(live.images, [{ id: "imag1", name: "a.png", mimeType: "image/png", path: attachment.path }]);
  const append = chatMessage({ role: "custom", customType: "axiom-append", display: true, content, details: { axiomInput: "append" } }, "input-append")!;
  assert.equal(append.text, body);
  assert.equal(append.role, "user", "Steering uses the same presentation role as ordinary input");
  assert.deepEqual(append.images, live.images);
  assert.equal(chatMessage({ role: "custom", customType: "axiom-append", display: true, content: "text-only steering" }, "steer")!.role, "user");
  for (const customType of ["axiom-result", "extension-notice"]) {
    assert.equal(chatMessage({ role: "custom", customType, display: true, content: "notice" }, "notice")!.role, "notice");
  }
  assert.equal(chatMessage({ role: "compactionSummary", summary: "summary" }, "summary")!.role, "notice");
  const historical = transcriptMessages(projectionFixture([
    { type: "message", id: "native", message: { role: "user", axiomId: "user", content } },
    { type: "custom_message", id: "custom", customType: "axiom-append", display: true, content, details: { axiomInput: "append" } },
  ]));
  assert.deepEqual(historical, [live, append]);
  assert.equal(chatMessage({ role: "assistant", content }, "assistant")!.text, content);
  assert.equal(chatMessage({ role: "custom", customType: "axiom-result", display: true, content }, "result")!.images, undefined);
  assert.deepEqual(attachmentDisplay(content + "\n用户后文"), { text: content + "\n用户后文", attachments: [] });
  for (const invalid of [attachmentPrompt(body, [attachment, attachment]), attachmentPrompt(body, [{ ...attachment, id: "imag0" }]), content.slice(0, -1)]) {
    assert.equal(chatMessage({ role: "user", content: invalid }, "invalid")!.text, invalid);
    assert.equal(chatMessage({ role: "user", content: invalid }, "invalid")!.images, undefined);
  }
  const inline = { ...photo(), id: "imag2" };
  const mixed = chatMessage({ role: "user", content: imageContent(content, [inline]), axiomImages: imageMetadata([inline]) }, "mixed")!;
  assert.equal(mixed.text, body);
  assert.equal(mixed.images!.length, 2);
  assert.ok(!JSON.stringify(mixed).includes(png));
});

test("sent inline image lookup is current-branch/message bound and validates bytes", () => {
  const native = (id: string, image: ImageAttachment) => ({ type: "message", id, message: { role: "user", content: imageContent("body", [image]), axiomImages: imageMetadata([image]) } });
  const branch = [native("first", photo()), native("second", photo("second.png")),
    { type: "custom_message", id: "append", customType: "axiom-append", display: true, content: imageContent("append", [photo("append.png")]), details: { axiomInput: "queue", images: imageMetadata([photo("append.png")]) } },
    { type: "custom_message", id: "hidden", display: false, content: imageContent("hidden", [photo()]) },
    native("invalid", { ...photo(), mimeType: "image/jpeg" }),
    native("large", { ...photo(), data: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64") }),
  ];
  const manager = projectionFixture(branch);
  assert.deepEqual(transcriptImage(manager, "first", "imag1"), photo());
  assert.deepEqual(transcriptImage(manager, "second", "imag1"), photo("second.png"));
  assert.deepEqual(transcriptImage(manager, "input-queue", "imag1"), photo("append.png"));
  const legacy = projectionFixture([{ type: "message", id: "legacy", message: { role: "user", content: imageContent("old native", [photo()]) } }]);
  assert.deepEqual(transcriptImage(legacy, "legacy", "imag1"), { ...photo(), name: "图片 1" });
  for (const [messageId, imageId] of [["missing", "imag1"], ["first", "imag2"], ["hidden", "imag1"]])
    assert.throws(() => transcriptImage(manager, messageId, imageId), { code: "NOT_FOUND" });
  for (const id of ["invalid", "large"]) assert.throws(() => transcriptImage(manager, id, "imag1"), { code: "INVALID_IMAGE" });
});

test("sent images: real WS reads bound transcript, no bytes in snapshots/receipts, unchanged path grants", { timeout: 30000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-sent-image-")), cwd = join(root, "project");
  mkdirSync(cwd); mkdirSync(join(root, "pi"));
  const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
  let app = await startServer({ root, port: 0 });
  let ws: WebSocket | undefined;
  try {
    const w = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: cwd, authorized: true } }) as Workspace;
    const create = () => app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: w.id }) as Session;
    const scope = { workspaceId: w.id, sessionId: create().id }, other = { workspaceId: w.id, sessionId: create().id };
    const file = join(root, "bound.jsonl"), path = join(root, "not-selected.png"); writeFileSync(path, Buffer.from(png, "base64"));
    const entries = [
      { type: "message", id: "native", message: { role: "user", axiomId: "first", content: imageContent("original [imag1]", [photo()]), axiomImages: imageMetadata([photo()]), timestamp: 1 } },
      { type: "custom_message", id: "append", customType: "axiom-append", display: true, content: imageContent("append [imag1]", [photo("append.png")]), details: { axiomInput: "queue", images: imageMetadata([photo("append.png")]) } },
      { type: "message", id: "path", message: { role: "user", content: attachmentPrompt("path [imag1]", [reference(path)]), timestamp: 2 } },
    ];
    saveTranscript(file, cwd, entries);
    app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(scope.sessionId, file);
    assert.equal(transcriptMessages(openTranscript(file, cwd)).length, 3);
    ws = new WebSocket(app.origin.replace("http", "ws") + "/ws", { origin: app.origin });
    await new Promise<void>((resolve, reject) => { ws!.once("open", resolve); ws!.once("error", reject); });
    const events: any[] = [];
    ws.on("message", (raw) => events.push(JSON.parse(raw.toString())));
    const call = (c: Command) => new Promise<any>((resolve, reject) => {
      const receive = (raw: WebSocket.RawData) => { const v = JSON.parse(raw.toString()); if (v.requestId !== c.requestId) return; ws!.off("message", receive); v.ok ? resolve(v.data) : reject(v.error); };
      ws!.on("message", receive); ws!.send(JSON.stringify(c));
    });
    await call(command(scope, "subscribe", { scope: `message:${w.id}:${scope.sessionId}:first` }));
    await call(command(scope, "message.get", { id: "first" }));
    assert.ok(!JSON.stringify(events).includes(png));
    const preview = command(scope, "message.image", { messageId: "first", imageId: "imag1" });
    assert.deepEqual(await call(preview), photo());
    assert.equal(app.store.receipt(preview.requestId).status, "not_found");
    assert.deepEqual(await call(command(scope, "message.image", { messageId: "input-queue", imageId: "imag1" })), photo("append.png"));
    assert.ok(events.filter((e) => e.type === "snapshot").every((e) => !JSON.stringify(e).includes(png)));
    const params = { messageId: "first", imageId: "imag1" };
    await assert.rejects(call(command(other, "message.image", params)), { code: "NOT_FOUND" });
    await assert.rejects(call(command({ ...scope, workspaceId: "wrong" }, "message.image", params)), { code: "NOT_FOUND" });
    const secondWorkspace = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: root, authorized: true } }) as Workspace;
    await assert.rejects(call(command({ ...scope, workspaceId: secondWorkspace.id }, "message.image", params)), { code: "SCOPE_MISMATCH" });
    await assert.rejects(call(command(scope, "message.image", { ...params, path })), { code: "INVALID_INPUT" });
    await assert.rejects(call(command(scope, "message.image", { ...params, imageId: "imag0" })), { code: "INVALID_INPUT" });
    await assert.rejects(call(command(scope, "message.image", { ...params, messageId: "path" })), { code: "NOT_FOUND" });
    assert.equal((await call(command(scope, "message.get", { id: "path" }))).images[0].path, path);
    await assert.rejects(call(command(scope, "files.preview", { path, id: "imag1" })), { code: "IMAGE_PREVIEW_FORBIDDEN" });
    app.store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id=?").run(w.id);
    await assert.rejects(call(preview), { code: "AUTHORIZATION_REQUIRED" });
    app.store.db.prepare("UPDATE workspaces SET authorized=1 WHERE id=?").run(w.id);
    // Repeated request IDs re-read instead of retaining image data in a receipt.
    saveTranscript(file, cwd, []);
    await assert.rejects(call(preview), { code: "NOT_FOUND" });
    saveTranscript(file, join(root, "wrong"), entries);
    await assert.rejects(call(preview), { code: "SESSION_FILE_ERROR" });
    saveTranscript(file, cwd, entries);
    ws.terminate(); ws = undefined;
    await app.close(); app = await startServer({ root, port: 0 });
    assert.deepEqual(await app.tasks.command(preview), photo());
    assert.equal(app.store.receipt(preview.requestId).status, "not_found");
    assert.ok(!JSON.stringify(app.agents.message(scope, "first", true)).includes(png));
    app.store.db.prepare("DELETE FROM sessions WHERE id=?").run(scope.sessionId);
    await assert.rejects(app.tasks.command(preview), { code: "SCOPE_MISMATCH" });
  } finally {
    ws?.terminate(); await app.close(); rmSync(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  }
});
