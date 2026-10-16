import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import WebSocket from "ws";
import { tmpdir } from "./temporary.js";
import { Store } from "../src/server/storage.js";
import { SessionDrafts } from "../src/server/session-drafts.js";
import { startServer } from "../src/server/index.js";
import type { DraftWrite } from "../src/shared/drafts.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";

function scope(store: Store, path: string): Scope {
  mkdirSync(path, { recursive: true });
  const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path, authorized: true } }) as Workspace;
  const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  return { workspaceId: workspace.id, sessionId: session.id };
}
const write = (text: string, revision = 0, sequence = 1, writer = "first"): DraftWrite => ({
  revision, writer, sequence, draft: { text, attachment: null, attachments: [], images: [] },
});

test("SQLite drafts survive Store reopen without starting pi; selected main session and cascade stay scoped", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-durable-draft-"));
  let store = new Store(root);
  try {
    const owner = scope(store, join(root, "project")), other = scope(store, join(root, "other"));
    const drafts = new SessionDrafts(store), input = write("  中文\n\n未发送的草稿  ");
    input.draft.attachments = [{ id: "file1", name: "file.txt", text: "", path: join(root, "file.txt"), kind: "file" }];
    input.draft.images = [{ id: "imag1", name: "legacy.png", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1kAAAAASUVORK5CYII=" }];
    drafts.save(owner, input);
    assert.throws(() => drafts.read({ ...owner, sessionId: other.sessionId }), { code: "SCOPE_MISMATCH" });
    store.execute({ requestId: randomUUID(), op: "workspace.select", workspaceId: owner.workspaceId, params: { view: owner } });
    assert.equal(store.db.prepare("SELECT count(*) AS count FROM runs").get()!.count, 0);
    assert.equal(store.db.prepare("SELECT count(*) AS count FROM agent_sessions WHERE file IS NOT NULL").get()!.count, 0);
    store.close(); store = new Store(root);
    const restored = new SessionDrafts(store);
    assert.deepEqual(restored.read(owner).draft, input.draft);
    assert.equal(restored.read(other).draft.text, "");
    assert.deepEqual(store.lastSession(), owner);
    store.db.prepare("DELETE FROM sessions WHERE id=?").run(owner.sessionId);
    assert.equal(store.db.prepare("SELECT count(*) AS count FROM session_drafts").get()!.count, 0);
    assert.equal(store.lastSession(), null);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("draft ordering, competing writers, conditional consume and late unload retries preserve newer input", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-draft-races-")), store = new Store(root);
  try {
    const owner = scope(store, join(root, "project")), drafts = new SessionDrafts(store);
    const first = write("one"), second = write("two", 0, 2);
    drafts.save(owner, second);
    drafts.save(owner, first);
    assert.equal(drafts.read(owner).draft.text, "two");
    assert.throws(() => drafts.save(owner, write("changed", 0, 2)), { code: "DRAFT_SEQUENCE_CONFLICT" });
    assert.throws(() => drafts.save(owner, write("stale window", 0, 1, "second")), { code: "DRAFT_CONFLICT" });
    drafts.save(owner, write("remote", 1, 1, "second"));
    assert.throws(() => drafts.save(owner, write("old first writer", 1, 3)), { code: "DRAFT_CONFLICT" });
    const submitted = { ...write("submitted", 2, 4), submissionId: randomUUID() };
    const stamp = drafts.save(owner, submitted);
    drafts.save(owner, write("typed while awaiting", stamp.revision, 5));
    drafts.consume(owner, stamp, submitted.submissionId);
    assert.equal(drafts.read(owner).draft.text, "typed while awaiting");
    const last = { ...write("last", drafts.read(owner).revision, 6), submissionId: randomUUID() };
    const lastStamp = drafts.save(owner, last);
    drafts.consume(owner, lastStamp, "another-request");
    assert.equal(drafts.read(owner).draft.text, "last");
    drafts.consume(owner, lastStamp, last.submissionId);
    assert.equal(drafts.read(owner).draft.text, "");
    drafts.save(owner, last);
    drafts.save(owner, submitted);
    assert.equal(drafts.read(owner).draft.text, "", "late unload cannot resurrect a sent draft");
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("committed admission reconciles after restart; failed/unconfirmed requests retain drafts without replay", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-draft-receipts-"));
  let store = new Store(root);
  try {
    const owner = scope(store, join(root, "project")), drafts = new SessionDrafts(store);
    const input = { ...write("admitted"), submissionId: randomUUID() };
    drafts.save(owner, input);
    await store.external({ requestId: input.submissionId, op: "prompt", ...owner }, async () => ({ inputId: randomUUID() }));
    store.close(); store = new Store(root);
    const restored = new SessionDrafts(store);
    assert.equal(restored.read(owner).draft.text, "");
    restored.save(owner, input);
    assert.equal(restored.read(owner).draft.text, "");
    const pending = { ...write("not confirmed", restored.read(owner).revision, 2), submissionId: randomUUID() };
    restored.save(owner, pending);
    assert.equal(restored.read(owner).draft.text, "not confirmed");
    assert.equal(store.receipt(pending.submissionId, owner).status, "not_found");
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("draft HTTP validates origin, scope, input and CAS without pi initialization", { timeout: 30000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-draft-http-")), previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi"); mkdirSync(process.env.AXIOM_PI_DIR);
  const app = await startServer({ root: join(root, "data"), port: 0 });
  try {
    const owner = scope(app.store, join(root, "project"));
    const url = `${app.origin}/api/draft?${new URLSearchParams(owner as unknown as Record<string, string>)}`;
    const post = (body: unknown, origin = app.origin) => fetch(url, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await post(write("bad origin"), "http://evil.invalid")).status, 403);
    assert.equal((await post(write("  recover exactly\n  "))).status, 200);
    assert.equal((await post(write("competing", 0, 1, "other"))).status, 409);
    assert.equal((await post({ ...write("invalid"), sequence: -1 })).status, 400);
    const saved = await (await fetch(url)).json() as DraftWrite;
    assert.equal(saved.draft.text, "  recover exactly\n  ");
    assert.equal(app.store.db.prepare("SELECT count(*) AS count FROM runs").get()!.count, 0);
    assert.equal(app.store.db.prepare("SELECT count(*) AS count FROM agent_sessions WHERE file IS NOT NULL").get()!.count, 0);

    // Once a prompt is admitted, failure of optional cleanup must not reject its receipt.
    const requestId = randomUUID(), drafts = new SessionDrafts(app.store);
    const stamp = drafts.save(owner, { ...write("submitted", saved.revision, 2), submissionId: requestId });
    app.tasks.command = command => app.store.external(command, async () => ({ inputId: command.requestId }));
    app.store.db.exec("CREATE TRIGGER fail_draft_cleanup BEFORE UPDATE OF body ON session_drafts BEGIN SELECT RAISE(FAIL, 'draft cleanup unavailable'); END");
    const socket = new WebSocket(app.origin.replace("http:", "ws:") + "/ws", { origin: app.origin });
    try {
      const receipt = await new Promise<{ ok: boolean; data: { inputId: string } }>((resolve, reject) => {
        socket.on("error", reject);
        socket.on("message", raw => {
          const value = JSON.parse(raw.toString());
          if (value.type === "receipt" && value.requestId === requestId) resolve(value);
        });
        socket.on("open", () => socket.send(JSON.stringify({ requestId, op: "prompt", ...owner, params: { text: "submitted", draftStamp: stamp } })));
      });
      assert.equal(receipt.ok, true, "draft cleanup failure does not turn accepted input into failure");
      assert.equal(receipt.data.inputId, requestId);
      assert.equal(app.store.receipt(requestId, owner).status, "committed");
      app.store.db.exec("DROP TRIGGER fail_draft_cleanup");
      assert.equal(drafts.read(owner).draft.text, "", "later draft read reconciles the admitted request");
    } finally { socket.terminate(); }
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
