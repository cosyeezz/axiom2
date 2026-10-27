import assert from "node:assert/strict";
import { test } from "node:test";
import { command, connect, scopeSnapshot, subscribeScope, verifyVisualActions } from "../src/client/transport.js";

test("visual acknowledgments preserve newer snapshots; failure and uncertainty never replay writes", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const original = { fetch: globalThis.fetch, socket: globalThis.WebSocket, location: Object.getOwnPropertyDescriptor(globalThis, "location") };
  const sockets: Socket[] = [];
  class Socket {
    static OPEN = 1; static CONNECTING = 0;
    readyState = 0;
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    sent: any[] = [];
    constructor() { sockets.push(this); }
    send(value: string) { this.sent.push(JSON.parse(value)); }
    receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
  }
  globalThis.fetch = async () => new Response(null, { status: 200 });
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  Object.defineProperty(globalThis, "location", { configurable: true, value: { origin: "http://127.0.0.1:4317" } });
  t.after(() => {
    globalThis.fetch = original.fetch; globalThis.WebSocket = original.socket;
    if (original.location) Object.defineProperty(globalThis, "location", original.location);
    else Reflect.deleteProperty(globalThis, "location");
  });
  await connect();
  const socket = sockets[0]; socket.readyState = 1; socket.onopen?.();
  socket.receive({ type: "hello", streamId: "visual" });
  const off = subscribeScope("workspaces", () => {}); t.after(off);
  let seq = 0;
  const snapshot = (name: string, pinned = false) => socket.receive({ type: "snapshot", scope: "workspaces", streamId: "visual", seq: ++seq, data: [{ id: "w", name, pinned }] });
  const name = () => scopeSnapshot<any[]>("workspaces")?.[0].name;
  const receipt = (requestId: string, ok: boolean, code = "REJECTED") => socket.receive({ type: "receipt", requestId, ok, ...(ok ? { data: {} } : { error: { code, message: code } }) });
  snapshot("Original");
  const rename = command("workspace.rename", { name: "Local" }, { workspaceId: "w" }, "rename");
  assert.equal(name(), "Local", "projection precedes dispatch");
  assert.equal(socket.sent.some(item => item.requestId === "rename"), false);
  await Promise.resolve();
  assert.equal(socket.sent.some(item => item.requestId === "rename"), true);
  snapshot("Local"); snapshot("Newer from another window", true);
  receipt("rename", true); await rename;
  assert.equal(name(), "Newer from another window", "late receipt cannot revert a newer same-field edit");
  assert.equal(scopeSnapshot<any[]>("workspaces")?.[0].pinned, true);

  const cached = command("workspace.rename", { name: "Cached" }, { workspaceId: "w" }, "cached");
  await Promise.resolve(); receipt("cached", true); await cached;
  assert.equal(name(), "Cached", "acknowledgment updates an unchanged unsubscribed cache");
  const failed = command("workspace.rename", { name: "Rejected" }, { workspaceId: "w" }, "failed");
  await Promise.resolve(); snapshot("Remote during request", false);
  receipt("failed", false); await assert.rejects(failed, /REJECTED/);
  assert.equal(name(), "Remote during request", "rollback reveals latest facts, never a captured array");

  const unknown = command("workspace.rename", { name: "Unknown" }, { workspaceId: "w" }, "unknown");
  await Promise.resolve(); receipt("unknown", false, "UNCERTAIN");
  await assert.rejects(unknown, /UNCERTAIN/);
  assert.equal(name(), "Unknown");
  snapshot("Even newer");
  const verifying = verifyVisualActions();
  const read = socket.sent.findLast(item => item.op === "request.get");
  assert.equal(read.params.requestId, "unknown");
  assert.equal(read.workspaceId, "w");
  socket.receive({ type: "receipt", requestId: read.requestId, ok: true, data: { status: "committed" } });
  await verifying;
  assert.equal(name(), "Even newer");
  assert.equal(socket.sent.filter(item => item.requestId === "unknown").length, 1, "read verification never repeats the write");
});
