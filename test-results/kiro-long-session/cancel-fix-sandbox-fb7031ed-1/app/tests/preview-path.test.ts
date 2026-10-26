import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Files } from "../src/server/files.js";
import { previewFilePath } from "../src/server/preview-path.js";
import { Store } from "../src/server/storage.js";
import type { ChatMessage } from "../src/shared/agent.js";
import type { FilePreview } from "../src/shared/file-preview.js";
import type { Command, ImageAttachment, Session, Workspace } from "../src/shared/protocol.js";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=";

test("preview path: only the exact macOS /tmp component is eligible", async () => {
  for (const platform of ["linux", "win32"] as const)
    assert.equal(await previewFilePath("/tmp/picture.png", platform), "/tmp/picture.png");
  for (const path of ["/tmp-other/picture.png", "/tmpfile.png", "/private/tmp/picture.png", "/var/tmp/picture.png", "/private/picture.png"])
    assert.equal(await previewFilePath(path, "darwin"), path);
});

test("preview path: macOS system alias works without granting other paths or symlinks", { skip: process.platform !== "darwin" }, async () => {
  assert.equal(realpathSync("/tmp"), "/private/tmp");
  assert.equal(await previewFilePath("/tmp"), "/private/tmp");
  const aliasRoot = mkdtempSync("/tmp/axiom-preview-alias-"), root = realpathSync(aliasRoot);
  mkdirSync(join(root, "project"));
  const store = new Store(join(root, "data"));
  const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: join(root, "project"), authorized: true } }) as Workspace;
  const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const other = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  let message = { id: "reply", role: "assistant", text: "" } as ChatMessage;
  const revealed: string[] = [];
  const files = new Files(store, (owner, id) => owner.sessionId === scope.sessionId && id === "reply" ? message : null,
    async path => { revealed.push(path); });
  const call = (op: string, params: Record<string, unknown>, override = {}) => files.command({ requestId: randomUUID(), ...scope, op, params, ...override } as Command);
  const link = (href: string) => { message = { ...message, role: "assistant", text: `[预览](<${href}>)\n![图片](<${href}>)` }; };
  const read = (href: string) => call("files.document", { messageId: "reply", href }) as Promise<FilePreview>;
  const image = (href: string) => call("files.markdownImage", { messageId: "reply", href }) as Promise<ImageAttachment>;
  try {
    writeFileSync(join(root, "picture.png"), Buffer.from(png, "base64"));
    const alias = join(aliasRoot, "picture.png"), canonical = join(root, "picture.png");
    assert.equal(await previewFilePath(alias), canonical);
    for (const href of [alias, canonical]) {
      link(href);
      const document = await read(href);
      assert.equal(document.kind, "image"); assert.equal(document.data, png); assert.equal(document.path, canonical);
      assert.equal((await image(href)).data, png);
    }
    link(alias);
    // Canonicalizing a file path must not canonicalize or broaden message authorization.
    await assert.rejects(read(canonical), { code: "FILE_PREVIEW_FORBIDDEN" });
    await assert.rejects(image(canonical), { code: "IMAGE_PREVIEW_FORBIDDEN" });
    await assert.rejects(call("files.document", { messageId: "reply", href: alias }, { sessionId: other.id }), { code: "FILE_PREVIEW_FORBIDDEN" });
    await assert.rejects(call("files.markdownImage", { messageId: "reply", href: alias }, { sessionId: other.id }), { code: "IMAGE_PREVIEW_FORBIDDEN" });
    message.role = "user";
    await assert.rejects(read(alias), { code: "FILE_PREVIEW_FORBIDDEN" });
    await assert.rejects(image(alias), { code: "IMAGE_PREVIEW_FORBIDDEN" });
    link(alias);
    await call("files.reveal", { messageId: "reply", href: alias });
    assert.deepEqual(revealed, [canonical]);
    await assert.rejects(call("files.preview", { path: alias }), { code: "IMAGE_PREVIEW_FORBIDDEN" });
    files.registerPicked(scope, [{ path: alias, name: "picture.png", kind: "image" }]);
    assert.equal((await call("files.preview", { path: alias }) as ImageAttachment).data, png);
    await assert.rejects(call("files.preview", { path: canonical }), { code: "IMAGE_PREVIEW_FORBIDDEN" });
    store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id=?").run(workspace.id);
    await assert.rejects(read(alias), { code: "AUTHORIZATION_REQUIRED" });
    await assert.rejects(image(alias), { code: "AUTHORIZATION_REQUIRED" });
    store.db.prepare("UPDATE workspaces SET authorized=1 WHERE id=?").run(workspace.id);

    mkdirSync(join(root, "actual")); writeFileSync(join(root, "actual", "picture.png"), Buffer.from(png, "base64"));
    symlinkSync(join(root, "actual"), join(root, "redirect"), "dir");
    symlinkSync(canonical, join(root, "symlink.png"));
    linkSync(join(root, "actual", "picture.png"), join(root, "hardlink.png"));
    for (const name of ["redirect/picture.png", "symlink.png", "hardlink.png"]) {
      const href = join(aliasRoot, name); link(href);
      await assert.rejects(read(href), { code: "FILE_PREVIEW_FORBIDDEN" });
      await assert.rejects(image(href), { code: "IMAGE_PREVIEW_FORBIDDEN" });
      files.registerPicked(scope, [{ path: href, name: "picture.png", kind: "image" }]);
      await assert.rejects(call("files.preview", { path: href }), { code: "IMAGE_PREVIEW_FORBIDDEN" });
    }
    // Returning the canonical path also preserves strict revision-checked text saving.
    const text = join(aliasRoot, "note.txt"); writeFileSync(text, "before"); link(text);
    const before = await read(text);
    assert.equal(before.path, join(root, "note.txt")); assert.equal(before.editable, true);
    await call("files.save", { messageId: "reply", href: text, revision: before.revision, text: "after" });
    assert.equal((await read(text)).text, "after");
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
