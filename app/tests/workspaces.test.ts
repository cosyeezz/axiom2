import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { WebSocket } from "ws";
import { Store } from "../src/server/storage.js";
import { startServer } from "../src/server/index.js";
import type { Command, Session, Workspace } from "../src/shared/protocol.js";

const temporary = () => mkdtempSync(join(tmpdir(), "axiom-workspaces-"));
const command = (op: string, workspaceId?: string, params = {}): Command => ({ requestId: randomUUID(), op, workspaceId, params });
const open = (store: Store, path: string) => store.execute(command("workspace.open", undefined, { path, authorized: true })) as Workspace;

test("workspace migration, stable pin order, name validation, archive/reopen and persistent startup preference", () => {
  const root = temporary();
  const old = new DatabaseSync(join(root, "axiom.sqlite"));
  old.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY,path TEXT NOT NULL,pathKey TEXT NOT NULL UNIQUE,name TEXT NOT NULL,authorized INTEGER NOT NULL)");
  old.prepare("INSERT INTO workspaces VALUES(?,?,?,?,1)").run("original", root, process.platform === "win32" ? root.toLowerCase() : root, "原项目");
  old.close();
  let store = new Store(root);
  try {
    const a = store.workspace("original");
    assert.equal(a.pinned, false);
    assert.deepEqual(store.workspacePreferences(), { lastWorkspaceId: a.id }, "legacy installations fall back to their first workspace");
    const bPath = join(root, "b"), cPath = join(root, "c");
    mkdirSync(bPath); mkdirSync(cPath);
    const b = open(store, bPath), c = open(store, cPath);
    for (const name of ["", "  ", "x".repeat(121), "bad\0name", "bad\nname", 42])
      assert.throws(() => store.execute(command("workspace.rename", a.id, { name })), { code: "INVALID_INPUT" });
    assert.throws(() => store.execute(command("workspace.pin", a.id, { pinned: 1 })), { code: "INVALID_INPUT" });
    store.execute(command("workspace.rename", a.id, { name: "  我的项目  " }));
    for (const w of [c, b]) store.execute(command("workspace.pin", w.id, { pinned: true }));
    assert.deepEqual(store.workspaces().map((w) => w.id), [b.id, c.id, a.id]);
    store.execute(command("workspace.pin", b.id, { pinned: false }));
    assert.deepEqual(store.workspaces().map((w) => w.id), [c.id, a.id, b.id]);
    store.execute(command("workspace.pin", a.id, { pinned: true }));
    const session = store.execute(command("session.create", a.id)) as Session;
    store.execute({ ...command("session.pin", a.id, { pinned: true }), sessionId: session.id });
    const select = command("workspace.select", a.id);
    assert.deepEqual(store.execute(select), { lastWorkspaceId: a.id });
    assert.deepEqual(store.execute(select), { lastWorkspaceId: a.id });
    assert.throws(() => store.execute({ ...select, workspaceId: b.id }), { code: "REQUEST_CONFLICT" });
    assert.throws(() => store.execute({ ...command("workspace.select", b.id), sessionId: session.id }), { code: "SCOPE_MISMATCH" });
    store.close(); store = new Store(root);
    assert.equal(store.workspacePreferences().lastWorkspaceId, a.id);
    assert.throws(() => store.execute(command("workspace.delete", a.id)), { code: "CONFIRMATION_REQUIRED" });
    const projectFile = join(root, "do-not-delete.txt"), transcript = join(root, "history.jsonl");
    writeFileSync(projectFile, "project content"); writeFileSync(transcript, "saved transcript");
    store.db.prepare("INSERT OR REPLACE INTO agent_sessions(sessionId,file) VALUES(?,?)").run(session.id, transcript);
    const deletion = command("workspace.delete", a.id, { confirmed: true });
    assert.deepEqual(store.execute(deletion), { deleted: a.id });
    assert.deepEqual(store.execute(deletion), { deleted: a.id });
    assert.deepEqual(store.workspacePreferences(), { lastWorkspaceId: null });
    assert.equal(store.pinnedSessions().length, 0);
    for (const read of [() => store.workspace(a.id), () => store.sessions(a.id), () => store.session(a.id, session.id)])
      assert.throws(read, { code: "NOT_FOUND" });
    assert.throws(() => store.execute(command("workspace.select", a.id)), { code: "NOT_FOUND" });
    assert.equal(readFileSync(projectFile, "utf8"), "project content");
    assert.equal(readFileSync(transcript, "utf8"), "saved transcript");
    assert.throws(() => store.execute(command("workspace.open", undefined, { path: root })), { code: "AUTHORIZATION_REQUIRED" });
    const restored = open(store, root);
    assert.equal(restored.id, a.id); assert.equal(restored.name, "我的项目"); assert.equal(restored.pinned, true);
    assert.equal(store.sessions(a.id)[0].id, session.id);
    assert.equal(store.pinnedSessions()[0].id, session.id);
    assert.equal(store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(session.id)!.file, transcript);
    assert.equal(store.workspacePreferences().lastWorkspaceId, null, "opening never navigates other clients");
    // A failed transaction must not clear the preference or commit a deletion receipt.
    store.execute(command("workspace.select", a.id));
    store.db.exec("CREATE TEMP TRIGGER fail_archive BEFORE UPDATE OF archived ON workspaces BEGIN SELECT RAISE(ABORT,'disk failure'); END");
    const failed = command("workspace.delete", a.id, { confirmed: true });
    assert.throws(() => store.execute(failed));
    assert.equal(store.workspacePreferences().lastWorkspaceId, a.id);
    assert.equal(store.receipt(failed.requestId).status, "not_found");
    assert.equal(store.workspace(a.id).id, a.id);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("archive guards include child runs/tasks, compression and pending async admission; obsolete previews do not block archival", () => {
  const root = temporary(), store = new Store(root);
  try {
    const w = open(store, root), parent = store.execute(command("session.create", w.id)) as Session,
      child = store.execute(command("session.create", w.id)) as Session;
    const denied = () => {
      assert.throws(() => store.execute(command("workspace.delete", w.id, { confirmed: true })), { code: "WORKSPACE_BUSY" });
      assert.equal(store.workspace(w.id).id, w.id);
    };
    for (const s of [parent, child]) {
      store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'running','{}',1)").run(s.id, s.id);
      denied(); store.db.prepare("UPDATE runs SET status='completed' WHERE id=?").run(s.id);
    }
    store.db.prepare("INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,description,role,status,budgets,createdAt) VALUES('task',?,?,?,'a','d','','queued','{}',1)").run(w.id, parent.id, child.id);
    denied(); store.db.exec("UPDATE tasks SET status='completed'");
    store.db.exec("CREATE TABLE compressions(id TEXT PRIMARY KEY,sessionId TEXT,body TEXT)");
    store.db.prepare("INSERT INTO compressions VALUES('c',?,?)").run(child.id, JSON.stringify({ state: "running" }));
    denied(); store.db.exec("UPDATE compressions SET body='{\"state\":\"completed\"}'");
    // Legacy preview rows are inert and must not prevent workspace removal.
    store.db.exec("CREATE TABLE preview_processes(id TEXT PRIMARY KEY,workspaceId TEXT,state TEXT)");
    store.db.prepare("INSERT INTO preview_processes VALUES('p',?,'running')").run(w.id);
    store.db.prepare("INSERT INTO external_requests(id,hash,state,scope) VALUES('pending','hash','pending',?)").run(JSON.stringify([w.id, parent.id]));
    denied(); store.db.exec("DELETE FROM external_requests WHERE id='pending'");
    store.db.prepare("INSERT INTO task_inputs(id,taskId,body,mode,state,createdAt) VALUES('held-input','task','input','followUp','queued',1)").run();
    store.db.prepare("INSERT INTO task_results(id,taskId,runId,body) VALUES('result','task',?,'{}')").run(child.id);
    assert.deepEqual(store.execute(command("workspace.delete", w.id, { confirmed: true })), { deleted: w.id });
    assert.equal(store.db.prepare("SELECT frozen FROM task_parents WHERE sessionId=?").get(parent.id)!.frozen, 1);
    assert.equal(store.db.prepare("SELECT state FROM task_inputs WHERE id='held-input'").get(), undefined, "archive discards unsent inputs instead of creating a recovery queue");
    assert.equal(store.db.prepare("SELECT delivery FROM task_results WHERE id='result'").get()!.delivery, "pending");
    open(store, root);
    assert.equal(store.db.prepare("SELECT frozen FROM task_parents WHERE sessionId=?").get(parent.id)!.frozen, 1, "reopen must not implicitly resume results");
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("HTTP/WS workspace broadcasts, view-only preference, removed preview commands and restart", async () => {
  const root = temporary();
  let app = await startServer({ root, port: 0 });
  const clients: WebSocket[] = [];
  async function connect() {
    const ws = new WebSocket(app.origin.replace("http", "ws") + "/ws", { headers: { Origin: app.origin } });
    clients.push(ws);
    const messages: any[] = [];
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    await once(ws, "open");
    const call = (c: Omit<Command, "requestId"> & { requestId?: string }) => new Promise<any>((resolve, reject) => {
      const requestId = c.requestId ?? randomUUID();
      const timer = setTimeout(() => { ws.off("message", receive); reject(Error("receipt timeout")); }, 5000);
      function receive(raw: Buffer) {
        const value = JSON.parse(raw.toString());
        if (value.type === "receipt" && value.requestId === requestId) {
          clearTimeout(timer); ws.off("message", receive); resolve(value);
        }
      }
      ws.on("message", receive); ws.send(JSON.stringify({ ...c, requestId }));
    });
    return { ws, messages, call, latest: (scope: string) => messages.filter((m) => m.type === "snapshot" && m.scope === scope).at(-1)?.data };
  }
  try {
    assert.equal((await fetch(app.origin + "/api/status")).status, 200);
    assert.equal((await fetch(app.origin + "/api/status", { headers: { Origin: "https://alien.example" } })).status, 403);
    const a = await connect(), b = await connect();
    for (const client of [a, b]) for (const scope of ["workspaces", "workspace-preferences", "pinned-sessions"])
      assert.equal((await client.call({ op: "subscribe", params: { scope } })).ok, true);
    const w = (await a.call(command("workspace.open", undefined, { path: root, authorized: true }))).data as Workspace;
    const s = (await a.call(command("session.create", w.id))).data as Session;
    const scope = { workspaceId: w.id, sessionId: s.id };
    for (const prefix of ["sessions", "session", "agent", "thread", "tasks", "compression"])
      assert.equal((await b.call({ op: "subscribe", params: { scope: prefix === "sessions" ? `sessions:${w.id}` : `${prefix}:${w.id}:${s.id}` } })).ok, true);
    await a.call({ ...command("session.pin", w.id, { pinned: true }), sessionId: s.id });
    await a.call(command("workspace.rename", w.id, { name: "广播名称" }));
    await a.call(command("workspace.pin", w.id, { pinned: true }));
    await b.call({ op: "subscribe", params: { scope: "workspaces" } });
    const before = b.messages.length;
    await a.call(command("workspace.select", w.id));
    // A same-socket round trip is an observation barrier for prior broadcasts.
    await b.call({ op: "subscribe", params: { scope: "workspace-preferences" } });
    assert.deepEqual(b.latest("workspace-preferences"), { lastWorkspaceId: w.id });
    assert.equal(b.latest("workspaces")[0].name, "广播名称");
    assert.equal(b.latest("workspaces")[0].pinned, true);
    assert.ok(b.messages.slice(before).filter((m) => m.type === "snapshot").every((m) => m.scope === "workspace-preferences"));
    for (const op of ["preview.open", "preview.list", "preview.close", "preview.refresh", "annotation.send", "annotation.list", "annotation.receipt"]) {
      const removed = await a.call({ ...command(op, w.id, { authorized: true, mode: "static", directory: "." }), sessionId: s.id });
      assert.equal(removed.ok, false);
      assert.equal(removed.error.code, "UNKNOWN_OPERATION");
    }
    const disposable = (await a.call(command("session.create", w.id))).data as Session;
    const deletion = { ...command("session.delete", w.id, { confirmed: true }), sessionId: disposable.id };
    assert.equal((await a.call({ ...deletion, requestId: randomUUID(), params: {} })).error.code, "CONFIRMATION_REQUIRED");
    let release!: () => void;
    const lock = app.agents.models.serial(() => new Promise<void>((resolve) => { release = resolve; }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const pendingDeletion = a.call(deletion);
    try {
      // A same-socket read proves deletion has reached the model lock.
      await a.call({ op: "subscribe", params: { scope: "workspaces" } });
      assert.equal(app.store.session(w.id, disposable.id).id, disposable.id);
      assert.equal((await a.call(command("workspace.delete", w.id, { confirmed: true }))).error.code, "WORKSPACE_BUSY");
    } finally { release(); await lock; }
    assert.equal((await pendingDeletion).ok, true);
    assert.equal((await a.call(deletion)).ok, true, "session deletion remains idempotent through the task service");
    assert.equal((await a.call(command("workspace.delete", w.id, { confirmed: true }))).ok, true);
    await b.call({ op: "subscribe", params: { scope: "workspaces" } });
    assert.deepEqual(b.latest("workspaces"), []);
    assert.deepEqual(b.latest("pinned-sessions"), []);
    assert.deepEqual(b.latest("workspace-preferences"), { lastWorkspaceId: null });
    assert.deepEqual(b.latest(`sessions:${w.id}`), []);
    for (const prefix of ["session", "agent", "thread", "tasks", "compression"])
      assert.equal(b.latest(`${prefix}:${w.id}:${s.id}`), null);
    assert.equal((await b.call({ op: "subscribe", params: { scope: `sessions:${w.id}` } })).error.code, "NOT_FOUND");
    assert.equal((await fetch(`${app.origin}/api/workspace/reveal?id=${w.id}`, { method: "POST", headers: { Origin: app.origin } })).status, 400);
    const reopened = await a.call(command("workspace.open", undefined, { path: root, authorized: true }));
    assert.equal(reopened.data.id, w.id);
    await b.call({ op: "subscribe", params: { scope: "workspaces" } });
    assert.equal(b.latest(`sessions:${w.id}`)[0].id, s.id);
    assert.equal(b.latest("pinned-sessions")[0].id, s.id);
    await a.call(command("workspace.select", w.id));
    for (const ws of clients) ws.terminate();
    await app.close(); app = await startServer({ root, port: 0 });
    const restored = await connect();
    await restored.call({ op: "subscribe", params: { scope: "workspace-preferences" } });
    assert.deepEqual(restored.latest("workspace-preferences"), { lastWorkspaceId: w.id });
    // Archived child history remains on disk but must be excluded from lifecycle scans.
    const child = app.store.execute(command("session.create", w.id)) as Session;
    app.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,endedAt) VALUES('archived-run',?,'completed','{}',1,2)").run(child.id);
    app.store.db.prepare("INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,description,role,status,runId,budgets,createdAt) VALUES('archived-task',?,?,?,'anchor','history','','completed','archived-run','{}',1)").run(w.id, s.id, child.id);
    app.store.db.exec("INSERT INTO task_results(id,taskId,runId,body,delivery) VALUES('archived-result','archived-task','archived-run','{}','pending')");
    assert.equal((await restored.call(command("workspace.delete", w.id, { confirmed: true }))).ok, true);
    await app.tasks.stopProviders([], false);
    for (const ws of clients) ws.terminate();
    await app.close(); app = await startServer({ root, port: 0 });
    assert.deepEqual(app.store.workspaces(), []);
    assert.equal(app.store.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE id='archived-task'").get()!.n, 1);
    assert.equal(app.store.db.prepare("SELECT frozen FROM task_parents WHERE sessionId=?").get(s.id)!.frozen, 1);
    assert.equal(app.store.workspacePreferences().lastWorkspaceId, null);
  } finally {
    for (const ws of clients) ws.terminate();
    await app.close(); rmSync(root, { recursive: true, force: true });
  }
});
