import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { WebSocket } from "ws";
import { startServer } from "../src/server/index.js";
import { Store } from "../src/server/storage.js";
import { SessionAttention } from "../src/server/session-attention.js";
import { isTopSession, sessionPinCooldownMs } from "../src/shared/session-attention.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-session-attention-"));
  const store = new Store(root);
  const run = (op: string, workspaceId?: string, sessionId?: string, params = {}) =>
    store.execute({ requestId: crypto.randomUUID(), op, workspaceId, sessionId, params });
  const workspace = run("workspace.open", undefined, undefined, { path: root, authorized: true }) as Workspace;
  const create = () => run("session.create", workspace.id) as Session;
  const scope = (s: Session) => ({ workspaceId: s.workspaceId, sessionId: s.id });
  const changes: string[] = [];
  const attention = new SessionAttention(store, (name) => changes.push(name));
  const current = (s: Session) => store.sessions(s.workspaceId).find((row) => row.id === s.id)!;
  const running = (s: Session) => store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'running','{}',1)").run(s.id, s.id);
  const unread = (s: Session) => store.recordResult(s.id, crypto.randomUUID(), "run");
  const read = (s: Session) => run("session.read", s.workspaceId, s.id, { throughVersion: current(s).resultVersion });
  const close = () => { attention.close(); store.close(); rmSync(root, { recursive: true, force: true }); };
  return { root, store, run, workspace, create, scope, changes, attention, current, running, unread, read, close };
}

test("unviewed running/unread/child activity has no deadline; idle history never becomes an automatic pin", () => {
  const f = fixture();
  try {
    const active = f.create(), unread = f.create(), parent = f.create(), child = f.create(), idle = f.create();
    f.running(active); f.unread(unread);
    f.store.db.prepare("INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,description,status,budgets,createdAt) VALUES('task',?,?,?,'a','d','running','{}',1)")
      .run(f.workspace.id, parent.id, child.id);
    f.attention.expire(Date.now() + 100 * sessionPinCooldownMs);
    assert.deepEqual(new Set(f.store.pinnedSessions().map((s) => s.id)), new Set([active.id, unread.id, parent.id]));
    for (const s of [active, unread, parent]) assert.equal(f.current(s).autoPinUntil, null);
    f.attention.view({}, f.scope(idle), true);
    assert.equal(isTopSession(f.current(idle)), false);
  } finally { f.close(); }
});

test("viewing retains read/completed sessions; foreground reading never expires; last departure starts a full cooldown", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const f = fixture();
  try {
    const s = f.create(), owner = {};
    f.unread(s);
    f.attention.view(owner, f.scope(s), true);
    assert.equal(f.current(s).unread, true, "presence alone cannot acknowledge unseen results");
    f.read(s);
    assert.equal(f.current(s).unread, false);
    assert.equal(f.current(s).autoPinUntil, Date.now() + sessionPinCooldownMs);
    t.mock.timers.setTime(Date.now() + 10 * sessionPinCooldownMs);
    f.attention.expire();
    assert.equal(isTopSession(f.current(s)), true, "passive foreground reading is still viewing");
    f.attention.view(owner, f.scope(s), false);
    const deadline = f.current(s).autoPinUntil!;
    assert.equal(deadline, Date.now() + sessionPinCooldownMs);
    f.attention.expire(deadline - 1);
    assert.equal(isTopSession(f.current(s)), true);
    f.attention.expire(deadline);
    assert.equal(f.current(s).autoPinUntil, 0);
    assert.equal(f.store.pinnedSessions().length, 0);
    assert.equal(f.current(s).id, s.id);
    assert.ok(f.changes.includes(`sessions:${s.workspaceId}`));
  } finally { f.close(); }
});

test("active sessions never start cooling; completion and reading start a full idle cooldown", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const f = fixture();
  try {
    const s = f.create(), first = {}, second = {};
    f.running(s);
    f.attention.view(first, f.scope(s), true);
    f.attention.view(second, f.scope(s), true);
    assert.equal(f.current(s).autoPinUntil, null);
    f.attention.disconnect(first);
    f.attention.disconnect(second);
    assert.equal(f.current(s).autoPinUntil, null, "leaving a running session does not start a timer");
    t.mock.timers.setTime(Date.now() + 10 * sessionPinCooldownMs);
    f.attention.expire();
    assert.equal(isTopSession(f.current(s)), true);
    assert.equal(f.store.pinnedSessions().length, 1);

    f.store.finishRun(s.id, "completed", null);
    f.attention.observe(s.workspaceId);
    f.attention.expire(Date.now() + 10 * sessionPinCooldownMs);
    assert.equal(isTopSession(f.current(s)), true, "unread completion stays at the top");
    f.attention.view(second, f.scope(s), true);
    f.read(s);
    assert.equal(f.current(s).autoPinUntil, Date.now() + sessionPinCooldownMs);
    t.mock.timers.setTime(Date.now() + 2 * sessionPinCooldownMs);
    f.attention.expire();
    assert.equal(isTopSession(f.current(s)), true, "foreground reading protects completed sessions");
    f.attention.disconnect(second);
    const deadline = Date.now() + sessionPinCooldownMs;
    assert.equal(f.current(s).autoPinUntil, deadline);
    f.attention.expire(deadline - 1);
    assert.equal(isTopSession(f.current(s)), true);
    f.attention.expire(deadline);
    assert.equal(isTopSession(f.current(s)), false);
    f.run("session.pin", s.workspaceId, s.id, { pinned: true });
    assert.equal(isTopSession(f.current(s)), true, "manual pins survive cooling");
  } finally { f.close(); }
});

test("all active states override legacy deadlines and child activity cancels an existing cooldown", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const f = fixture();
  try {
    for (const status of ["starting", "running", "stopping", "child"] as const) {
      const s = f.create();
      if (status === "child") {
        const child = f.create();
        f.store.db.prepare("INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,description,status,budgets,createdAt) VALUES(?,?,?,?,'a','d','queued','{}',1)")
          .run(s.id, s.workspaceId, s.id, child.id);
      } else {
        f.running(s);
        f.store.db.prepare("UPDATE runs SET status=? WHERE id=?").run(status, s.id);
      }
      for (const deadline of [0, Date.now() - 1, Date.now() + sessionPinCooldownMs]) {
        f.store.db.prepare("UPDATE sessions SET autoPinUntil=? WHERE id=?").run(deadline, s.id);
        assert.equal(isTopSession(f.current(s)), true, `${status} ignores legacy cooldown ${deadline}`);
        assert.ok(f.store.pinnedSessions().some((row) => row.id === s.id), "global query includes active sessions");
        f.attention.expire();
        f.attention.observe(s.workspaceId);
        assert.equal(f.current(s).autoPinUntil, null);
        assert.equal(isTopSession(f.current(s)), true);
      }
      f.attention.view({}, f.scope(s), true);
      assert.equal(f.current(s).autoPinUntil, null);
    }
  } finally { f.close(); }
});

test("new foreground activity needs a rendered version; wrong ownership and stale departures cannot clear another view", () => {
  const f = fixture();
  try {
    const a = f.create(), b = f.create(), owner = {};
    f.attention.view(owner, f.scope(a), true);
    f.running(a);
    f.attention.observe(a.workspaceId);
    assert.equal(f.current(a).autoPinUntil, null);
    f.unread(a);
    f.attention.observe(a.workspaceId);
    assert.equal(f.current(a).unread, true);
    f.read(a);
    assert.equal(f.current(a).unread, false);
    f.unread(b);
    f.attention.view(owner, f.scope(b), true);
    f.read(b);
    f.attention.view(owner, f.scope(a), false);
    mkdirSync(join(f.root, "other"));
    const foreign = f.run("workspace.open", undefined, undefined, { path: join(f.root, "other"), authorized: true }) as Workspace;
    assert.throws(() => f.attention.view(owner, { workspaceId: foreign.id, sessionId: b.id }, true), { code: "SCOPE_MISMATCH" });
    assert.throws(() => f.attention.view(owner, f.scope(b), "true"), { code: "INVALID_INPUT" });
    f.attention.expire(Date.now() + 10 * sessionPinCooldownMs);
    assert.equal(isTopSession(f.current(a)), true, "running sessions remain pinned after leaving");
    assert.equal(isTopSession(f.current(b)), true);
    f.run("session.delete", b.workspaceId, b.id, { confirmed: true });
    assert.doesNotThrow(() => f.attention.disconnect(owner));
  } finally { f.close(); }
});

test("WebSocket presence is scoped, shares foreground holds, and disconnect publishes timed return without agent output", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-attention-ws-"));
  const app = await startServer({ root, port: 0 });
  const clients: WebSocket[] = [];
  const connect = async () => {
    const ws = new WebSocket(app.origin.replace("http", "ws") + "/ws", { headers: { Origin: app.origin } });
    clients.push(ws);
    const messages: any[] = [];
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    await once(ws, "open");
    const call = (op: string, params: object, scope = {}) => new Promise<any>((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => { ws.off("message", receive); reject(Error("receipt timeout")); }, 5000);
      function receive(raw: Buffer) {
        const response = JSON.parse(raw.toString());
        if (response.type !== "receipt" || response.requestId !== requestId) return;
        clearTimeout(timer); ws.off("message", receive);
        resolve(response);
      }
      ws.on("message", receive);
      ws.send(JSON.stringify({ requestId, op, params, ...scope }));
    });
    return { ws, messages, call };
  };
  const until = async (predicate: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
      if (Date.now() > deadline) throw Error("presence/expiry timeout");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  try {
    const run = (op: string, params = {}, workspaceId?: string) => app.store.execute({ requestId: crypto.randomUUID(), op, params, workspaceId });
    const w = run("workspace.open", { path: root, authorized: true }) as Workspace;
    const s = run("session.create", {}, w.id) as Session;
    const scope = { workspaceId: w.id, sessionId: s.id };
    const current = () => app.store.session(w.id, s.id);
    app.store.recordResult(s.id, "fixture-result", "run");
    const a = await connect(), b = await connect();
    await b.call("subscribe", { scope: "pinned-sessions" });
    assert.equal((await a.call("session.view", { active: true }, scope)).ok, true);
    assert.equal(current().unread, true);
    assert.equal((await a.call("session.read", { throughVersion: current().resultVersion }, scope)).ok, true);
    assert.equal(current().unread, false);
    assert.equal((await b.call("session.view", { active: true }, scope)).ok, true);
    await a.call("session.view", { active: false }, scope);
    const observer = await connect();
    await observer.call("subscribe", { scope: "pinned-sessions" });
    // Observing summaries is not the same as opening the conversation.
    await b.call("session.view", { active: false }, scope);
    await b.call("session.view", { active: true }, scope);
    app.store.db.prepare("UPDATE sessions SET autoPinUntil=? WHERE id=?").run(Date.now() - 1, s.id);
    b.ws.close(); await once(b.ws, "close");
    // Client close precedes the server's close handler: wait for its renewed deadline.
    await until(() => current().autoPinUntil! > Date.now());
    app.store.db.prepare("UPDATE sessions SET autoPinUntil=? WHERE id=?").run(Date.now() - 1, s.id);
    await until(() => current().autoPinUntil === 0);
    await until(() => observer.messages.some((m) => m.type === "snapshot" && m.scope === "pinned-sessions" && m.data.length === 0));
    assert.equal(app.store.sessions(w.id)[0].id, s.id);
    assert.equal(current().pinned, false);
    assert.equal((await a.call("session.view", { active: "true" }, scope)).error.code, "INVALID_INPUT");
  } finally {
    for (const ws of clients) ws.terminate();
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("cooldown survives reopening the store, and an expired session does not reappear", () => {
  const f = fixture();
  let reopened: Store | undefined;
  try {
    const s = f.create();
    f.unread(s);
    f.read(s);
    const deadline = f.current(s).autoPinUntil!;
    assert.ok(deadline > Date.now());
    f.attention.close(); f.store.close();
    reopened = new Store(f.root);
    assert.equal(reopened.pinnedSessions()[0].autoPinUntil, deadline);
    const attention = new SessionAttention(reopened, () => {});
    attention.expire(deadline);
    assert.equal(reopened.pinnedSessions().length, 0);
    attention.close();
    reopened.close(); reopened = new Store(f.root);
    assert.equal(reopened.session(s.workspaceId, s.id).autoPinUntil, 0);
    assert.equal(reopened.pinnedSessions().length, 0);
  } finally {
    reopened?.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
