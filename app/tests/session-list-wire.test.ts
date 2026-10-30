import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs, { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import WebSocket from "ws";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { setImmediate } from "node:timers/promises";
import { startServer } from "../src/server/index.js";
import { OutgoingQueue } from "../src/server/outgoing.js";
import { SessionLists } from "../src/server/session-list.js";
import { SessionAttention } from "../src/server/session-attention.js";
import { AppError, type Scope, type Session, type Workspace } from "../src/shared/protocol.js";
import type { SessionListPage } from "../src/shared/session-list.js";

type Event = { type: string; scope?: string; requestId?: string; ok?: boolean; data: any; seq: number; error?: { code: string } };
type Initial = { top: SessionListPage; workspace: SessionListPage; revision: number };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "axiom-session-list-wire-"));
  const previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi"); mkdirSync(process.env.AXIOM_PI_DIR);
  let app: Awaited<ReturnType<typeof startServer>> | undefined;
  const sockets = new Set<WebSocket>();
  const releases: (() => void)[] = [];
  t.after(async () => {
    releases.forEach(release => release());
    for (const ws of sockets) ws.terminate();
    try { await app?.close(); }
    finally {
      if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });
  const server = app = await startServer({ root: join(root, "data"), port: 0 });
  const workspace = (name: string) => {
    const path = join(root, name); mkdirSync(path);
    return server.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path, authorized: true } }) as Workspace;
  };
  const main = workspace("main"), foreign = workspace("foreign");
  let time = 100;
  const add = (row: Partial<Session> = {}) => {
    const id = randomUUID();
    server.store.db.prepare("INSERT INTO sessions(id,workspaceId,title,pinned,updatedAt) VALUES(?,?,?,?,?)")
      .run(id, row.workspaceId ?? main.id, row.title ?? "row", Number(!!row.pinned), row.updatedAt ?? time++);
    return { workspaceId: row.workspaceId ?? main.id, sessionId: id };
  };
  const connect = async () => {
    const ws = new WebSocket(server.origin.replace("http", "ws") + "/ws", { origin: server.origin }); sockets.add(ws);
    const events: Event[] = [], pending = new Map<string, (event: Event) => void>();
    ws.on("message", raw => {
      const event = JSON.parse(raw.toString()) as Event; events.push(event);
      if (event.type === "receipt") { pending.get(event.requestId!)?.(event); pending.delete(event.requestId!); }
    });
    await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    const request = (op: string, params: Record<string, unknown> = {}, scope: Partial<Scope> = { workspaceId: main.id }, requestId = randomUUID()) =>
      new Promise<Event>(resolve => { pending.set(requestId, resolve); ws.send(JSON.stringify({ op, requestId, params, ...scope })); });
    const barrier = () => new Promise<void>(resolve => { ws.once("pong", () => resolve()); ws.ping(); });
    return { ws, events, request, barrier };
  };
  return { root, app: server, main, foreign, add, releases, connect, ...await connect() };
}
function accepted(event: Event) { assert.equal(event.ok, true, JSON.stringify(event)); return event.data; }
const snapshots = (events: Event[], scope: string) => events.filter(event => event.type === "snapshot" && event.scope === scope);

test("wire pages are bounded read-only projections, not full-list or mutation paths", { timeout: 20000 }, async t => {
  const f = await fixture(t), selected = f.add({ updatedAt: 1 });
  for (let i = 0; i < 65; i++) f.add();
  f.add({ workspaceId: f.foreign.id, pinned: true });
  await f.request("subscribe", { scope: "session-list" });
  const revision = snapshots(f.events, "session-list").at(-1)?.data.revision;
  assert.equal(typeof revision, "number");
  const reject = () => { throw Error("a list read must not load the old full collection"); };
  const full = t.mock.method(f.app.store, "sessions", reject), pins = t.mock.method(f.app.store, "pinnedSessions", reject);
  const observe = t.mock.method(SessionAttention.prototype, "observe");
  const counts = t.mock.method(f.app.agents, "messageCount");
  const receipts = f.app.store.db.prepare("SELECT COUNT(*) AS n FROM requests").get()!.n;
  const eventStart = f.events.length;
  const initial = accepted(await f.request("session-list.initial")) as Initial;
  assert.equal(initial.top.items.length, 1); assert.equal(initial.workspace.items.length, 30);
  assert.equal(initial.revision, revision); assert.equal(initial.top.revision, initial.workspace.revision);
  const next = accepted(await f.request("session-list.page", { group: "workspace", cursor: initial.workspace.next })) as SessionListPage;
  assert.equal(next.items.length, 30);
  assert.equal(new Set([...initial.workspace.items, ...next.items].map(row => row.id)).size, 60);
  assert.ok(accepted(await f.request("session-list.first"))?.id);
  accepted(await f.request("subscribe", { scope: `session:${selected.workspaceId}:${selected.sessionId}` }));
  assert.equal(snapshots(f.events, `session:${selected.workspaceId}:${selected.sessionId}`).at(-1)?.data.id, selected.sessionId);
  assert.equal(full.mock.callCount(), 0); assert.equal(pins.mock.callCount(), 0); assert.equal(observe.mock.callCount(), 0);
  assert.equal(counts.mock.callCount(), 63, "31 first-page rows + 30 next-page rows + first + selected, never an unseen collection");
  assert.ok(counts.mock.calls.every(call => call.arguments[1]?.cachedOnly === true));
  assert.equal(f.app.store.db.prepare("SELECT COUNT(*) AS n FROM requests").get()!.n, receipts);
  assert.deepEqual(f.events.slice(eventStart).filter(event => event.type === "snapshot").map(event => event.scope), [`session:${selected.workspaceId}:${selected.sessionId}`]);
  const invalid = await f.request("session-list.page", { group: "other" });
  assert.equal(invalid.ok, false); assert.equal(invalid.error?.code, "INVALID_INPUT");
});

test("initial top and workspace pages retain one database snapshot across an external commit", { timeout: 20000 }, async t => {
  const f = await fixture(t);
  for (let i = 0; i < 33; i++) f.add({ title: "before", pinned: true });
  for (let i = 0; i < 33; i++) f.add({ title: "before" });
  const writer = new DatabaseSync(join(f.app.store.root, "axiom.sqlite")); t.after(() => writer.close());
  const page = SessionLists.prototype.page;
  let committed = false;
  t.mock.method(SessionLists.prototype, "page", function(this: SessionLists, ...args: Parameters<typeof page>) {
    const result = Reflect.apply(page, this, args);
    if (!committed && args[1] === "top") { committed = true; writer.prepare("UPDATE sessions SET title='after'").run(); }
    return result;
  });
  const initial = accepted(await f.request("session-list.initial")) as Initial;
  assert.equal(committed, true);
  assert.equal(initial.top.items.length, 30); assert.equal(initial.workspace.items.length, 30);
  assert.ok([...initial.top.items, ...initial.workspace.items].every(row => row.title === "before"));
  assert.equal(initial.revision, initial.top.revision); assert.equal(initial.revision, initial.workspace.revision);
  const fresh = accepted(await f.request("session-list.initial")) as Initial;
  assert.ok(fresh.revision > initial.revision);
  assert.ok([...fresh.top.items, ...fresh.workspace.items].every(row => row.title === "after"));
  const stale = await f.request("session-list.page", { group: "workspace", cursor: initial.workspace.next });
  assert.equal(stale.ok, false); assert.equal(stale.error?.code, "CURSOR_STALE");
});

test("single-session summaries are independent authority; absence is null but read failures are not", { timeout: 20000 }, async t => {
  const f = await fixture(t), selected = f.add({ updatedAt: 1 });
  for (let i = 0; i < 40; i++) f.add();
  const run = randomUUID();
  f.app.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,phase) VALUES(?,?,'running','{}',1,'thinking')").run(run, selected.sessionId);
  const key = `session:${selected.workspaceId}:${selected.sessionId}`;
  accepted(await f.request("subscribe", { scope: key }));
  const summary = snapshots(f.events, key).at(-1)!.data;
  assert.equal(summary.runId, run); assert.equal(summary.runStatus, "running"); assert.equal(summary.messageCount, 0);
  for (const scope of [`session:${f.main.id}:missing`, `session:${f.foreign.id}:${selected.sessionId}`]) {
    accepted(await f.request("subscribe", { scope })); assert.equal(snapshots(f.events, scope).at(-1)!.data, null);
  }
  f.app.store.db.prepare("UPDATE sessions SET deletedAt=1 WHERE id=?").run(selected.sessionId);
  accepted(await f.request("subscribe", { scope: key })); assert.equal(snapshots(f.events, key).at(-1)!.data, null);
  f.app.store.db.prepare("UPDATE sessions SET deletedAt=NULL WHERE id=?").run(selected.sessionId);
  f.app.store.db.prepare("UPDATE workspaces SET archived=1 WHERE id=?").run(f.main.id);
  accepted(await f.request("subscribe", { scope: key })); assert.equal(snapshots(f.events, key).at(-1)!.data, null);
  assert.equal(accepted(await f.request("session-list.first")), null);
  const failures = t.mock.method(SessionLists.prototype, "summary", () => { throw Error("metadata unavailable"); });
  const failedKey = `session:${f.foreign.id}:read-error`;
  assert.equal((await f.request("subscribe", { scope: failedKey })).ok, false);
  assert.equal(snapshots(f.events, failedKey).length, 0, "a query failure must never manufacture authoritative absence");
  failures.mock.restore();
});

test("summary read failures on workspace reopening neither invent absence nor block other invalidations", { timeout: 20000 }, async t => {
  const f = await fixture(t), bad = f.add(), good = f.add();
  const badKey = `session:${bad.workspaceId}:${bad.sessionId}`, goodKey = `session:${good.workspaceId}:${good.sessionId}`, fullKey = `sessions:${f.main.id}`;
  for (const scope of ["session-list", "pinned-sessions", badKey, goodKey, fullKey]) accepted(await f.request("subscribe", { scope }));
  const summary = SessionLists.prototype.summary;
  for (const error of [new AppError("METADATA_UNAVAILABLE", "metadata unavailable"), Error("metadata unavailable")]) {
    accepted(await f.request("workspace.delete", { confirmed: true }, { workspaceId: f.main.id }));
    const hidden = snapshots(f.events, "session-list").at(-1)!.data.revision;
    const failed = t.mock.method(SessionLists.prototype, "summary", function(this: SessionLists, ...args: Parameters<typeof summary>) {
      if (args[1] === bad.sessionId) throw error;
      return Reflect.apply(summary, this, args);
    });
    const start = f.events.length;
    const reopened = await f.request("workspace.open", { path: f.main.path, authorized: true }, {});
    const emitted = f.events.slice(start);
    assert.equal(snapshots(emitted, badKey).length, 0, "a failed summary must not emit an authoritative null on reopening or derived publication");
    accepted(reopened);
    assert.equal(snapshots(emitted, goodKey).at(-1)?.data.id, good.sessionId, "one unavailable summary must not block other observed summaries");
    assert.deepEqual(snapshots(emitted, fullKey).at(-1)?.data.map((row: Session) => row.id).sort(), [bad.sessionId, good.sessionId].sort(), "a failed derived summary must not fabricate an empty workspace collection");
    assert.ok(snapshots(emitted, "session-list").at(-1)!.data.revision > hidden);
    const update = f.events.length;
    f.app.agents.publish(fullKey); accepted(await f.request("ping"));
    const changed = f.events.slice(update);
    assert.equal(snapshots(changed, badKey).length, 0);
    assert.equal(snapshots(changed, goodKey).at(-1)?.data.id, good.sessionId);
    assert.equal(snapshots(changed, "pinned-sessions").length, 1, "a failed selected read cannot interrupt the downstream pins publication");
    assert.equal(snapshots(changed, "session-list").length, 1, "an isolated sessions publication still invalidates pages, without an earlier workspaces event masking failure");
    assert.ok(changed.findIndex(event => event.scope === "pinned-sessions") < changed.findIndex(event => event.scope === "session-list"));
    failed.mock.restore();
    accepted(await f.request("subscribe", { scope: badKey }));
    assert.equal(snapshots(f.events, badKey).at(-1)?.data.id, bad.sessionId, "an explicit successful retry restores authority");
  }
});

test("all title surfaces keep cold JSONL unread; body warming notifies even at the same list revision", { timeout: 20000 }, async t => {
  const f = await fixture(t), local = f.add(), foreign = f.add({ workspaceId: f.foreign.id, pinned: true });
  const manager = SessionManager.create(f.main.path, join(f.root, "native"));
  manager.appendMessage({ role: "user", content: "synthetic question", timestamp: 1 });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "synthetic answer" }], stopReason: "stop", timestamp: 2 } as any);
  for (const scope of [local, foreign]) f.app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(scope.sessionId, manager.getSessionFile()!);
  // Read-only transcript snapshots use one descriptor (openSync/readSync), not readFileSync.
  const originalRead = fs.openSync;
  let nativeReads = 0;
  const reads = t.mock.method(fs, "openSync", (...args: Parameters<typeof originalRead>) => {
    if (String(args[0]) === manager.getSessionFile()) nativeReads++;
    return Reflect.apply(originalRead, fs, args);
  });
  syncBuiltinESMExports(); t.after(() => { reads.mock.restore(); syncBuiltinESMExports(); });
  const parsers = t.mock.method(SessionManager, "inMemory");
  const counts = t.mock.method(f.app.agents, "messageCount");
  for (const scope of ["session-list", `sessions:${f.main.id}`, "pinned-sessions", `session:${local.workspaceId}:${local.sessionId}`]) accepted(await f.request("subscribe", { scope }));
  const initial = accepted(await f.request("session-list.initial")) as Initial;
  assert.equal(initial.workspace.items[0].messageCount, undefined); assert.equal(initial.top.items[0].messageCount, undefined);
  assert.equal(accepted(await f.request("session-list.first")).messageCount, undefined);
  assert.equal(snapshots(f.events, `sessions:${f.main.id}`).at(-1)!.data[0].messageCount, undefined);
  assert.equal(snapshots(f.events, "pinned-sessions").at(-1)!.data[0].messageCount, undefined);
  assert.equal(nativeReads, 0); assert.equal(parsers.mock.callCount(), 0);
  assert.ok(counts.mock.calls.every(call => call.arguments[1]?.cachedOnly === true));
  const before = snapshots(f.events, "session-list").at(-1)!;
  accepted(await f.request("subscribe", { scope: `messages:${local.workspaceId}:${local.sessionId}` }));
  assert.equal(nativeReads, 1, "positive control: an actual body open really reads this synthetic native file");
  assert.equal(parsers.mock.callCount(), 1);
  const after = snapshots(f.events, "session-list").at(-1)!;
  assert.equal(after.data.revision, before.data.revision, "body counts do not change cursor metadata");
  assert.ok(after.seq > before.seq, "same-revision count invalidations must still be delivered");
  assert.equal(snapshots(f.events, `session:${local.workspaceId}:${local.sessionId}`).at(-1)!.data.messageCount, 2);
  assert.equal(snapshots(f.events, `sessions:${f.main.id}`).at(-1)!.data[0].messageCount, 2);
  assert.equal(accepted(await f.request("session-list.initial")).workspace.items[0].messageCount, 2);
  assert.equal(nativeReads, 1, "warming must not cause another exact count scan");
});

test("summary invalidations retain full attention observation and workspace visibility routing", { timeout: 20000 }, async t => {
  const f = await fixture(t), outside = f.add({ updatedAt: 1 });
  for (let i = 0; i < 66; i++) f.add();
  accepted(await f.request("subscribe", { scope: "session-list" }));
  const full = t.mock.method(f.app.store, "sessions"), observe = t.mock.method(SessionAttention.prototype, "observe");
  const before = snapshots(f.events, "session-list").at(-1)!;
  f.app.agents.publish(`sessions:${f.main.id}`); accepted(await f.request("ping"));
  assert.ok(full.mock.calls.some(call => call.result?.length === 67), "internal attention still observes every session, not one UI page");
  const after = snapshots(f.events, "session-list").at(-1)!;
  assert.equal(after.data.revision, before.data.revision); assert.ok(after.seq > before.seq);
  for (const scope of ["pinned-sessions", "workspaces"]) {
    const previous = snapshots(f.events, "session-list").at(-1)!.seq;
    f.app.agents.publish(scope); accepted(await f.request("ping"));
    assert.ok(snapshots(f.events, "session-list").at(-1)!.seq > previous);
  }
  const scope = { workspaceId: f.foreign.id };
  f.add({ workspaceId: f.foreign.id, pinned: true });
  assert.equal(accepted(await f.request("session-list.initial")).top.items.length, 1);
  accepted(await f.request("workspace.delete", { confirmed: true }, scope));
  assert.equal(accepted(await f.request("session-list.initial")).top.items.length, 0);
  const hidden = snapshots(f.events, "session-list").at(-1)!;
  accepted(await f.request("workspace.open", { path: f.foreign.path, authorized: true }, {}));
  assert.equal(accepted(await f.request("session-list.initial")).top.items.length, 1);
  assert.ok(snapshots(f.events, "session-list").at(-1)!.data.revision > hidden.data.revision);

  // Every local row is active; the oldest is outside both bounded UI pages.
  f.app.store.db.prepare("UPDATE sessions SET autoPinUntil=? WHERE workspaceId=?").run(Date.now() + 3600000, f.main.id);
  for (const row of f.app.store.db.prepare("SELECT id FROM sessions WHERE workspaceId=?").all(f.main.id))
    f.app.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,phase) VALUES(?,?,'running','{}',1,'thinking')").run(randomUUID(), String(row.id));
  const pages = accepted(await f.request("session-list.initial")) as Initial;
  assert.ok(![...pages.top.items, ...pages.workspace.items].some(row => row.id === outside.sessionId));
  const observations = observe.mock.callCount();
  f.app.agents.publish(`sessions:${f.main.id}`); accepted(await f.request("ping"));
  assert.equal(observe.mock.callCount(), observations + 1);
  assert.equal(observe.mock.calls.at(-1)?.arguments[0], f.main.id);
  assert.equal(f.app.store.db.prepare("SELECT autoPinUntil FROM sessions WHERE id=?").get(outside.sessionId)!.autoPinUntil, null,
    "attention must actually process the active session beyond both UI pages");
  assert.equal(snapshots(f.events, "session-list").at(-1)!.data.revision,
    f.app.store.db.prepare("SELECT revision FROM session_list_state WHERE id=1").get()!.revision,
    "list invalidation follows attention's metadata changes, not the other way round");
});

test("list reads wait for admission; cancelled or disconnected waiters never query metadata", { timeout: 20000 }, async t => {
  const f = await fixture(t), scope = f.add();
  const page = t.mock.method(SessionLists.prototype, "page"), first = t.mock.method(SessionLists.prototype, "first"), summary = t.mock.method(SessionLists.prototype, "summary");
  const entered = deferred(), gate = deferred(); f.releases.push(gate.resolve);
  const command = f.app.agents.command.bind(f.app.agents);
  t.mock.method(f.app.agents, "command", async (...args: Parameters<typeof command>) => {
    if (args[0].op === "agent.original") { entered.resolve(); await gate.promise; return {}; }
    return Reflect.apply(command, f.app.agents, args);
  });
  const busy = f.request("agent.original", {}, scope); await entered.promise;
  const pending = [
    ["session-list.page", { group: "workspace" }], ["session-list.initial", {}], ["session-list.first", {}],
    ["subscribe", { scope: `session:${scope.workspaceId}:${scope.sessionId}` }],
  ] as const;
  const requests = pending.map(([op, params]) => {
    const id = randomUUID(); let done = false;
    const receipt = f.request(op, params, scope, id).then(event => { done = true; return event; });
    return { id, receipt, settled: () => done };
  });
  await f.barrier();
  assert.ok(requests.every(request => !request.settled()), "metadata requests must not bypass a busy read budget");
  assert.equal(page.mock.callCount() + first.mock.callCount() + summary.mock.callCount(), 0);
  for (const request of requests) accepted(await f.request("read.cancel", { requestId: request.id }));
  gate.resolve(); accepted(await busy);
  for (let i = 0; i < requests.length; i++) {
    const event = await requests[i].receipt;
    assert.ok(event.ok === false || i === 3 && event.data.superseded === true);
  }
  assert.equal(page.mock.callCount() + first.mock.callCount() + summary.mock.callCount(), 0);
  assert.equal(accepted(await f.request("session-list.page", { group: "workspace" })).items.length, 1);

  const other = await f.connect(), dropEntered = deferred(), dropGate = deferred(), dropFinished = deferred(); f.releases.push(dropGate.resolve);
  const reserve = OutgoingQueue.prototype.reserveRead, rejected = deferred();
  let reservations = 0, aborted = false;
  t.mock.method(OutgoingQueue.prototype, "reserveRead", function(this: OutgoingQueue, signal: AbortSignal) {
    const result = Reflect.apply(reserve, this, [signal]);
    // The other connection's first read holds admission; its second must reject on server-side close.
    return ++reservations === 2 ? result.catch(error => { aborted = signal.aborted; rejected.resolve(); throw error; }) : result;
  });
  t.mock.method(f.app.agents, "command", async (...args: Parameters<typeof command>) => {
    if (args[0].op === "agent.original") { dropEntered.resolve(); await dropGate.promise; dropFinished.resolve(); return {}; }
    return Reflect.apply(command, f.app.agents, args);
  });
  void other.request("agent.original", {}, scope); await dropEntered.promise;
  const calls = page.mock.callCount(); void other.request("session-list.page", { group: "workspace" });
  await other.barrier(); other.ws.terminate();
  await rejected.promise; assert.equal(aborted, true, "wait for the server to abort its queued reader, not merely the client's local close");
  dropGate.resolve(); await dropFinished.promise; await setImmediate();
  assert.equal(page.mock.callCount(), calls, "disconnect aborts queued list reads without materializing them");
});

for (const failed of [false, true]) test(`a ${failed ? "failed " : ""}list read keeps its admission until the receipt write callback completes`, { timeout: 20000 }, async t => {
  const f = await fixture(t); f.add();
  const id = randomUUID(), write = WebSocket.prototype.send, original = SessionLists.prototype.page;
  let attempts = 0;
  const page = t.mock.method(SessionLists.prototype, "page", function(this: SessionLists, ...args: Parameters<typeof original>) {
    if (++attempts === 1 && failed) throw new AppError("METADATA_UNAVAILABLE", "metadata unavailable");
    return Reflect.apply(original, this, args);
  });
  const captured = deferred(); let release = () => {};
  f.releases.push(() => release());
  t.mock.method(WebSocket.prototype, "send", function(this: WebSocket, data: any, ...args: any[]) {
    let frame: any; try { frame = JSON.parse(String(data)); } catch { /* not an application frame */ }
    if (frame?.type === "receipt" && frame.requestId === id && typeof args.at(-1) === "function") {
      const done = args.at(-1);
      args[args.length - 1] = (...values: unknown[]) => { release = () => { release = () => {}; done(...values); }; captured.resolve(); };
    }
    return Reflect.apply(write, this, [data, ...args]);
  });
  const receipt = await f.request("session-list.page", { group: "workspace" }, undefined, id); await captured.promise;
  assert.equal(receipt.ok, !failed);
  if (failed) assert.equal(receipt.error?.code, "METADATA_UNAVAILABLE");
  const before = page.mock.callCount();
  const next = f.request("session-list.page", { group: "workspace" }); await f.barrier();
  assert.equal(page.mock.callCount(), before, "receiving a frame must not release the server write budget early");
  release(); accepted(await next); assert.equal(page.mock.callCount(), before + 1);
});
