// Real counts RPC/admission, private synthetic Store/JSONL; no UI or model run.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import WebSocket from "ws";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { startServer } from "../src/server/index.js";
import { OutgoingQueue } from "../src/server/outgoing.js";
import { RemoteAccess } from "../src/server/remote-access.js";
import { SessionLists } from "../src/server/session-list.js";
import type { Scope, Workspace } from "../src/shared/protocol.js";
import type { SessionListCounts } from "../src/shared/session-list.js";

type Event = { type: string; requestId?: string; scope?: string; ok?: boolean; data?: any; error?: { code: string } };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "axiom-counts-wire-"));
  const previous = process.env.AXIOM_PI_DIR, sockets = new Set<WebSocket>(), releases: (() => void)[] = [];
  const pi = join(root, "pi"); mkdirSync(pi); writeFileSync(join(pi, "auth.json"), "{}"); writeFileSync(join(pi, "models.json"), '{"providers":{}}');
  process.env.AXIOM_PI_DIR = pi;
  t.mock.method(RemoteAccess.prototype, "initialize", async () => {});
  let app: Awaited<ReturnType<typeof startServer>> | undefined, updateFetches = 0;
  t.after(async () => {
    releases.forEach(release => release()); for (const ws of sockets) ws.terminate();
    try { await app?.close(); assert.equal(updateFetches, 0); }
    finally { if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous; rmSync(root, { recursive: true, force: true }); }
  });
  const server = app = await startServer({ root: join(root, "data"), port: 0,
    backendUpdates: { initialDelayMs: 3_600_000, fetcher: async () => { updateFetches++; throw Error("network updates disabled"); } } });
  const workspace = (name: string) => {
    const path = join(root, name); mkdirSync(path);
    return server.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path, authorized: true } }) as Workspace;
  };
  const main = workspace("main"), foreign = workspace("foreign");
  const add = (owner = main) => {
    const sessionId = randomUUID();
    server.store.db.prepare("INSERT INTO sessions(id,workspaceId,title,updatedAt) VALUES(?,?,?,1)").run(sessionId, owner.id, "Synthetic");
    return { workspaceId: owner.id, sessionId };
  };
  const connect = async () => {
    const ws = new WebSocket(server.origin.replace("http", "ws") + "/ws", { origin: server.origin }); sockets.add(ws);
    const events: Event[] = [], pending = new Map<string, (event: Event) => void>();
    ws.on("message", raw => { const event: Event = JSON.parse(raw.toString()); events.push(event); if (event.type === "receipt") { pending.get(event.requestId!)?.(event); pending.delete(event.requestId!); } });
    await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    const request = (op: string, params: Record<string, unknown> = {}, scope: Partial<Scope> = { workspaceId: main.id }, requestId = randomUUID()) =>
      new Promise<Event>(resolve => { pending.set(requestId, resolve); ws.send(JSON.stringify({ op, params, ...scope, requestId })); });
    const barrier = () => new Promise<void>(resolve => { ws.once("pong", () => resolve()); ws.ping(); });
    return { ws, events, request, barrier };
  };
  return { root, app: server, main, foreign, add, connect, releases, ...await connect() };
}
function accepted(event: Event) { assert.equal(event.ok, true, JSON.stringify(event)); return event.data; }
const assistant = (text: string) => ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop", timestamp: 2 }) as any;

test("counts RPC reads exact current-branch history, returns zero and unknown, and never resets title revision", { timeout: 20000 }, async t => {
  const f = await fixture(t), cold = f.add(), empty = f.add(), missing = f.add(), foreign = f.add(f.foreign);
  for (let i = 0; i < 40; i++) f.add();
  const manager = SessionManager.create(f.main.path, join(f.root, "native"));
  manager.appendMessage({ role: "user", content: "question", timestamp: 1 }); manager.appendMessage(assistant("answer"));
  manager.appendMessage({ role: "toolResult", toolCallId: "tool", toolName: "read", content: [{ type: "text", text: "output" }], isError: false, timestamp: 2 });
  manager.appendCustomMessageEntry("axiom-append", "follow up", true, { axiomInput: "follow-up" });
  manager.appendCustomMessageEntry("axiom-result", "internal", true);
  const removed = manager.appendMessage(assistant("redacted retry")); manager.appendContextEdit(removed, null);
  const point = manager.getLeafId()!; manager.appendMessage(assistant("abandoned branch")); manager.branch(point);
  manager.appendMessage({ role: "user", content: "current branch", timestamp: 3 });
  manager.appendCompaction("summary", null, 1000); manager.appendMessage(assistant("latest"));
  const bind = f.app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)");
  bind.run(cold.sessionId, manager.getSessionFile()!); bind.run(missing.sessionId, join(f.root, "unavailable.jsonl"));
  accepted(await f.request("subscribe", { scope: "session-list" }));
  const initial = accepted(await f.request("session-list.initial")), beforeSnapshots = f.events.filter(e => e.type === "snapshot" && e.scope === "session-list").length;
  const receipts = f.app.store.db.prepare("SELECT COUNT(*) AS n FROM requests").get()!.n;
  const counts = t.mock.method(f.app.agents, "messageCount"), parses = t.mock.method(SessionManager, "inMemory");
  const result = accepted(await f.request("session-list.counts", { sessionIds: [cold.sessionId, empty.sessionId, missing.sessionId] })) as SessionListCounts;
  assert.deepEqual(result, { workspaceId: f.main.id, items: [{ sessionId: cold.sessionId, messageCount: 5 }, { sessionId: empty.sessionId, messageCount: 0 }, { sessionId: missing.sessionId }] });
  assert.equal(counts.mock.callCount(), 3); assert.ok(counts.mock.calls.every(c => c.arguments[1] === undefined)); assert.equal(parses.mock.callCount(), 1);
  const before = counts.mock.callCount();
  const invalid = await f.request("session-list.counts", { sessionIds: [cold.sessionId, foreign.sessionId] });
  assert.equal(invalid.ok, false); assert.equal(counts.mock.callCount(), before, "validate the whole batch before any exact read");
  assert.equal(accepted(await f.request("session-list.counts", { sessionIds: [foreign.sessionId] }, { workspaceId: f.foreign.id })).items[0].messageCount, 0);
  manager.appendMessage({ role: "user", content: "newly committed", timestamp: 4 });
  assert.equal(accepted(await f.request("session-list.counts", { sessionIds: [cold.sessionId] })).items[0].messageCount, 6);
  assert.equal(parses.mock.callCount(), 2, "a changed source cannot reuse the old exact baseline");
  const refreshed = accepted(await f.request("session-list.initial")); assert.equal(refreshed.revision, initial.revision);
  assert.equal(f.events.filter(e => e.type === "snapshot" && e.scope === "session-list").length, beforeSnapshots);
  assert.equal(f.app.store.db.prepare("SELECT COUNT(*) AS n FROM requests").get()!.n, receipts);
});

test("counts wait for read admission and queued cancellation belongs only to the originating socket", { timeout: 20000 }, async t => {
  const f = await fixture(t), scope = f.add(), entered = deferred(), gate = deferred(); f.releases.push(gate.resolve);
  const command = f.app.agents.command.bind(f.app.agents);
  t.mock.method(f.app.agents, "command", async (...args: Parameters<typeof command>) => {
    if (args[0].op === "agent.original") { entered.resolve(); await gate.promise; return {}; }
    return Reflect.apply(command, f.app.agents, args);
  });
  const scopes = t.mock.method(SessionLists.prototype, "countScopes"), counts = t.mock.method(f.app.agents, "messageCount");
  const busy = f.request("agent.original", {}, scope); await entered.promise;
  let queuedSettled = false;
  const id = randomUUID(), queued = f.request("session-list.counts", { sessionIds: [scope.sessionId] }, scope, id).then(event => { queuedSettled = true; return event; });
  await f.barrier(); assert.equal(scopes.mock.callCount(), 0);
  const other = await f.connect(); accepted(await other.request("read.cancel", { requestId: id })); await f.barrier();
  assert.equal(queuedSettled, false, "a different socket cannot cancel the original read"); assert.equal(scopes.mock.callCount(), 0);
  accepted(await f.request("read.cancel", { requestId: id })); assert.equal((await queued).ok, false);
  gate.resolve(); accepted(await busy); assert.equal(scopes.mock.callCount(), 0); assert.equal(counts.mock.callCount(), 0);
  assert.equal(accepted(await f.request("session-list.counts", { sessionIds: [scope.sessionId] })).items[0].messageCount, 0);
  const drop = await f.connect(), dropEntered = deferred(), dropGate = deferred(), dropFinished = deferred(), rejected = deferred(); f.releases.push(dropGate.resolve);
  const reserve = OutgoingQueue.prototype.reserveRead; let reservations = 0, aborted = false;
  t.mock.method(OutgoingQueue.prototype, "reserveRead", function(this: OutgoingQueue, signal: AbortSignal) {
    const result = Reflect.apply(reserve, this, [signal]);
    return ++reservations === 2 ? result.catch(error => { aborted = signal.aborted; rejected.resolve(); throw error; }) : result;
  });
  t.mock.method(f.app.agents, "command", async (...args: Parameters<typeof command>) => {
    if (args[0].op === "agent.original") { dropEntered.resolve(); await dropGate.promise; dropFinished.resolve(); return {}; }
    return Reflect.apply(command, f.app.agents, args);
  });
  void drop.request("agent.original", {}, scope); await dropEntered.promise;
  const beforeDrop = scopes.mock.callCount(); void drop.request("session-list.counts", { sessionIds: [scope.sessionId] }); await drop.barrier(); drop.ws.terminate();
  await rejected.promise; assert.equal(aborted, true); dropGate.resolve(); await dropFinished.promise; await setImmediate();
  assert.equal(scopes.mock.callCount(), beforeDrop, "disconnect cancels a queued count without reading the source");
});

test("a running counts batch yields between files so cancellation stops remaining scans", { timeout: 20000 }, async t => {
  const f = await fixture(t), scopes = Array.from({ length: 30 }, () => f.add()), requestId = randomUUID();
  const exact = f.app.agents.messageCount.bind(f.app.agents); let calls = 0;
  t.mock.method(f.app.agents, "messageCount", (...args: Parameters<typeof exact>) => {
    const result = Reflect.apply(exact, f.app.agents, args);
    if (++calls === 1) void f.request("read.cancel", { requestId });
    return result;
  });
  const event = await f.request("session-list.counts", { sessionIds: scopes.map(s => s.sessionId) }, scopes[0], requestId);
  assert.equal(event.ok, false); assert.equal(event.error?.code, "CANCELLED"); assert.ok(calls >= 1 && calls < 30, `scans before cancellation: ${calls}`);
  const stopped = calls; await setImmediate(); assert.equal(calls, stopped);
  assert.equal(accepted(await f.request("session-list.counts", { sessionIds: [scopes[0].sessionId] })).items[0].messageCount, 0);
});

for (const failed of [false, true]) test(`counts ${failed ? "failed" : "successful"} receipt holds read admission until its write callback`, { timeout: 20000 }, async t => {
  const f = await fixture(t), scope = f.add(), requestId = randomUUID(), write = WebSocket.prototype.send;
  const captured = deferred(); let release = () => {}; f.releases.push(() => release());
  t.mock.method(WebSocket.prototype, "send", function(this: WebSocket, data: any, ...args: any[]) {
    let frame: Event | undefined; try { frame = JSON.parse(String(data)); } catch { /* not an application frame */ }
    if (frame?.type === "receipt" && frame.requestId === requestId && typeof args.at(-1) === "function") {
      const done = args.at(-1); args[args.length - 1] = (...values: unknown[]) => { release = () => { release = () => {}; done(...values); }; captured.resolve(); };
    }
    return Reflect.apply(write, this, [data, ...args]);
  });
  const counts = t.mock.method(f.app.agents, "messageCount");
  const first = await f.request("session-list.counts", { sessionIds: failed ? [] : [scope.sessionId] }, scope, requestId); await captured.promise;
  assert.equal(first.ok, !failed); const before = counts.mock.callCount();
  const next = f.request("session-list.counts", { sessionIds: [scope.sessionId] }); await f.barrier();
  assert.equal(counts.mock.callCount(), before); release(); accepted(await next); assert.equal(counts.mock.callCount(), before + 1);
});
