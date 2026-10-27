import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import WebSocket from "ws";
import { startServer } from "../src/server/index.js";

test("global backend-update WS scope uses real scheduler, atomic per-version receipts and restart persistence", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "axiom-updates-ws-"));
  const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi"); await mkdir(process.env.AXIOM_PI_DIR);
  const sockets: WebSocket[] = []; let app: Awaited<ReturnType<typeof startServer>> | undefined;
  let latest = "0.4.19", checks = 0;
  const backendUpdates = { version: "0.4.10", initialDelayMs: 1, intervalMs: 60_000, fetcher: async () => {
    checks++; return Response.json({ tag_name: `v${latest}`, assets: [{ name: "axiom2.tgz", browser_download_url: `https://github.com/cosyeezz/axiom2/releases/download/v${latest}/axiom2.tgz`, size: 1234, digest: `sha256:${"a".repeat(64)}` }] });
  } };
  async function connect() {
    const ws = new WebSocket(app!.origin.replace("http", "ws") + "/ws", { origin: app!.origin }); sockets.push(ws);
    const events: any[] = []; ws.on("message", raw => events.push(JSON.parse(raw.toString()))); await once(ws, "open");
    return { ws, events, call: (op: string, params: unknown = {}) => new Promise<any>((resolve, reject) => {
      const requestId = randomUUID(); const timeout = setTimeout(() => { ws.off("message", receive); reject(Error(`receipt timeout: ${op}`)); }, 5000);
      function receive(raw: WebSocket.RawData) { const value = JSON.parse(raw.toString()); if (value.requestId !== requestId) return; clearTimeout(timeout); ws.off("message", receive); value.ok ? resolve(value.data) : reject(Object.assign(Error(value.error.message), { code: value.error.code })); }
      ws.on("message", receive); ws.send(JSON.stringify({ requestId, op, params }));
    }) };
  }
  try {
    app = await startServer({ root, port: 0, backendUpdates });
    const a = await connect(), b = await connect();
    await a.call("subscribe", { scope: "backend-updates" });
    const until = Date.now() + 5000;
    let state = await a.call("backendUpdates.get");
    while (!state.pending && Date.now() < until) { await new Promise(resolve => setTimeout(resolve, 5)); state = await a.call("backendUpdates.get"); }
    assert.ok(checks >= 1, "the server checks itself without a client check command"); assert.equal(state.runningVersion, "0.4.10"); assert.equal(state.latest.version, latest); assert.equal(state.pending, true);
    assert.ok(a.events.some(event => event.type === "snapshot" && event.scope === "backend-updates" && event.data.runningVersion === "0.4.10"));
    const claims = await Promise.all([a.call("backendUpdates.present", { version: latest }), b.call("backendUpdates.present", { version: latest })]);
    assert.equal(claims.filter(value => value.notice === latest).length, 1);
    await b.call("backendUpdates.dismiss", { version: latest });
    await assert.rejects(a.call("backendUpdates.install", { version: latest }), { code: "INVALID_COMMAND" });
    assert.equal(app.store.db.prepare("SELECT COUNT(*) AS n FROM requests").get()!.n, 0, "version notices are not chat read/task receipts");
    for (const socket of sockets) socket.terminate(); await app.close(); app = undefined;
    app = await startServer({ root, port: 0, backendUpdates: { ...backendUpdates, initialDelayMs: 60_000 } });
    const c = await connect(); assert.equal((await c.call("backendUpdates.get")).pending, false);
    assert.equal((await c.call("backendUpdates.present", { version: latest })).notice, null);
    latest = "0.4.20"; const fresh = await c.call("backendUpdates.check");
    assert.equal(fresh.latest.version, latest); assert.equal(fresh.pending, true);
    assert.equal((await c.call("backendUpdates.present", { version: latest })).notice, latest);
  } finally {
    for (const socket of sockets) socket.terminate(); await app?.close(); await rm(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  }
});
