import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { connect, scopeAuthority, scopeCurrent, scopeOrder, scopeSnapshot, subscribeScope, SESSION_CACHE_ENTRIES } from "../src/client/transport.js";
import { agentScope, threadMetadataScope, type ThreadMetadata } from "../src/shared/agent.js";
import type { Command, Scope } from "../src/shared/protocol.js";

let fixtureNumber = 0;
async function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const original = { fetch: globalThis.fetch, socket: globalThis.WebSocket, location: Object.getOwnPropertyDescriptor(globalThis, "location") };
  const sockets: Socket[] = [], releases = new Set<() => void>();
  const workspaceId = `metadata-transport-${++fixtureNumber}`, streamId = `${workspaceId}-stream`;
  let seq = 0;
  class Socket {
    static CONNECTING = 0; static OPEN = 1; static CLOSED = 3;
    readyState = Socket.CONNECTING;
    onopen?: () => void; onclose?: () => void; onmessage?: (event: { data: string }) => void;
    sent: Command[] = [];
    failedScopes = new Set<string>();
    constructor() { sockets.push(this); }
    send(value: string) {
      const frame = JSON.parse(value) as Command; this.sent.push(frame);
      if (frame.op === "subscribe" && this.failedScopes.has(String(frame.params?.scope)))
        this.receive({ type: "receipt", requestId: frame.requestId, ok: false, error: { code: "SOURCE_UNAVAILABLE", message: "source unavailable" } });
      else if (["subscribe", "unsubscribe", "ping"].includes(frame.op))
        this.receive({ type: "receipt", requestId: frame.requestId, ok: true, data: {} });
    }
    receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
    snapshot(scope: string, data: unknown, version?: number, source = streamId) {
      const current = version ?? ++seq; seq = Math.max(seq, current);
      this.receive({ type: "snapshot", scope, streamId: source, seq: current, data }); return current;
    }
    close() { if (this.readyState === Socket.CLOSED) return; this.readyState = Socket.CLOSED; this.onclose?.(); }
  }
  globalThis.fetch = async () => new Response(null, { status: 200 });
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  Object.defineProperty(globalThis, "location", { configurable: true, value: { origin: "http://127.0.0.1:4317" } });
  t.after(() => {
    for (const release of releases) release();
    sockets.at(-1)?.close(); t.mock.timers.reset();
    globalThis.fetch = original.fetch; globalThis.WebSocket = original.socket;
    if (original.location) Object.defineProperty(globalThis, "location", original.location); else Reflect.deleteProperty(globalThis, "location");
  });
  const open = async () => {
    await connect(); const socket = sockets.at(-1)!;
    socket.readyState = Socket.OPEN; socket.onopen?.(); socket.receive({ type: "hello", streamId }); return socket;
  };
  const target = (id: string): Scope => ({ workspaceId, sessionId: id });
  const key = (id: string) => threadMetadataScope(target(id));
  const watch = (scope: string, fn = () => {}) => {
    const off = subscribeScope(scope, fn);
    const release = () => { if (releases.delete(release)) off(); }; releases.add(release); return release;
  };
  return { socket: await open(), open, watch, target, key, streamId };
}
const count = (socket: { sent: Command[] }, op: string, scope: string) => socket.sent.filter(frame => frame.op === op && frame.params?.scope === scope).length;

// This tests transport delivery/cache semantics, not browser rendering or server routing.
test("metadata transport uses an independent wire and lease without fabricating empty facts", async t => {
  const h = await fixture(t), key = h.key("one");
  assert.equal(key, `thread-meta:${h.target("one").workspaceId}:one`);
  h.socket.failedScopes.add(key);
  const failed = h.watch(key); await Promise.resolve();
  assert.equal(scopeSnapshot(key), undefined); assert.equal(scopeAuthority(key), undefined);
  failed(); h.socket.failedScopes.delete(key);
  const start = h.socket.sent.length;
  let notifications = 0;
  const first = h.watch(key, () => notifications++), second = h.watch(key, () => notifications++);
  assert.deepEqual(h.socket.sent.slice(start).map(frame => [frame.op, frame.params?.scope]), [["subscribe", key]]);
  h.socket.snapshot(key, { contextRevision: 0, hasMessages: false });
  const fact = scopeSnapshot<ThreadMetadata>(key)!;
  assert.deepEqual(fact, { contextRevision: 0, hasMessages: false });
  assert.strictEqual(scopeAuthority(key), fact); assert.equal(notifications, 2);
  first(); assert.equal(count(h.socket, "unsubscribe", key), 1, "only the earlier failed lease has ended");
  assert.strictEqual(scopeAuthority(key), fact);
  second(); assert.equal(count(h.socket, "unsubscribe", key), 2);
  assert.equal(scopeAuthority(key), undefined); assert.strictEqual(scopeSnapshot(key), fact);
  const order = scopeOrder(key);
  h.socket.snapshot(key, { contextRevision: 99, hasMessages: true });
  assert.strictEqual(scopeSnapshot(key), fact); assert.equal(scopeOrder(key), order, "late detached frames are rejected");
  h.socket.failedScopes.add(key);
  const retry = h.watch(key); await Promise.resolve();
  assert.strictEqual(scopeSnapshot(key), fact); assert.equal(scopeAuthority(key), undefined, "a failed new lease cannot authorize the old cache");
  retry();
  assert.ok(h.socket.sent.every(frame => ["subscribe", "unsubscribe"].includes(frame.op) && frame.params?.scope === key), "metadata never subscribes the full thread or message collection");
});

test("metadata transport shares only equal complete data while advancing delivery and replacing changed facts", async t => {
  const h = await fixture(t), key = h.key("sharing"); let notifications = 0;
  h.watch(key, () => notifications++);
  h.socket.snapshot(key, { contextRevision: 1, hasMessages: true });
  const fact = scopeSnapshot<ThreadMetadata>(key)!, before = scopeOrder(key);
  const seq = h.socket.snapshot(key, { hasMessages: true, contextRevision: 1 });
  assert.strictEqual(scopeSnapshot(key), fact); assert.strictEqual(scopeAuthority(key), fact);
  assert.ok(scopeOrder(key) > before); assert.equal(notifications, 2);
  const order = scopeOrder(key);
  h.socket.snapshot(key, { contextRevision: 99, hasMessages: false }, seq - 1);
  assert.strictEqual(scopeSnapshot(key), fact); assert.equal(scopeOrder(key), order); assert.equal(notifications, 2);
  const changes: ThreadMetadata[] = [
    { contextRevision: 2, hasMessages: true }, { contextRevision: 2, hasMessages: false },
    { contextRevision: 2, hasMessages: null }, { contextRevision: 2, hasMessages: null, error: "unavailable" },
    { contextRevision: 2, hasMessages: null, error: "different error" }, { contextRevision: 2, hasMessages: null },
  ];
  for (const expected of changes) {
    const previous = scopeSnapshot(key), stamp = scopeOrder(key);
    const calls: number = notifications;
    h.socket.snapshot(key, expected);
    const current = scopeSnapshot<ThreadMetadata>(key)!;
    assert.notStrictEqual(current, previous); assert.deepEqual(current, expected);
    assert.equal(Object.hasOwn(current, "error"), Object.hasOwn(expected, "error"));
    assert.ok(scopeOrder(key) > stamp); assert.equal(notifications, calls + 1);
  }
  const previous = scopeSnapshot(key);
  h.socket.snapshot(key, changes.at(-1), 0, "replacement-server-stream");
  assert.notStrictEqual(scopeSnapshot(key), previous, "equal JSON from a new server stream is not structurally shared");
});

test("metadata transport renews same-seq lease and generation evidence without retaining changed read-derived data", async t => {
  const h = await fixture(t), key = h.key("authority"); let notifications = 0;
  let off = h.watch(key, () => notifications++);
  const seq = h.socket.snapshot(key, { contextRevision: 0, hasMessages: true });
  const fact = scopeAuthority(key), initial = scopeOrder(key);
  const sibling = h.watch(key); sibling(); assert.strictEqual(scopeAuthority(key), fact);
  off(); assert.equal(scopeAuthority(key), undefined); assert.equal(scopeCurrent(key), true);
  off = h.watch(key, () => notifications++); assert.equal(scopeAuthority(key), undefined);
  h.socket.snapshot(key, { contextRevision: 0, hasMessages: true }, seq);
  assert.strictEqual(scopeAuthority(key), fact); assert.ok(scopeOrder(key) > initial);
  const renewed = scopeOrder(key), calls = notifications;
  h.socket.snapshot(key, { contextRevision: 9, hasMessages: false }, seq);
  assert.strictEqual(scopeAuthority(key), fact); assert.equal(scopeOrder(key), renewed); assert.equal(notifications, calls);
  off(); h.watch(key, () => notifications++);
  h.socket.snapshot(key, { contextRevision: 1, hasMessages: false }, seq);
  assert.deepEqual(scopeAuthority(key), { contextRevision: 1, hasMessages: false }); assert.notStrictEqual(scopeAuthority(key), fact);
  const detached = scopeSnapshot(key), before = scopeOrder(key);
  h.socket.close(); assert.equal(scopeAuthority(key), undefined); assert.equal(scopeCurrent(key), false);
  const replacement = await h.open();
  assert.strictEqual(scopeSnapshot(key), detached); assert.equal(scopeAuthority(key), undefined); assert.equal(scopeCurrent(key), false);
  h.socket.snapshot(key, { contextRevision: 999, hasMessages: true });
  assert.equal(scopeOrder(key), before, "a replaced socket cannot advance cache order");
  replacement.snapshot(key, { contextRevision: 2, hasMessages: null, error: "source unavailable" }, seq);
  assert.deepEqual(scopeAuthority(key), { contextRevision: 2, hasMessages: null, error: "source unavailable" });
  assert.equal(scopeCurrent(key), true); assert.ok(scopeOrder(key) > before);
  const current = scopeAuthority(key), stamp = scopeOrder(key);
  replacement.snapshot(key, { contextRevision: 99, hasMessages: false }, seq);
  assert.strictEqual(scopeAuthority(key), current); assert.equal(scopeOrder(key), stamp);
});

test("metadata transport participates in shared session admission, active pins and detached cache eviction", async t => {
  const h = await fixture(t), keys = Array.from({ length: 5 }, (_, i) => h.key(`active-${i}`));
  const off = keys.map(key => h.watch(key));
  keys.forEach(key => h.socket.snapshot(key, { contextRevision: 0, hasMessages: false }));
  const sameSession = h.watch(agentScope(h.target("active-0")));
  const sixth = h.key("sixth"), blocked = h.watch(sixth);
  assert.equal(count(h.socket, "subscribe", sixth), 0); blocked();
  off[0](); const stillBlocked = h.watch(sixth);
  assert.equal(count(h.socket, "subscribe", sixth), 0, "another scope pins the same session until its final observer leaves"); stillBlocked();
  sameSession(); const admitted = h.watch(sixth);
  assert.equal(count(h.socket, "subscribe", sixth), 1);
  off.forEach(release => release()); admitted();
  const pinned = h.key("pinned"), releasePinned = h.watch(pinned);
  h.socket.snapshot(pinned, { contextRevision: 1, hasMessages: true });
  const pinnedFact = scopeSnapshot(pinned); assert.ok(pinnedFact);
  const victim = h.key("victim"), releaseVictim = h.watch(victim);
  h.socket.snapshot(victim, { contextRevision: 1, hasMessages: true }); assert.ok(scopeSnapshot(victim)); releaseVictim();
  for (let i = 0; i < SESSION_CACHE_ENTRIES + 2; i++) {
    const key = h.key(`churn-${i}`), release = h.watch(key);
    h.socket.snapshot(key, { contextRevision: i, hasMessages: true }); release();
  }
  assert.strictEqual(scopeSnapshot(pinned), pinnedFact); assert.equal(scopeSnapshot(victim), undefined);
  releasePinned(); assert.equal(scopeAuthority(pinned), undefined); assert.strictEqual(scopeSnapshot(pinned), pinnedFact);
});
