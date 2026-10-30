import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import WebSocket from "ws";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { AgentViews } from "../src/server/agents/views.js";
import { startServer } from "../src/server/index.js";
import { OutgoingQueue } from "../src/server/outgoing.js";
import { RemoteAccess } from "../src/server/remote-access.js";
import { threadMetadataScope, threadScope, type ChatMessage, type ThreadIndex, type ThreadMetadata } from "../src/shared/agent.js";
import { AppError, type Scope, type Workspace } from "../src/shared/protocol.js";

interface Packet {
  type: string; scope?: string; requestId?: string; ok?: boolean; seq?: number; data?: unknown;
  error?: { code: string; message: string }; thread?: unknown;
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "axiom-thread-metadata-wire-")), previous = process.env.AXIOM_PI_DIR;
  const pi = join(root, "pi"); mkdirSync(pi);
  writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: {} })); writeFileSync(join(pi, "auth.json"), "{}");
  process.env.AXIOM_PI_DIR = pi;
  t.mock.method(RemoteAccess.prototype, "initialize", async () => {});
  let app: Awaited<ReturnType<typeof startServer>> | undefined, updateFetches = 0;
  const sockets = new Set<WebSocket>(), releases: (() => void)[] = [];
  t.after(async () => {
    releases.forEach(release => release());
    for (const ws of sockets) ws.terminate();
    try { await app?.close(); }
    finally {
      if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
      rmSync(root, { recursive: true, force: true });
    }
    assert.equal(updateFetches, 0, "the isolated backend must never check updates externally");
  });
  const server = app = await startServer({ root: join(root, "data"), port: 0,
    backendUpdates: { initialDelayMs: 3_600_000, fetcher: async () => { updateFetches++; throw Error("external updates disabled in metadata fixture"); } } });
  const workspace = (name: string) => {
    const path = join(root, name); mkdirSync(path);
    return server.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path, authorized: true } }) as Workspace;
  };
  const main = workspace("main"), foreign = workspace("foreign");
  const add = (file?: string): Scope => {
    const sessionId = randomUUID();
    server.store.db.prepare("INSERT INTO sessions(id,workspaceId,title,pinned,updatedAt) VALUES(?,?,?,0,1)").run(sessionId, main.id, "synthetic metadata session");
    if (file) server.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(sessionId, file);
    return { workspaceId: main.id, sessionId };
  };
  const connect = async () => {
    const ws = new WebSocket(server.origin.replace("http", "ws") + "/ws", { origin: server.origin }); sockets.add(ws);
    const events: Packet[] = [];
    const pending = new Map<string, { resolve: (packet: Packet) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
    ws.on("message", raw => {
      const packet = JSON.parse(raw.toString()) as Packet; events.push(packet);
      if (packet.type === "receipt") {
        const entry = pending.get(packet.requestId!); if (entry) { clearTimeout(entry.timer); pending.delete(packet.requestId!); entry.resolve(packet); }
      }
    });
    ws.on("close", () => {
      sockets.delete(ws);
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(Error("fixture socket closed")); }
      pending.clear();
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { ws.terminate(); reject(Error("fixture socket open timeout")); }, 10_000);
      ws.once("open", () => { clearTimeout(timer); resolve(); }); ws.once("error", error => { clearTimeout(timer); reject(error); });
    });
    const request = (op: string, params: Record<string, unknown> = {}, scope: Partial<Scope> = {}, requestId = randomUUID()) => {
      assert.ok(["subscribe", "unsubscribe", "ping", "read.cancel", "agent.original"].includes(op), `unexpected fixture operation ${op}`);
      const promise = new Promise<Packet>((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(requestId); reject(Error(`fixture request timeout: ${op}`)); }, 10_000);
        pending.set(requestId, { resolve, reject, timer }); ws.send(JSON.stringify({ op, requestId, params, ...scope }));
      });
      void promise.catch(() => {}); // Cleanup may close a deliberately abandoned request; explicit awaits still reject.
      return promise;
    };
    const barrier = () => new Promise<void>(resolve => { ws.once("pong", () => resolve()); ws.ping(); });
    return { ws, events, request, barrier };
  };
  return { root, app: server, main, foreign, add, connect, releases, ...await connect() };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const snapshots = (events: Packet[], scope: string) => events.filter(event => event.type === "snapshot" && event.scope === scope);
function accepted(packet: Packet) { assert.equal(packet.ok, true, JSON.stringify(packet)); return packet.data; }
function metadata(events: Packet[], scope: string) {
  const frame = snapshots(events, scope).at(-1); assert.ok(frame); assert.equal(typeof frame.seq, "number");
  assert.ok(frame.data && typeof frame.data === "object");
  const data = frame.data as ThreadMetadata;
  assert.deepEqual(Object.keys(data).sort(), ["contextRevision", "hasMessages", ...(Object.hasOwn(data, "error") ? ["error"] : [])].sort());
  assert.equal(typeof data.contextRevision, "number"); assert.ok(data.hasMessages === null || typeof data.hasMessages === "boolean");
  if (Object.hasOwn(data, "error")) { assert.equal(typeof data.error, "string"); assert.ok(data.error!.length <= 512); }
  assert.equal(Object.hasOwn(frame, "thread"), false, "metadata has no attached full ThreadIndex");
  return { frame, data };
}
function onlyMetadata(events: Packet[]) {
  for (const frame of events.filter(event => event.type === "snapshot")) {
    assert.ok(frame.scope?.startsWith("thread-meta:"), `unexpected body/full-thread frame ${frame.scope}`); metadata([frame], frame.scope!);
  }
}
function observe(t: TestContext) {
  const original = AgentViews.prototype.threadMetadata; let view: AgentViews | undefined;
  const spy = t.mock.method(AgentViews.prototype, "threadMetadata", function(this: AgentViews, scope: Scope) {
    view = this; return original.call(this, scope);
  });
  return { spy, view: () => { assert.ok(view); return view; } };
}
function bodyGuards(t: TestContext, f: Fixture) {
  const reject = () => { throw Error("metadata must not request full thread or message bodies"); };
  return [t.mock.method(f.app.agents, "thread", reject), t.mock.method(f.app.agents, "messages", reject),
    t.mock.method(f.app.agents, "message", reject), t.mock.method(AgentViews.prototype, "thread", reject)];
}
function database(f: Fixture) {
  return Object.fromEntries(["requests", "runs", "tasks", "sessions", "agent_sessions"].map(table =>
    [table, f.app.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}
function source(file: string) {
  const { dev, ino, size, mtimeNs, ctimeNs } = statSync(file, { bigint: true });
  return { bytes: readFileSync(file), stat: { dev, ino, size, mtimeNs, ctimeNs } };
}
const assistant = (text: string) => ({
  role: "assistant" as const, content: [{ type: "text" as const, text }], api: "openai-completions" as const,
  provider: "synthetic", model: "synthetic-model", stopReason: "stop" as const, timestamp: 100,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});

test("metadata-only cold subscriptions are narrow read-only projections; explicit legacy reads remain complete", { timeout: 25_000 }, async t => {
  const f = await fixture(t), manager = SessionManager.create(f.main.path, join(f.root, "native"));
  for (let i = 0; i < 20; i++) manager.appendMessage({ role: "user", content: `private-body-${i}:` + "x".repeat(1024), timestamp: i + 1 });
  manager.appendMessage(assistant("synthetic answer")); const file = manager.getSessionFile(); assert.ok(file && existsSync(file));
  const scope = f.add(file), empty = f.add(), key = threadMetadataScope(scope), emptyKey = threadMetadataScope(empty);
  const before = database(f), native = source(file), guards = bodyGuards(t, f), capture = observe(t);
  const parser = t.mock.method(SessionManager, "inMemory");
  accepted(await f.request("subscribe", { scope: key })); accepted(await f.request("subscribe", { scope: emptyKey }));
  assert.deepEqual(metadata(f.events, key).data, { contextRevision: 0, hasMessages: true });
  assert.deepEqual(metadata(f.events, emptyKey).data, { contextRevision: 0, hasMessages: false });
  assert.ok(Buffer.byteLength(JSON.stringify(metadata(f.events, key).data)) < 100);
  assert.ok(parser.mock.callCount() > 0, "the cold path actually parses the synthetic native source, rather than a fake metadata return");
  assert.equal(capture.spy.mock.callCount(), 2); assert.ok(guards.every(guard => guard.mock.callCount() === 0));
  onlyMetadata(f.events); assert.deepEqual(database(f), before); assert.deepEqual(source(file), native);
  guards.forEach(guard => guard.mock.restore());
  accepted(await f.request("subscribe", { scope: threadScope(scope) }));
  accepted(await f.request("subscribe", { scope: `messages:${scope.workspaceId}:${scope.sessionId}` }));
  const legacy = snapshots(f.events, threadScope(scope)).at(-1)!.data as ThreadIndex;
  const bodies = snapshots(f.events, `messages:${scope.workspaceId}:${scope.sessionId}`).at(-1)!.data as ChatMessage[];
  assert.equal(legacy.ids.length, 21); assert.ok(legacy.groups); assert.ok(legacy.groups.length > 0); assert.equal(bodies.length, 21);
  assert.ok(bodies.some(message => message.text?.startsWith("private-body-0:")));
  assert.deepEqual(database(f), before); assert.deepEqual(source(file), native);
});

test("metadata scope rejects invalid owners but reports owned source failures as bounded unknown facts", { timeout: 25_000 }, async t => {
  const f = await fixture(t), scope = f.add(), deleted = f.add(), missing = join(f.root, "missing.jsonl"), bad = f.add(missing);
  f.app.store.db.prepare("UPDATE sessions SET deletedAt=1 WHERE id=?").run(deleted.sessionId);
  let longError = false;
  const original = AgentViews.prototype.transcript;
  const transcript = t.mock.method(AgentViews.prototype, "transcript", function(this: AgentViews, target: Scope) {
    if (longError && target.sessionId === bad.sessionId) throw Error("\0".repeat(20_000));
    return original.call(this, target);
  });
  const before = database(f), guards = bodyGuards(t, f);
  for (const target of [{ ...scope, workspaceId: f.foreign.id }, { ...scope, sessionId: randomUUID() }, deleted]) {
    const key = threadMetadataScope(target), receipt = await f.request("subscribe", { scope: key });
    assert.equal(receipt.ok, false); assert.equal(receipt.error?.code, "SCOPE_MISMATCH"); assert.equal(snapshots(f.events, key).length, 0);
  }
  const malformed = await f.request("subscribe", { scope: threadMetadataScope(scope) + ":extra" });
  assert.equal(malformed.ok, false); assert.equal(malformed.error?.code, "INVALID_SCOPE");
  assert.equal(transcript.mock.callCount(), 0, "ownership is checked outside the supply error fallback");
  const key = threadMetadataScope(bad); accepted(await f.request("subscribe", { scope: key }));
  const unavailable = metadata(f.events, key).data;
  assert.equal(unavailable.hasMessages, null); assert.ok(unavailable.error); assert.equal(existsSync(missing), false);
  longError = true; f.app.agents.refresh(bad); accepted(await f.request("ping"));
  const bounded = metadata(f.events, key).data;
  assert.equal(bounded.hasMessages, null); assert.ok(bounded.error); assert.equal(bounded.error.length, 512); assert.ok(bounded.error.endsWith("..."));
  assert.ok(Buffer.byteLength(JSON.stringify(bounded)) < 4096); assert.equal(existsSync(missing), false);
  assert.ok(guards.every(guard => guard.mock.callCount() === 0)); onlyMetadata(f.events); assert.deepEqual(database(f), before);
});

test("metadata-only observers receive fresh presence, delivery revision and refresh without body delta noise", { timeout: 25_000 }, async t => {
  const f = await fixture(t), scope = f.add(), sibling = f.add(), key = threadMetadataScope(scope), siblingKey = threadMetadataScope(sibling);
  const other = await f.connect(), passive = await f.connect(), capture = observe(t), guards = bodyGuards(t, f), before = database(f);
  accepted(await f.request("subscribe", { scope: key })); accepted(await other.request("subscribe", { scope: siblingKey }));
  const view = capture.view(); assert.strictEqual(view.store, f.app.store);
  const initial = metadata(f.events, key); assert.equal(initial.data.hasMessages, false);
  view.messageChanged(scope, { id: "tool-only", role: "toolResult", text: "tool output" }); view.flush(scope); accepted(await f.request("ping"));
  const fresh = metadata(f.events, key); assert.equal(fresh.data.hasMessages, true); assert.ok(fresh.frame.seq! > initial.frame.seq!);
  assert.equal(f.app.agents.messageCount(scope, { cachedOnly: true }), 0, "tool-only presence is not a title count");
  const count = snapshots(f.events, key).length;
  view.messageChanged(scope, { id: "tool-only", role: "toolResult", text: "more tool output" }); view.flush(scope); accepted(await f.request("ping"));
  assert.equal(snapshots(f.events, key).length, count, "body-only deltas do not republish unchanged metadata");
  const draft: ChatMessage = { id: "reply", role: "assistant", text: "draft", phase: "final_answer", status: "running", streaming: true };
  view.messageChanged(scope, draft); view.flush(scope); accepted(await f.request("ping"));
  const running = metadata(f.events, key);
  view.messageChanged(scope, { ...draft, text: "delivered", status: "completed", streaming: false }); view.flush(scope); accepted(await f.request("ping"));
  const delivered = metadata(f.events, key); assert.equal(delivered.data.contextRevision, running.data.contextRevision + 1); assert.ok(delivered.frame.seq! > running.frame.seq!);
  f.app.agents.refresh(scope); accepted(await f.request("ping"));
  const refreshed = metadata(f.events, key); assert.equal(refreshed.data.contextRevision, delivered.data.contextRevision + 1); assert.equal(refreshed.data.hasMessages, false);
  accepted(await other.request("ping")); accepted(await passive.request("ping"));
  assert.equal(snapshots(other.events, siblingKey).length, 1); assert.equal(snapshots(other.events, key).length, 0);
  assert.equal(passive.events.filter(event => event.type === "snapshot").length, 0);
  assert.ok(guards.every(guard => guard.mock.callCount() === 0)); onlyMetadata(f.events); onlyMetadata(other.events); assert.deepEqual(database(f), before);
});

test("queued metadata subscriptions honor read admission and both read.cancel and unsubscribe cancellation", { timeout: 25_000 }, async t => {
  const f = await fixture(t), scope = f.add(), other = f.add(), capture = observe(t), gate = deferred(), entered = deferred(); f.releases.push(gate.resolve);
  const command = f.app.agents.command.bind(f.app.agents);
  t.mock.method(f.app.agents, "command", async (...args: Parameters<typeof command>) => {
    if (args[0].op === "agent.original") { entered.resolve(); await gate.promise; return {}; }
    return Reflect.apply(command, f.app.agents, args);
  });
  const busy = f.request("agent.original", {}, scope); await entered.promise;
  const reads = [scope, other].map(target => {
    const id = randomUUID(), key = threadMetadataScope(target); let settled = false;
    const receipt = f.request("subscribe", { scope: key }, {}, id).then(value => { settled = true; return value; });
    void receipt.catch(() => {});
    return { id, key, receipt, settled: () => settled };
  });
  await f.barrier(); assert.ok(reads.every(read => !read.settled())); assert.equal(capture.spy.mock.callCount(), 0);
  accepted(await f.request("read.cancel", { requestId: reads[0].id })); accepted(await f.request("unsubscribe", { scope: reads[1].key }));
  gate.resolve(); accepted(await busy);
  for (const read of reads) {
    const receipt = await read.receipt; assert.equal(receipt.ok, true); assert.deepEqual(receipt.data, { superseded: true });
    assert.equal(snapshots(f.events, read.key).length, 0);
  }
  assert.equal(capture.spy.mock.callCount(), 0);
  accepted(await f.request("subscribe", { scope: reads[0].key })); assert.equal(capture.spy.mock.callCount(), 1); metadata(f.events, reads[0].key);
});

test("server disconnect aborts queued metadata before materialization and leaves new connections usable", { timeout: 25_000 }, async t => {
  const f = await fixture(t), scope = f.add(), capture = observe(t), entered = deferred(), gate = deferred(), finished = deferred(), rejected = deferred(); f.releases.push(gate.resolve);
  const command = f.app.agents.command.bind(f.app.agents);
  t.mock.method(f.app.agents, "command", async (...args: Parameters<typeof command>) => {
    if (args[0].op === "agent.original") { entered.resolve(); await gate.promise; finished.resolve(); return {}; }
    return Reflect.apply(command, f.app.agents, args);
  });
  const reserve = OutgoingQueue.prototype.reserveRead; let reservations = 0, aborted = false;
  t.mock.method(OutgoingQueue.prototype, "reserveRead", function(this: OutgoingQueue, signal: AbortSignal) {
    const result = reserve.call(this, signal);
    return ++reservations === 2 ? result.catch(error => { aborted = signal.aborted; rejected.resolve(); throw error; }) : result;
  });
  const drop = await f.connect(); void drop.request("agent.original", {}, scope); await entered.promise;
  void drop.request("subscribe", { scope: threadMetadataScope(scope) }); await drop.barrier(); drop.ws.terminate();
  await rejected.promise; assert.equal(aborted, true, "observe the server abort, not only the client's local close");
  gate.resolve(); await finished.promise; await setImmediate(); assert.equal(capture.spy.mock.callCount(), 0);
  const replacement = await f.connect(); accepted(await replacement.request("subscribe", { scope: threadMetadataScope(scope) }));
  assert.equal(capture.spy.mock.callCount(), 1); metadata(replacement.events, threadMetadataScope(scope));
});

for (const failed of [false, true]) test(`a ${failed ? "failed " : ""}metadata subscription retains admission until its receipt write callback completes`, { timeout: 25_000 }, async t => {
  const f = await fixture(t), first = f.add(), second = f.add(), id = randomUUID(), original = AgentViews.prototype.threadMetadata;
  let attempts = 0;
  const supply = t.mock.method(AgentViews.prototype, "threadMetadata", function(this: AgentViews, scope: Scope) {
    if (++attempts === 1 && failed) throw new AppError("METADATA_UNAVAILABLE", "metadata unavailable");
    return original.call(this, scope);
  });
  const write = WebSocket.prototype.send, captured = deferred(); let release = () => {}; f.releases.push(() => release());
  t.mock.method(WebSocket.prototype, "send", function(this: WebSocket, data: Parameters<typeof write>[0], ...args: unknown[]) {
    let packet: Packet | undefined; try { packet = JSON.parse(String(data)) as Packet; } catch { /* control/binary data is not an application packet */ }
    const callback = args.at(-1);
    if (packet?.type === "receipt" && packet.requestId === id && typeof callback === "function")
      args[args.length - 1] = (...values: unknown[]) => { release = () => { release = () => {}; callback(...values); }; captured.resolve(); };
    return Reflect.apply(write, this, [data, ...args]);
  });
  const receipt = await f.request("subscribe", { scope: threadMetadataScope(first) }, {}, id); await captured.promise;
  assert.equal(receipt.ok, !failed);
  if (failed) { assert.equal(receipt.error?.code, "METADATA_UNAVAILABLE"); assert.equal(snapshots(f.events, threadMetadataScope(first)).length, 0); }
  else metadata(f.events, threadMetadataScope(first));
  const before = supply.mock.callCount(), next = f.request("subscribe", { scope: threadMetadataScope(second) }); await f.barrier();
  assert.equal(supply.mock.callCount(), before, "receiving the receipt is not the server's write-completion fence");
  release(); accepted(await next); assert.equal(supply.mock.callCount(), before + 1); metadata(f.events, threadMetadataScope(second));
});
