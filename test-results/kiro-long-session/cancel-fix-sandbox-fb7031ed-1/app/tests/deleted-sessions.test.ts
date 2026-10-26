import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { Store } from "../src/server/storage.js";
import { startServer } from "../src/server/index.js";
import type { Command, DeletedSessionCursor, Session, Workspace } from "../src/shared/protocol.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-deleted-sessions-"));
  let store = new Store(join(root, "data"));
  const run = (op: string, workspaceId?: string, sessionId?: string, params = {}) => store.execute({ op, workspaceId, sessionId, params, requestId: randomUUID() });
  const workspace = (name: string) => {
    const path = join(root, name); mkdirSync(path);
    return run("workspace.open", undefined, undefined, { path, authorized: true }) as Workspace;
  };
  const create = (w: Workspace, title: string, updatedAt = 100) => {
    const s = run("session.create", w.id) as Session;
    run("session.rename", w.id, s.id, { title });
    store.db.prepare("UPDATE sessions SET updatedAt=? WHERE id=?").run(updatedAt, s.id);
    return s;
  };
  return { root, get store() { return store; }, run, workspace, create,
    restart() { store.close(); store = new Store(join(root, "data")); },
    close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("deleted queue pages tied timestamps without gaps and searches every page and workspace", () => {
  const f = fixture();
  try {
    const a = f.workspace("Alpha"), b = f.workspace("Beta");
    const ids = [];
    for (let i = 0; i < 67; i++) {
      const w = i % 2 ? a : b, s = f.create(w, i === 66 ? "Older NEEDLE" : `row ${i}`);
      ids.push(s.id); f.run("session.delete", w.id, s.id, { confirmed: true });
    }
    f.store.db.prepare("UPDATE sessions SET deletedAt=12345").run();
    const found: string[] = [];
    let cursor: DeletedSessionCursor | null = null;
    do {
      const page = f.store.deletedSessions({ cursor });
      assert.ok(page.items.length <= 30);
      found.push(...page.items.map((s) => s.id)); cursor = page.next;
    } while (cursor);
    assert.deepEqual(found, ids.sort());
    assert.equal(f.store.deletedSessions({ query: "needle" }).items[0].title, "Older NEEDLE");
    assert.equal(f.store.deletedSessions({ query: "Alpha" }).items.every((s) => s.workspaceId === a.id), true);
    assert.equal(f.store.deletedSessions({ query: b.path }).items.every((s) => s.workspacePath === b.path), true);
    assert.deepEqual(f.store.deletedSessions({ query: "%" }), { items: [], next: null }, "search treats SQL wildcards literally");
    assert.throws(() => f.store.deletedSessions({ cursor: { deletedAt: "bad", id: "x" } }), { code: "INVALID_INPUT" });
    assert.throws(() => f.store.deletedSessions({ query: "x".repeat(201) }), { code: "INVALID_INPUT" });
    assert.deepEqual(f.store.sessions(a.id), []);
    assert.deepEqual(f.store.pinnedSessions(), []);
  } finally { f.close(); }
});

test("restore retains original identity, title, pin, sort position and file bytes across restart", () => {
  const f = fixture();
  try {
    const a = f.workspace("original"), b = f.workspace("other");
    const older = f.create(a, "older", 10), middle = f.create(a, "middle", 20), newer = f.create(a, "newer", 30);
    const originalOrder = f.store.sessions(a.id).map((s) => s.id);
    const paths = [join(f.root, "conversation.jsonl"), join(f.root, "attachment.bin"), join(f.root, "memory.md")];
    paths.forEach((path, i) => writeFileSync(path, `original bytes ${i}\n`));
    f.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET file=excluded.file").run(middle.id, paths[0]);
    const bytes = paths.map((path) => readFileSync(path));
    f.run("session.delete", a.id, middle.id, { confirmed: true });
    assert.throws(() => f.store.session(a.id, middle.id), { code: "SCOPE_MISMATCH" });
    assert.throws(() => f.run("session.restore", b.id, middle.id), { code: "SCOPE_MISMATCH" });
    f.restart();
    const restore: Command = { op: "session.restore", requestId: randomUUID(), workspaceId: a.id, sessionId: middle.id };
    const restored = f.store.execute(restore) as Session;
    assert.deepEqual(f.store.execute(restore), restored, "repeated request is idempotent");
    assert.equal(restored.id, middle.id); assert.equal(restored.title, "middle"); assert.equal(restored.updatedAt, 20);
    assert.deepEqual(f.store.sessions(a.id).map((s) => s.id), originalOrder);
    assert.deepEqual(f.store.deletedSessions().items, []);
    paths.forEach((path, i) => assert.deepEqual(readFileSync(path), bytes[i]));
    f.run("session.pin", a.id, older.id, { pinned: true });
    f.run("session.delete", a.id, older.id, { confirmed: true });
    assert.equal(f.store.db.prepare("SELECT pinned FROM sessions WHERE id=?").get(older.id)!.pinned, 0, "existing deletion semantics stay unchanged");
    f.run("session.restore", a.id, older.id);
    assert.equal(f.store.session(a.id, older.id).pinned, true);
    assert.equal(f.store.session(a.id, newer.id).updatedAt, 30);
    assert.throws(() => f.run("session.restore", a.id, older.id), { code: "SCOPE_MISMATCH" });
  } finally { f.close(); }
});

test("restore preserves unread and unexpired automatic pins without reviving expired cooldowns", () => {
  const f = fixture();
  try {
    const w = f.workspace("attention"), s = f.create(w, "cooling", 20);
    const deadline = Date.now() + 300000;
    f.store.db.prepare("UPDATE sessions SET autoPinUntil=? WHERE id=?").run(deadline, s.id);
    f.run("session.delete", w.id, s.id, { confirmed: true });
    assert.equal(f.store.db.prepare("SELECT autoPinUntil FROM sessions WHERE id=?").get(s.id)!.autoPinUntil, 0);
    f.restart();
    f.run("session.restore", w.id, s.id);
    assert.equal(f.store.session(w.id, s.id).autoPinUntil, deadline);
    assert.deepEqual(f.store.pinnedSessions().map((row) => row.id), [s.id]);
    f.run("session.delete", w.id, s.id, { confirmed: true });
    f.store.db.prepare("UPDATE session_restore_positions SET autoPinUntil=1 WHERE sessionId=?").run(s.id);
    f.run("session.restore", w.id, s.id);
    assert.equal(f.store.session(w.id, s.id).autoPinUntil, 0);
    assert.deepEqual(f.store.pinnedSessions(), []);
    f.store.db.prepare("UPDATE sessions SET unread=1,resultVersion=2,readVersion=1 WHERE id=?").run(s.id);
    f.run("session.delete", w.id, s.id, { confirmed: true });
    assert.equal(f.store.db.prepare("SELECT unread FROM sessions WHERE id=?").get(s.id)!.unread, 0);
    f.run("session.restore", w.id, s.id);
    assert.equal(f.store.session(w.id, s.id).unread, true);
    assert.equal(f.store.session(w.id, s.id).readVersion, 1);
    assert.deepEqual(f.store.pinnedSessions().map((row) => row.id), [s.id]);
    f.run("session.delete", w.id, s.id, { confirmed: true });
    f.store.db.prepare("UPDATE sessions SET readVersion=resultVersion WHERE id=?").run(s.id);
    f.run("session.restore", w.id, s.id);
    assert.equal(f.store.session(w.id, s.id).unread, false, "restore never undoes a newer read watermark");
  } finally { f.close(); }
});

test("restore includes child history without resuming tasks and can return to an archived workspace", () => {
  const f = fixture();
  try {
    const w = f.workspace("family"), parent = f.create(w, "parent"), child = f.create(w, "child");
    f.store.db.prepare("INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,description,status,budgets,createdAt) VALUES(?,?,?,?,'a','task','stopped','{}',1)")
      .run(randomUUID(), w.id, parent.id, child.id);
    f.store.db.prepare("INSERT INTO task_parents(sessionId,frozen) VALUES(?,1)").run(parent.id);
    f.run("session.delete", w.id, parent.id, { confirmed: true });
    assert.deepEqual(f.store.deletedSessions().items.map((s) => s.id), [parent.id]);
    assert.throws(() => f.run("session.restore", w.id, child.id), { code: "SCOPE_MISMATCH" });
    f.run("workspace.delete", w.id, undefined, { confirmed: true });
    assert.equal(f.store.workspaces().length, 0);
    assert.equal(f.store.deletedSessions().items.length, 1);
    f.run("session.restore", w.id, parent.id);
    assert.equal(f.store.workspaces()[0].id, w.id);
    assert.equal(f.store.session(w.id, child.id).id, child.id);
    assert.equal(f.store.db.prepare("SELECT frozen FROM task_parents WHERE sessionId=?").get(parent.id)!.frozen, 1);
    assert.equal(f.store.db.prepare("SELECT status FROM tasks WHERE sessionId=?").get(child.id)!.status, "stopped");
    // Legacy deletions have no saved position, so their retained values remain valid.
    f.store.db.prepare("UPDATE sessions SET deletedAt=1 WHERE id=?").run(parent.id);
    f.run("session.restore", w.id, parent.id);
    assert.equal(f.store.session(w.id, parent.id).updatedAt, 100);
  } finally { f.close(); }
});

test("websocket deletion invalidates pages, blocks content, and restores the pre-stop ordering time", { timeout: 30000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "axiom-deleted-wire-"));
  const app = await startServer({ root: join(root, "data"), port: 0 });
  const ws = new WebSocket(app.origin.replace("http", "ws") + "/ws", { origin: app.origin });
  try {
    const w = app.store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: root, authorized: true } }) as Workspace;
    const s = app.store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: w.id }) as Session;
    app.store.db.prepare("UPDATE sessions SET updatedAt=42 WHERE id=?").run(s.id);
    const originalStop = app.tasks.stopParent.bind(app.tasks);
    t.mock.method(app.tasks, "stopParent", async (scope: Parameters<typeof app.tasks.stopParent>[0]) => {
      await originalStop(scope);
      app.store.db.prepare("UPDATE sessions SET updatedAt=999 WHERE id=?").run(scope.sessionId);
    });
    const events: any[] = [], pending = new Map<string, (value: any) => void>();
    ws.on("message", (raw) => { const event = JSON.parse(raw.toString()); events.push(event); if (event.type === "receipt") { pending.get(event.requestId)?.(event); pending.delete(event.requestId); } });
    await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    const request = (op: string, params = {}) => new Promise<any>((resolve) => {
      const requestId = randomUUID(); pending.set(requestId, resolve);
      ws.send(JSON.stringify({ op, requestId, params, workspaceId: w.id, sessionId: s.id }));
    });
    assert.equal((await request("subscribe", { scope: "deleted-sessions" })).ok, true);
    assert.equal((await request("session.delete", { confirmed: true })).ok, true);
    assert.equal((await request("deleted-sessions.list")).data.items[0].id, s.id);
    assert.equal((await request("subscribe", { scope: `messages:${w.id}:${s.id}` })).ok, false);
    assert.equal((await request("subscribe", { scope: `session:${w.id}:${s.id}` })).ok, false);
    assert.equal((await request("session.restore")).ok, true);
    assert.equal(app.store.session(w.id, s.id).updatedAt, 42);
    assert.deepEqual((await request("deleted-sessions.list")).data.items, []);
    assert.equal((await request("subscribe", { scope: `session:${w.id}:${s.id}` })).ok, true);
    assert.equal(events.filter((event) => event.scope === "deleted-sessions").length, 3);
  } finally {
    ws.close(); await app.close(); rmSync(root, { recursive: true, force: true });
  }
});
