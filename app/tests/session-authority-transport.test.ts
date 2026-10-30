import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { command, connect, scopeAuthority, scopeCurrent, scopeOrder, scopeSnapshot, subscribeScope, verifyVisualActions } from "../src/client/transport.js";
import { AppError, type Command, type Session } from "../src/shared/protocol.js";

let fixtureNumber = 0;
async function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const original = { fetch: globalThis.fetch, socket: globalThis.WebSocket, location: Object.getOwnPropertyDescriptor(globalThis, "location") };
  const sockets: Socket[] = [], releases = new Set<() => void>();
  const streamId = `scope-authority-${++fixtureNumber}`; let seq = 0;
  class Socket {
    static CONNECTING = 0; static OPEN = 1; static CLOSED = 3;
    readyState = Socket.CONNECTING;
    onopen?: () => void; onclose?: () => void; onmessage?: (event: { data: string }) => void;
    sent: Command[] = [];
    constructor() { sockets.push(this); }
    send(value: string) {
      const frame = JSON.parse(value) as Command; this.sent.push(frame);
      if (["subscribe", "unsubscribe", "ping"].includes(frame.op)) this.receipt(frame.requestId, {});
    }
    receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
    receipt(requestId: string, data: unknown) { this.receive({ type: "receipt", requestId, ok: true, data }); }
    fail(requestId: string, code: string) { this.receive({ type: "receipt", requestId, ok: false, error: { code, message: code } }); }
    snapshot(scope: string, data: unknown) { const current = ++seq; this.receive({ type: "snapshot", scope, streamId, seq: current, data }); return current; }
    close() { this.readyState = Socket.CLOSED; this.onclose?.(); }
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
    await connect(); const socket = sockets.at(-1)!; socket.readyState = Socket.OPEN; socket.onopen?.();
    socket.receive({ type: "hello", streamId }); return socket;
  };
  const watch = (scope: string) => {
    const off = subscribeScope(scope, () => {});
    const release = () => { off(); releases.delete(release); }; releases.add(release); return release;
  };
  const socket = await open();
  return { socket, open, watch, streamId };
}
const target = { workspaceId: "w", sessionId: "s" }, key = "session:w:s";
const session = (title = "Original"): Session => ({ id: "s", workspaceId: "w", title, pinned: false, unread: false, messageCount: 0, updatedAt: 1 });

test("scope authority preserves real null but excludes pending visual deletion", async t => {
  const h = await fixture(t); h.watch(key); assert.equal(scopeAuthority(key), undefined);
  h.socket.snapshot(key, session()); const fact = scopeAuthority<Session | null>(key)!; const order = scopeOrder(key);
  const deleting = command("session.delete", { confirmed: true }, target, "delete-failed");
  assert.equal(scopeSnapshot(key), null); assert.equal(scopeAuthority(key), fact); assert.equal(scopeOrder(key), order);
  await Promise.resolve(); h.socket.fail("delete-failed", "REJECTED"); await assert.rejects(deleting, /REJECTED/);
  assert.equal(scopeSnapshot(key), fact); assert.equal(scopeAuthority(key), fact);
  h.socket.snapshot(key, null);
  assert.equal(scopeAuthority(key), null); assert.equal(scopeSnapshot(key), null);
});

test("receipt-only merges remain legacy cache data, never new authoritative facts", async t => {
  const h = await fixture(t); h.watch(key); const seq = h.socket.snapshot(key, session());
  const rename = command("session.rename", { title: "Local" }, target, "rename-cached");
  assert.equal(scopeSnapshot<Session>(key)!.title, "Local"); assert.equal(scopeAuthority<Session>(key)!.title, "Original");
  await Promise.resolve(); h.socket.receipt("rename-cached", {}); await rename;
  assert.equal(scopeSnapshot<Session>(key)!.title, "Local"); assert.equal(scopeCurrent(key), true);
  assert.equal(scopeAuthority(key), undefined, "local receipt merge must not masquerade as a network snapshot");
  // A real replay at the old seq replaces a synthetic merge and renews evidence.
  h.socket.receive({ type: "snapshot", scope: key, streamId: h.streamId, seq, data: session("Server") });
  assert.equal(scopeAuthority<Session>(key)!.title, "Server");
  const deleting = command("session.delete", { confirmed: true }, target, "delete-cached");
  await Promise.resolve(); h.socket.receipt("delete-cached", {}); await deleting;
  assert.equal(scopeSnapshot(key), null); assert.equal(scopeAuthority(key), undefined);
  h.socket.snapshot(key, null); assert.equal(scopeAuthority(key), null);
});

test("continuous observers share authority but reactivated detached null requires a fresh delivery", async t => {
  const h = await fixture(t), first = h.watch(key); h.socket.snapshot(key, null);
  assert.equal(scopeAuthority(key), null);
  const second = h.watch(key); assert.equal(scopeAuthority(key), null);
  first(); assert.equal(scopeAuthority(key), null);
  second(); assert.equal(scopeAuthority(key), undefined); assert.equal(scopeSnapshot(key), null); assert.equal(scopeCurrent(key), true);
  h.watch(key); assert.equal(scopeAuthority(key), undefined, "old null in this connection is not a new subscription's absence proof");
  h.socket.snapshot(key, session("Restored")); assert.equal(scopeAuthority<Session>(key)!.title, "Restored");
  assert.equal(h.socket.sent.filter(frame => frame.op === "subscribe" && frame.params?.scope === key).length, 2);
});

test("old null and old positive facts cannot authorize a replacement connection", async t => {
  const h = await fixture(t), other = "session:w:other"; h.watch(key); h.watch(other);
  h.socket.snapshot(key, null); h.socket.snapshot(other, { ...session(), id: "other" });
  const order = scopeOrder(other); h.socket.close();
  assert.equal(scopeAuthority(key), undefined); assert.equal(scopeAuthority(other), undefined);
  const current = await h.open();
  assert.equal(scopeSnapshot(key), null); assert.equal(scopeSnapshot<Session>(other)!.id, "other");
  assert.equal(scopeAuthority(key), undefined); assert.equal(scopeAuthority(other), undefined);
  h.socket.snapshot(key, session("Late old socket")); assert.equal(scopeAuthority(key), undefined);
  current.snapshot(key, null); current.snapshot(other, { ...session(), id: "other" });
  assert.equal(scopeAuthority(key), null); assert.equal(scopeAuthority<Session>(other)!.id, "other");
  assert.ok(scopeOrder(other) > order);
});

test("a newer network fact survives a delayed visual acknowledgment as authority", async t => {
  const h = await fixture(t); h.watch(key); h.socket.snapshot(key, session());
  const rename = command("session.rename", { title: "Local" }, target, "rename-newer"); await Promise.resolve();
  h.socket.snapshot(key, { ...session("Remote during request"), messageCount: 2, runId: "run-2" });
  const fact = scopeAuthority<Session>(key)!; assert.equal(fact.title, "Remote during request");
  assert.equal(scopeSnapshot<Session>(key)!.title, "Local");
  h.socket.receipt("rename-newer", {}); await rename;
  assert.equal(scopeAuthority(key), fact); assert.equal(scopeSnapshot(key), fact); assert.equal(fact.runId, "run-2");
});

test("uncertain deletion stays an intent until read-only verification, without replaying writes", async t => {
  const h = await fixture(t); h.watch(key); h.socket.snapshot(key, session()); const fact = scopeAuthority(key);
  const deleting = command("session.delete", { confirmed: true }, target, "delete-uncertain");
  await Promise.resolve(); h.socket.fail("delete-uncertain", "UNCERTAIN");
  await assert.rejects(deleting, error => error instanceof AppError && error.code === "UNCERTAIN");
  assert.equal(scopeSnapshot(key), null); assert.equal(scopeAuthority(key), fact);
  const verifying = verifyVisualActions(), read = h.socket.sent.findLast(frame => frame.op === "request.get")!;
  assert.equal(read.params?.requestId, "delete-uncertain"); h.socket.receipt(read.requestId, { status: "committed" }); await verifying;
  assert.equal(scopeSnapshot(key), null); assert.equal(scopeAuthority(key), undefined);
  assert.equal(h.socket.sent.filter(frame => frame.requestId === "delete-uncertain").length, 1);
  h.socket.snapshot(key, null); assert.equal(scopeAuthority(key), null);
});

test("same-seq real replays renew detached authority but remain deduplicated within a continuous lease", async t => {
  const h = await fixture(t);
  for (const value of [null, session("Unchanged server fact")]) {
    const off = h.watch(key), seq = h.socket.snapshot(key, value), fact = scopeAuthority(key), order = scopeOrder(key);
    off(); const reentered = h.watch(key); assert.equal(scopeAuthority(key), undefined);
    const replay = { type: "snapshot", scope: key, streamId: h.streamId, seq, data: value };
    h.socket.receive(replay);
    assert.deepEqual(scopeAuthority(key), fact, `same-seq ${value === null ? "null" : "positive"} is fresh evidence for the new lease`);
    assert.ok(scopeOrder(key) > order);
    const renewed = scopeOrder(key); h.socket.receive(replay);
    assert.equal(scopeOrder(key), renewed, "same-seq duplicates within the uninterrupted lease still do not notify");
    // End this lease before checking the other data shape.
    reentered();
  }
});

test("distinct message observers keep their shared wire authority until the final observer leaves", async t => {
  const h = await fixture(t), first = "message:w:s:one", second = "message:w:s:two", wire = "messages:w:s";
  const offFirst = h.watch(first);
  h.socket.snapshot(wire, [{ id: "one", role: "user", text: "first" }, { id: "two", role: "assistant", text: "second" }]);
  const fact = scopeAuthority(second); assert.ok(fact);
  const offSecond = h.watch(second); assert.equal(scopeAuthority(second), fact);
  offFirst(); assert.equal(scopeAuthority(second), fact);
  offSecond(); assert.equal(scopeAuthority(first), undefined); assert.equal(scopeAuthority(second), undefined);
  assert.equal(h.socket.sent.filter(frame => frame.op === "subscribe" && frame.params?.scope === wire).length, 1);
  assert.equal(h.socket.sent.filter(frame => frame.op === "unsubscribe" && frame.params?.scope === wire).length, 1);
});

test("same-seq renewal retains new read-derived metadata, not only a fresh stamp on old data", async t => {
  const h = await fixture(t), off = h.watch(key), seq = h.socket.snapshot(key, session());
  off(); h.watch(key);
  h.socket.receive({ type: "snapshot", scope: key, streamId: h.streamId, seq, data: { ...session(), messageCount: undefined } });
  const renewed = scopeAuthority<Session>(key); assert.ok(renewed);
  assert.equal(renewed.messageCount, undefined, "count invalidation must not preserve the old known zero");
  h.socket.close(); const current = await h.open(); assert.equal(scopeAuthority(key), undefined);
  current.receive({ type: "snapshot", scope: key, streamId: h.streamId, seq, data: { ...session(), messageCount: 3 } });
  assert.equal(scopeAuthority<Session>(key)?.messageCount, 3, "a replacement connection must use the newly read count too");
});
