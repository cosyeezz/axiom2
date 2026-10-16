import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync, symlinkSync, linkSync } from "node:fs";
import { tmpdir } from "./temporary.js";
import { dirname, join } from "node:path";
import { test } from "node:test";
import WebSocket from "ws";
import { Files } from "../src/server/files.js";
import { startServer } from "../src/server/index.js";
import { Store } from "../src/server/storage.js";
import type { Attachment, Command, ImageAttachment, Scope, Session, Workspace } from "../src/shared/protocol.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=", "base64");
const command = (scope: Scope, op: string, params: Record<string, unknown> = {}): Command => ({ requestId: randomUUID(), ...scope, op, params });
function createScope(store: Store, path: string): Scope {
  mkdirSync(path, { recursive: true });
  const w = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path, authorized: true } }) as Workspace;
  const s = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: w.id }) as Session;
  return { workspaceId: w.id, sessionId: s.id };
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-image-path-"));
  const store = new Store(root), files = new Files(store), scope = createScope(store, join(root, "project"));
  return { root, store, files, scope, close: () => { store.close(); rmSync(root, { recursive: true, force: true }); } };
}
async function upload(files: Files, scope: Scope, bytes = png, name = "截图.png") {
  return await files.command(command(scope, "files.upload", { name, id: "imag1", kind: "image", data: bytes.toString("base64") })) as Attachment;
}

// Use the production WS dispatcher and HTTP picker route, not only direct service calls.
test("path preview: WS uploaded/picked images, scoped registration and no persistent read receipts", { timeout: 30000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-preview-ws-")), selected = join(root, "selected.png");
  writeFileSync(selected, png);
  const previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi"); mkdirSync(process.env.AXIOM_PI_DIR);
  const app = await startServer({ root, port: 0, pickAttachments: async () => [selected] });
  const ws = new WebSocket(app.origin.replace("http", "ws") + "/ws", { origin: app.origin });
  try {
    await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    const scope = createScope(app.store, join(root, "project"));
    const s2 = app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: scope.workspaceId }) as Session;
    const other = { ...scope, sessionId: s2.id };
    const call = (c: Command) => new Promise<any>((resolve, reject) => {
      const receive = (raw: WebSocket.RawData) => {
        const v = JSON.parse(raw.toString());
        if (v.requestId !== c.requestId) return;
        ws.off("message", receive); v.ok ? resolve(v.data) : reject(v.error);
      };
      ws.on("message", receive); ws.send(JSON.stringify(c));
    });
    const attachment = await call(command(scope, "files.upload", { id: "imag1", kind: "image", name: "截图.png", data: png.toString("base64") }));
    const c = command(scope, "files.preview", { path: attachment.path, id: "imag7" });
    assert.deepEqual(await call(c), { id: "imag7", name: "截图.png", mimeType: "image/png", data: png.toString("base64") });
    assert.equal(app.store.receipt(c.requestId).status, "not_found");
    await assert.rejects(call(command(other, "files.preview", { path: attachment.path })), { code: "IMAGE_PREVIEW_FORBIDDEN" });
    await assert.rejects(call(command(scope, "files.preview", { path: selected })), { code: "IMAGE_PREVIEW_FORBIDDEN" });
    const response = await fetch(`${app.origin}/api/attachments/pick?workspaceId=${scope.workspaceId}&sessionId=${scope.sessionId}`, { method: "POST", headers: { Origin: app.origin } });
    assert.equal(response.status, 200);
    const { items } = await response.json() as { items: { path: string }[] };
    const picked = command(scope, "files.preview", { path: items[0].path });
    assert.deepEqual(await call(picked), { id: "imag1", name: "selected.png", mimeType: "image/png", data: png.toString("base64") });
    assert.equal(app.store.receipt(picked.requestId).status, "not_found");
    await assert.rejects(call(command(other, "files.preview", { path: items[0].path })), { code: "IMAGE_PREVIEW_FORBIDDEN" });
    await assert.rejects(call(command(scope, "files.registerPicked", { items })), { code: "UNKNOWN_OPERATION" });
    // Reusing an id still performs a read, rather than replaying cached bytes.
    rmSync(attachment.path);
    await assert.rejects(call(c), { code: "IMAGE_NOT_FOUND" });
    assert.equal(app.store.receipt(c.requestId).status, "not_found");
  } finally {
    ws.terminate(); await app.close(); rmSync(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  }
});

test("path preview: upload provenance survives restart; arbitrary paths/files in upload directory do not", async () => {
  const f = fixture();
  try {
    const a = await upload(f.files, f.scope);
    const restarted = new Files(f.store);
    assert.equal((await restarted.command(command(f.scope, "files.preview", { path: a.path })) as ImageAttachment).data, png.toString("base64"));
    const forged = join(dirname(a.path!), randomUUID() + ".png"); writeFileSync(forged, png);
    const outside = join(f.root, "unselected.png"); writeFileSync(outside, png);
    for (const path of [forged, outside, f.root, f.scope.sessionId, dirname(a.path!) + "/../" + f.scope.sessionId + "/" + a.path!.split(/[\\/]/).at(-1)])
      await assert.rejects(restarted.command(command(f.scope, "files.preview", { path })));
    for (const id of ["file1", "imag0", "imag-1", 1, null, "imag1000000000"])
      await assert.rejects(restarted.command(command(f.scope, "files.preview", { path: a.path, id })), { code: "INVALID_INPUT" });
    f.files.registerPicked(f.scope, [{ path: outside, name: "unselected.png", kind: "image" }]);
    assert.ok(await f.files.command(command(f.scope, "files.preview", { path: outside })));
    assert.ok(await restarted.command(command(f.scope, "files.preview", { path: outside })));
    const other = createScope(f.store, join(f.root, "other-project"));
    await assert.rejects(restarted.command(command(other, "files.preview", { path: a.path })), { code: "IMAGE_PREVIEW_FORBIDDEN" });
    await assert.rejects(restarted.command(command({ ...f.scope, sessionId: other.sessionId }, "files.preview", { path: a.path })), { code: "SCOPE_MISMATCH" });
    f.store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id=?").run(f.scope.workspaceId);
    await assert.rejects(restarted.command(command(f.scope, "files.preview", { path: a.path })), { code: "AUTHORIZATION_REQUIRED" });
    f.store.db.prepare("UPDATE workspaces SET authorized=1 WHERE id=?").run(f.scope.workspaceId);
    f.store.db.prepare("DELETE FROM sessions WHERE id=?").run(f.scope.sessionId);
    await assert.rejects(restarted.command(command(f.scope, "files.preview", { path: a.path })), { code: "SCOPE_MISMATCH" });
  } finally { f.close(); }
});

test("path preview: committed uploads and native picker grants survive Store reopen", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-preview-restart-"));
  let store = new Store(root);
  try {
    const files = new Files(store), scope = createScope(store, join(root, "project"));
    const a = await upload(files, scope), picked = join(root, "picked.png");
    writeFileSync(picked, png);
    files.registerPicked(scope, [{ path: picked, name: "picked.png", kind: "image" }]);
    store.close(); store = new Store(root);
    const restarted = new Files(store);
    assert.equal((await restarted.command(command(scope, "files.preview", { path: a.path })) as ImageAttachment).data, png.toString("base64"));
    assert.equal((await restarted.command(command(scope, "files.preview", { path: picked })) as ImageAttachment).data, png.toString("base64"));
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("path preview: actual signatures, 10 MiB bound, missing/invalid images, no folder or file grants", async () => {
  const f = fixture();
  try {
    for (const [bytes, mimeType] of [
      [png, "image/png"], [Buffer.from([255, 216, 255, 224, 0, 16]), "image/jpeg"],
      [Buffer.from("GIF89a"), "image/gif"], [Buffer.from("GIF87a"), "image/gif"],
      [Buffer.from("RIFF\x04\x00\x00\x00WEBP"), "image/webp"],
    ] as const) {
      const a = await upload(f.files, f.scope, bytes, "not-a-png.txt");
      const c = command(f.scope, "files.preview", { path: a.path });
      const image = await f.files.command(c) as ImageAttachment;
      assert.equal(image.mimeType, mimeType); assert.equal(image.data, bytes.toString("base64"));
      assert.equal(f.store.receipt(c.requestId).status, "not_found");
    }
    for (const bytes of [Buffer.alloc(0), Buffer.from("<svg></svg>"), Buffer.from("plain text"), Buffer.from("RIFF")]) {
      const a = await upload(f.files, f.scope, bytes);
      await assert.rejects(f.files.command(command(f.scope, "files.preview", { path: a.path })), { code: "INVALID_IMAGE" });
    }
    const large = Buffer.alloc(10 * 1024 * 1024); png.copy(large);
    const a = await upload(f.files, f.scope, large);
    assert.equal(Buffer.from((await f.files.command(command(f.scope, "files.preview", { path: a.path })) as ImageAttachment).data, "base64").length, large.length);
    writeFileSync(a.path!, Buffer.concat([large, Buffer.from([0])]));
    await assert.rejects(f.files.command(command(f.scope, "files.preview", { path: a.path })), { code: "IMAGE_TOO_LARGE" });
    rmSync(a.path!);
    await assert.rejects(f.files.command(command(f.scope, "files.preview", { path: a.path })), { code: "IMAGE_NOT_FOUND" });
    const folder = join(f.root, "chosen-folder"); mkdirSync(folder);
    const child = join(folder, "child.png"); writeFileSync(child, png);
    f.files.registerPicked(f.scope, [{ path: folder, name: "folder", kind: "folder" }, { path: child, name: "child.png", kind: "file" }]);
    for (const path of [folder, child]) await assert.rejects(f.files.command(command(f.scope, "files.preview", { path })), { code: "IMAGE_PREVIEW_FORBIDDEN" });
  } finally { f.close(); }
});

test("path preview: rejects upload directory junction/symlink and hardlink replacement", async () => {
  const f = fixture();
  try {
    const a = await upload(f.files, f.scope), dir = dirname(a.path!), moved = dir + "-moved";
    renameSync(dir, moved);
    symlinkSync(moved, dir, process.platform === "win32" ? "junction" : "dir");
    try { await assert.rejects(f.files.command(command(f.scope, "files.preview", { path: a.path })), { code: "IMAGE_PREVIEW_FORBIDDEN" }); }
    finally { rmSync(dir); renameSync(moved, dir); }
    const outside = join(f.root, "outside.png"); writeFileSync(outside, png);
    rmSync(a.path!); linkSync(outside, a.path!);
    await assert.rejects(f.files.command(command(f.scope, "files.preview", { path: a.path })), { code: "IMAGE_PREVIEW_FORBIDDEN" });
  } finally { f.close(); }
});

test("path preview: selected path cannot be redirected through a directory junction", async () => {
  const f = fixture();
  try {
    const dir = join(f.root, "selected-dir"), moved = dir + "-moved", path = join(dir, "picked.png");
    mkdirSync(dir); writeFileSync(path, png);
    f.files.registerPicked(f.scope, [{ path, name: "picked.png", kind: "image" }]);
    renameSync(dir, moved); symlinkSync(moved, dir, process.platform === "win32" ? "junction" : "dir");
    try { await assert.rejects(f.files.command(command(f.scope, "files.preview", { path })), { code: "IMAGE_PREVIEW_FORBIDDEN" }); }
    finally { rmSync(dir); renameSync(moved, dir); }
  } finally { f.close(); }
});
