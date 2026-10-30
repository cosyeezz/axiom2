import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import { once } from "node:events";
import { kiroNativeHttp, kiroNativeProxy } from "../src/server/providers/kiro-native-http.js";

async function listen(server: Server) {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address === "object");
  return { port: address.port, url: "http://127.0.0.1:" + address.port };
}
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
const init = () => ({ headers: new Headers({ "content-type": "application/json", "authorization": "Bearer SYNTHETIC" }), body: '{"hello":"世界"}' });

test("native proxy precedence, port-aware bypass and malformed proxy fail closed", () => {
  const target = new URL("https://runtime.us-east-1.kiro.dev/v1/responses");
  const env = { https_proxy: "http://127.0.0.1:8080", HTTPS_PROXY: "http://127.0.0.1:8081", ALL_PROXY: "http://127.0.0.1:8082" };
  assert.equal(kiroNativeProxy(target, env)?.port, "8080");
  for (const NO_PROXY of ["*", ".kiro.dev", "*.kiro.dev", "runtime.us-east-1.kiro.dev:443"])
    assert.equal(kiroNativeProxy(target, { ...env, NO_PROXY }), undefined);
  assert.equal(kiroNativeProxy(target, { ...env, NO_PROXY: "kiro.dev,runtime.us-east-1.kiro.dev:80" })?.port, "8080");
  assert.equal(kiroNativeProxy(target, { ALL_PROXY: env.ALL_PROXY })?.port, "8082");
  assert.equal(kiroNativeProxy(target, {}), undefined);
  assert.throws(() => kiroNativeProxy(target, { HTTPS_PROXY: "not-a-url" }), /未降级/);
  assert.throws(() => kiroNativeProxy(target, { HTTPS_PROXY: "socks5:\/\/127.0.0.1:1080" }), /未降级/);
});

test("native HTTP sends no fetch defaults, accurate byte length and never follows redirects", async () => {
  let requests = 0, received: Record<string, string | string[] | undefined> = {};
  const server = createServer((req, res) => { requests++; received = req.headers; res.writeHead(302, { location: "/do-not-follow" }); res.end(); });
  const { url } = await listen(server);
  try {
    const response = await kiroNativeHttp(url + "/v1/responses", init(), AbortSignal.timeout(2000), {});
    assert.equal(response.status, 302); await response.text();
    assert.equal(requests, 1);
    assert.equal(received["content-length"], String(Buffer.byteLength(init().body)));
    for (const key of ["accept", "accept-language", "accept-encoding", "sec-fetch-mode", "user-agent"]) assert.equal(received[key], undefined);
  } finally { await close(server); }
});

test("native HTTP cancellation covers headers and streaming body", async () => {
  const server = createServer((req, res) => { if (req.url === "/body") { res.writeHead(200); res.write("partial"); } });
  const { url } = await listen(server);
  try {
    await assert.rejects(kiroNativeHttp(url + "/headers", init(), AbortSignal.timeout(30), {}));
    const controller = new AbortController();
    const response = await kiroNativeHttp(url + "/body", init(), controller.signal, {});
    const reading = response.text(); controller.abort();
    await assert.rejects(reading);
  } finally { await close(server); }
});

test("native HTTP CONNECT preserves target headers and contains proxy credentials in CONNECT only", async () => {
  let connectAuth: string | undefined, targetAuth: string | undefined, proxyLeaked = false, connects = 0;
  const target = createServer((req, res) => { targetAuth = req.headers.authorization; proxyLeaked = !!req.headers["proxy-authorization"]; res.end("ok"); });
  const targetAddress = await listen(target), sockets = new Set<Duplex>();
  const proxy = createServer();
  proxy.on("connect", (req, client, head) => {
    connects++; connectAuth = req.headers["proxy-authorization"];
    if (req.url !== "127.0.0.1:" + targetAddress.port) { client.destroy(); return; }
    const upstream = connect(targetAddress.port, "127.0.0.1");
    sockets.add(client); sockets.add(upstream);
    client.on("error", () => upstream.destroy()); upstream.on("error", () => client.destroy());
    client.on("close", () => { upstream.destroy(); sockets.delete(client); });
    upstream.on("close", () => { client.destroy(); sockets.delete(upstream); });
    upstream.once("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client); client.pipe(upstream);
    });
  });
  const proxyAddress = await listen(proxy);
  try {
    const response = await kiroNativeHttp(targetAddress.url + "/v1/responses", init(), AbortSignal.timeout(2000), { HTTP_PROXY: "http://fixture:password@127.0.0.1:" + proxyAddress.port });
    assert.equal(await response.text(), "ok");
    assert.equal(connects, 1); assert.equal(connectAuth, "Basic " + Buffer.from("fixture:password").toString("base64"));
    assert.equal(targetAuth, "Bearer SYNTHETIC"); assert.equal(proxyLeaked, false);
  } finally { for (const socket of sockets) socket.destroy(); await close(proxy); await close(target); }
});
