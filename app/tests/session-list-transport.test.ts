import assert from "node:assert/strict";
import test from "node:test";
import { command, connect } from "../src/client/transport.js";
import { AppError } from "../src/shared/protocol.js";

test("list and window reads send cancellation on abort and timeout only to their originating current socket", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const original = { fetch: globalThis.fetch, socket: globalThis.WebSocket, location: Object.getOwnPropertyDescriptor(globalThis, "location") };
  const sockets: Socket[] = [];
  class Socket {
    static CONNECTING = 0; static OPEN = 1; static CLOSED = 3;
    readyState = Socket.CONNECTING;
    onopen?: () => void;
    onclose?: () => void;
    onmessage?: (event: { data: string }) => void;
    sent: { op: string; requestId: string; params: { requestId?: string } }[] = [];
    constructor() { sockets.push(this); }
    send(value: string) { this.sent.push(JSON.parse(value)); }
    receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
    close() { this.readyState = Socket.CLOSED; this.onclose?.(); }
  }
  globalThis.fetch = async () => new Response(null, { status: 200 });
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  Object.defineProperty(globalThis, "location", { configurable: true, value: { origin: "http://127.0.0.1:4317" } });
  t.after(() => {
    sockets.at(-1)?.close();
    t.mock.timers.reset();
    globalThis.fetch = original.fetch; globalThis.WebSocket = original.socket;
    if (original.location) Object.defineProperty(globalThis, "location", original.location);
    else Reflect.deleteProperty(globalThis, "location");
  });
  const open = async () => {
    await connect();
    const socket = sockets.at(-1)!; socket.readyState = Socket.OPEN; socket.onopen?.();
    socket.receive({ type: "hello", streamId: "list-transport" });
    return socket;
  };
  const rejected = (promise: Promise<unknown>, code: string) => assert.rejects(promise, error => error instanceof AppError && error.code === code);
  const receipt = (socket: Socket, requestId: string, data: unknown) => socket.receive({ type: "receipt", requestId, ok: true, data });
  const target = { workspaceId: "synthetic-workspace" }, params = { group: "workspace" };
  const socket = await open();

  for (const op of ["session-list.page", "session-list.initial", "session-list.first", "session-list.counts", "agent.window", "task.window"]) {
    const pre = new AbortController(); pre.abort();
    const before = socket.sent.length;
    await rejected(command(op, params, target, `pre-${op}`, pre.signal), "CANCELLED");
    assert.equal(socket.sent.length, before, `${op}: a pre-aborted read sends no frame`);

    const abort = new AbortController(), id = `abort-${op}`;
    const reading = command(op, params, target, id, abort.signal);
    assert.equal(socket.sent.at(-1)?.op, op);
    abort.abort(); await rejected(reading, "CANCELLED");
    assert.equal(socket.sent.filter(frame => frame.op === "read.cancel" && frame.params.requestId === id).length, 1);
    receipt(socket, id, { late: true }); // A cancelled request cannot be revived by a late receipt.

    const timeoutId = `timeout-${op}`;
    const timedOut = rejected(command(op, params, target, timeoutId), "UNCERTAIN");
    t.mock.timers.tick(15000); await timedOut;
    assert.equal(socket.sent.filter(frame => frame.op === "read.cancel" && frame.params.requestId === timeoutId).length, 1);
  }
  const cancels = socket.sent.filter(frame => frame.op === "read.cancel").length;
  assert.equal(cancels, 12);
  const done = new AbortController(), complete = command("session-list.first", {}, target, "complete", done.signal);
  receipt(socket, "complete", null); assert.equal(await complete, null); done.abort();
  assert.equal(socket.sent.filter(frame => frame.op === "read.cancel").length, cancels, "a completed read removes its abort listener");

  const old = new AbortController(), oldRead = command("session-list.page", params, target, "old-request", old.signal);
  const oldRejected = rejected(oldRead, "CANCELLED");
  // Reconnect before the old socket's delayed close/receipt arrives.
  socket.readyState = Socket.CLOSED;
  const current = await open(); assert.notEqual(current, socket);
  const currentRead = command("session-list.first", {}, target, "current-request");
  const oldFrames = socket.sent.length;
  socket.onclose?.(); receipt(socket, "old-request", { stale: true }); old.abort(); await oldRejected;
  assert.equal(socket.sent.length, oldFrames);
  assert.equal(current.sent.some(frame => frame.op === "read.cancel"), false, "an old request must not cancel anything on a replacement socket");
  receipt(current, "current-request", { current: true }); assert.deepEqual(await currentRead, { current: true });

  const closed = new AbortController(), closedRead = command("session-list.initial", {}, target, "closed-request", closed.signal);
  current.readyState = Socket.CLOSED; const frames = current.sent.length;
  closed.abort(); await rejected(closedRead, "CANCELLED");
  assert.equal(current.sent.length, frames, "a read cannot send cancellation to a closed originating socket");
});
