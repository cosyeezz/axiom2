import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, request } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { RemoteAccess } from "../src/server/remote-access.js";

test("tailnet opens HTTP and websocket directly, rejects foreign origins and automatically restores interfaces", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const upstream = createServer((req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ path: req.url, host: req.headers.host, origin: req.headers.origin, authorization: req.headers.authorization, cookie: req.headers.cookie })); });
  upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
  const port = (upstream.address() as any).port;
  const target = `http://127.0.0.1:${port}`;
  const websocket = new WebSocketServer({ server: upstream }); websocket.on("connection", (ws) => ws.on("message", (message) => ws.send(message)));
  let addresses = ["127.0.0.2"];
  const gateway = new RemoteAccess(target, () => addresses); await gateway.initialize();
  const origin = `http://127.0.0.2:${port}`;
  try {
    assert.deepEqual(gateway.status().urls, [origin + "/"]);
    assert.equal("token" in gateway.status(), false);
    const reply = await fetch(origin + "/api/status");
    assert.equal(reply.status, 200); assert.equal(reply.headers.get("set-cookie"), null);
    assert.deepEqual(await reply.json(), { path: "/api/status", host: new URL(target).host, origin: target });
    assert.equal((await fetch(origin)).status, 200);
    assert.equal((await fetch(origin + "/api/remote")).status, 403);
    for (const headers of [{ Origin: "https://evil.example" }, { "Sec-Fetch-Site": "cross-site", Origin: origin }] as Record<string, string>[]) {
      assert.equal((await fetch(origin + "/api/draft", { method: "POST", headers })).status, 403);
    }
    const rawStatus = (path: string, headers: Record<string, string> = {}) => new Promise<number>((resolve, reject) => {
      const req = request(origin, { path, headers }, (res) => { res.resume(); resolve(res.statusCode!); }); req.on("error", reject); req.end();
    });
    assert.equal(await rawStatus("/api/status", { Host: "evil.example" }), 403);
    for (const path of ["/api/./remote", "/api/x/../remote", "/api/%2e/remote"]) assert.equal(await rawStatus(path), 403);
    assert.equal(await rawStatus("http://localhost/api/remote"), 400);
    const rejected = new WebSocket(origin.replace("http", "ws") + "/ws", { origin: "https://evil.example" });
    await new Promise<void>((resolve) => { rejected.on("unexpected-response", (_req, res) => { assert.equal(res.statusCode, 403); res.resume(); rejected.terminate(); resolve(); }); rejected.on("error", () => {}); });
    const ws = new WebSocket(origin.replace("http", "ws") + "/ws", { origin }); await once(ws, "open");
    ws.send("direct-roundtrip"); const [echo] = await once(ws, "message"); assert.equal(String(echo), "direct-roundtrip");
    const interfaceClosed = once(ws, "close"); addresses = []; t.mock.timers.tick(5000); await interfaceClosed;
    assert.deepEqual(gateway.status().urls, []);
    addresses = ["127.0.0.2"]; t.mock.timers.tick(5000);
    for (let attempt = 0; attempt < 100 && !gateway.status().urls.length; attempt++) await delay(10);
    assert.deepEqual(gateway.status().urls, [origin + "/"], "restored interfaces reconnect without an enable action");
    const restored = new WebSocket(origin.replace("http", "ws") + "/ws", { origin }); await once(restored, "open");
    const closed = once(restored, "close"); await gateway.close(); await closed;
    assert.deepEqual(gateway.status().urls, []);
  } finally { await gateway.close(); for (const ws of websocket.clients) ws.terminate(); websocket.close(); await new Promise<void>((resolve) => { upstream.closeAllConnections(); upstream.close(() => resolve()); }); }
});
