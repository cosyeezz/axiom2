import assert from "node:assert/strict";
import { test } from "node:test";
import { command, connect, connectionHealth, scopeSnapshot } from "../src/client/transport.js";

test("connection evidence expires independently of errors and rejects obsolete socket events", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const original = { fetch: globalThis.fetch, socket: globalThis.WebSocket, location: Object.getOwnPropertyDescriptor(globalThis, "location") };
  const sockets: Socket[] = [];
  class Socket {
    static OPEN = 1; static CONNECTING = 0;
    readyState = 0;
    onopen?: () => void;
    onclose?: () => void;
    onmessage?: (e: { data: string }) => void;
    sent: any[] = [];
    constructor() { sockets.push(this); }
    send(data: string) { this.sent.push(JSON.parse(data)); }
    open() { this.readyState = 1; this.onopen?.(); }
    close() { this.readyState = 3; this.onclose?.(); }
    receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
  }
  let release!: (response: Response) => void;
  let fetches = 0;
  globalThis.fetch = (() => { fetches++; return new Promise<Response>((resolve) => { release = resolve; }); }) as typeof fetch;
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  Object.defineProperty(globalThis, "location", { configurable: true, value: { origin: "http://127.0.0.1:4317" } });
  t.after(() => {
    globalThis.fetch = original.fetch; globalThis.WebSocket = original.socket;
    if (original.location) Object.defineProperty(globalThis, "location", original.location);
    else Reflect.deleteProperty(globalThis, "location");
  });
  const opening = connect();
  await connect();
  assert.equal(fetches, 1, "concurrent connect must not create competing fetches");
  release({ ok: true } as Response); await opening;
  const first = sockets[0]; first.open();
  assert.equal(connectionHealth(), "checking", "OPEN without a server response is not green");
  first.receive({ type: "hello", streamId: "first-server" });
  assert.equal(connectionHealth(), "connected");
  const failed = command("subscribe", { scope: "invalid" }, {}, "subscription");
  first.receive({ type: "receipt", requestId: "subscription", ok: false, error: { code: "INVALID_SCOPE", message: "bad scope" } });
  await assert.rejects(failed, /bad scope/);
  assert.equal(connectionHealth(), "connected", "a business error confirms a live connection");
  t.mock.timers.tick(15_001);
  assert.equal(connectionHealth(), "checking", "stale evidence must not remain green");
  first.receive({ type: "hello", streamId: "first-server" });
  assert.equal(connectionHealth(), "connected");
  assert.equal(connectionHealth(0), "checking", "a clock moving backwards cannot renew evidence");
  const uncertain = command("prompt", {}, {}, "not-replayed");
  const rejected = assert.rejects(uncertain, /连接中断/);
  first.close(); await rejected;
  assert.equal(connectionHealth(), "disconnected");
  const reopening = connect(); release({ ok: true } as Response); await reopening;
  const second = sockets[1]; second.open(); second.receive({ type: "hello", streamId: "second-server" });
  const pending = command<string>("ping", {}, {}, "current-request");
  let settled = false; void pending.then(() => { settled = true; });
  first.onopen?.(); first.onclose?.();
  first.receive({ type: "receipt", requestId: "current-request", ok: true, data: "obsolete" });
  first.receive({ type: "snapshot", scope: "workspaces", streamId: "first-server", seq: 999, data: ["obsolete"] });
  await Promise.resolve();
  assert.equal(settled, false, "old events must not resolve or reject new pending work");
  assert.equal(scopeSnapshot("workspaces"), undefined, "old snapshots cannot contaminate new-generation cache");
  assert.equal(connectionHealth(), "connected", "old close cannot overwrite a recovered connection");
  second.receive({ type: "receipt", requestId: "current-request", ok: true, data: "current" });
  assert.equal(await pending, "current");
  await connect();
  assert.equal(sockets.length, 2);
  assert.ok(!second.sent.some((request) => request.op === "prompt"), "reconnect never resends an operation");
});
