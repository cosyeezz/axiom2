import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, linkSync, symlinkSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "./temporary.js";
import { Store } from "../src/server/storage.js";
import { DocumentFiles } from "../src/server/document-files.js";
import { saveTextFile, textRevision } from "../src/server/file-edit.js";
import type { FilePreview, FileSaveResult } from "../src/shared/file-preview.js";
import type { ChatMessage } from "../src/shared/agent.js";
import { AppError, type Session, type Workspace } from "../src/shared/protocol.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-file-edit-")), project = join(root, "project"); mkdirSync(project);
  const store = new Store(join(root, "data"));
  const w = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const s = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: w.id }) as Session;
  const scope = { workspaceId: w.id, sessionId: s.id };
  const message: ChatMessage = { id: "reply", role: "assistant", text: "[文件](note.md) [链接](alias.md) [编码](legacy.txt)" };
  const skill = join(project, "SKILL.md");
  const files = new DocumentFiles(store, (owner, id) => owner.sessionId === s.id && id === message.id ? message : null, undefined,
    async (owner, id) => { if (owner.sessionId !== s.id || id !== "known-skill") throw new AppError("CAPABILITY_UNAVAILABLE", "未知技能"); return skill; });
  const call = (op: string, params: Record<string, unknown>, override = {}) => files.command({ requestId: randomUUID(), ...scope, op, params, ...override });
  return { root, project, store, scope, message, skill, call, close: () => { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("shared file editing preserves UTF8 BOM/CRLF and permissions, rejects stale/foreign writes and serializes writers", async () => {
  const f = fixture(), path = join(f.project, "note.md"), ref = { messageId: "reply", href: "note.md" };
  try {
    writeFileSync(path, "\ufeff# Original\r\nline\r\n", { mode: 0o640 });
    const originalMode = statSync(path).mode & 0o777;
    const before = await f.call("files.document", ref) as FilePreview;
    assert.equal(before.editable, true); assert.equal(before.revision?.length, 64);
    const saved = await f.call("files.save", { ...ref, revision: before.revision, text: "# Saved\nline\n" }) as FileSaveResult;
    assert.equal(readFileSync(path, "utf8"), "\ufeff# Saved\r\nline\r\n");
    assert.equal(statSync(path).mode & 0o777, originalMode); assert.notEqual(saved.revision, before.revision);
    await assert.rejects(f.call("files.save", { ...ref, revision: before.revision, text: "stale" }), { code: "REVISION_CONFLICT" });
    const other = f.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: f.scope.workspaceId }) as Session;
    await assert.rejects(f.call("files.save", { ...ref, revision: saved.revision, text: "foreign" }, { sessionId: other.id }), { code: "FILE_PREVIEW_FORBIDDEN" });
    await assert.rejects(f.call("files.save", { ...ref, revision: saved.revision, text: "spoof", path }), { code: "INVALID_INPUT" });
    const outcomes = await Promise.allSettled(["first", "second"].map(text => f.call("files.save", { ...ref, revision: saved.revision, text })));
    assert.equal(outcomes.filter(item => item.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter(item => item.status === "rejected" && item.reason.code === "REVISION_CONFLICT").length, 1);
    const latest = await f.call("files.document", ref) as FilePreview;
    const replacement = readFileSync(path, "utf8").replace(/first|second/, value => "X".repeat(value.length));
    writeFileSync(path, replacement);
    await assert.rejects(f.call("files.save", { ...ref, revision: latest.revision, text: "external overwrite" }), { code: "REVISION_CONFLICT" });
    assert.equal(readFileSync(path, "utf8"), replacement);
    const original = readFileSync(path);
    linkSync(path, join(f.project, "alias.md"));
    await assert.rejects(f.call("files.save", { ...ref, revision: latest.revision, text: "hardlink" }), { code: "FILE_PREVIEW_FORBIDDEN" });
    rmSync(join(f.project, "alias.md")); symlinkSync(path, join(f.project, "alias.md"));
    await assert.rejects(f.call("files.save", { messageId: "reply", href: "alias.md", revision: latest.revision, text: "symlink" }), { code: "FILE_PREVIEW_FORBIDDEN" });
    assert.deepEqual(readFileSync(path), original);
    writeFileSync(join(f.project, "legacy.txt"), Buffer.from([0xd6, 0xd0, 0xce, 0xc4]));
    assert.equal((await f.call("files.document", { messageId: "reply", href: "legacy.txt" }) as FilePreview).editable, false);
    assert.ok(!readdirSync(f.project).some(name => name.endsWith(".tmp")));
    const receipts = JSON.stringify(f.store.db.prepare("SELECT response FROM external_requests").all());
    assert.ok(!receipts.includes("# Saved"), "saved contents must not be persisted in operation receipts");
  } finally { f.close(); }
});

test("file saving rechecks external changes and cancellation before replacing the original", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-file-edit-recheck-")), path = join(root, "note.md");
  try {
    const original = Buffer.from("original"), external = "external change preserved";
    writeFileSync(path, original);
    let checks = 0;
    await assert.rejects(saveTextFile(path, textRevision(original), "edited", false, async () => {
      if (++checks === 2) writeFileSync(path, external);
    }, new AbortController().signal), { code: "REVISION_CONFLICT" });
    assert.equal(readFileSync(path, "utf8"), external);
    assert.deepEqual(readdirSync(root), ["note.md"]);
    const controller = new AbortController(); checks = 0;
    await assert.rejects(saveTextFile(path, textRevision(Buffer.from(external)), "edited", false, async () => {
      if (++checks === 2) controller.abort();
    }, controller.signal), { name: "AbortError" });
    assert.equal(readFileSync(path, "utf8"), external);
    assert.deepEqual(readdirSync(root), ["note.md"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("skill previews use discovered identity and reject invalid or oversized edits without changing the file", async () => {
  const f = fixture(), original = "---\nname: known-skill\ndescription: Useful method\n---\nPrivate guide\n";
  try {
    writeFileSync(f.skill, original);
    const ref = { skillId: "known-skill" }, file = await f.call("files.document", ref) as FilePreview;
    assert.equal(file.kind, "markdown"); assert.equal(file.editable, true);
    await assert.rejects(f.call("files.document", { skillId: "/etc/passwd" }), { code: "CAPABILITY_UNAVAILABLE" });
    await assert.rejects(f.call("files.document", { ...ref, href: f.skill }), { code: "INVALID_INPUT" });
    await assert.rejects(f.call("files.save", { ...ref, revision: file.revision, text: "---\nname: bad\n---\nmissing description" }), { code: "SKILL_INVALID" });
    await assert.rejects(f.call("files.save", { ...ref, revision: file.revision, text: original + "x".repeat(128 * 1024) }), { code: "FILE_EDIT_INVALID" });
    assert.equal(readFileSync(f.skill, "utf8"), original);
    const updated = original.replace("Private guide", "Updated guide");
    const result = await f.call("files.save", { ...ref, revision: file.revision, text: updated }) as FileSaveResult;
    assert.equal(readFileSync(f.skill, "utf8"), updated);
    assert.equal((await f.call("files.document", ref) as FilePreview).revision, result.revision);
    f.store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id=?").run(f.scope.workspaceId);
    await assert.rejects(f.call("files.save", { ...ref, revision: result.revision, text: original }), { code: "AUTHORIZATION_REQUIRED" });
    assert.equal(readFileSync(f.skill, "utf8"), updated);
    assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM runs").get()!.n, 0);
  } finally { f.close(); }
});
