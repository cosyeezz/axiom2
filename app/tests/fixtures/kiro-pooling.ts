// Local-only HTTPS fixture. The committed key is PUBLIC TEST DATA, not a credential.
import assert from "node:assert/strict";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createHttpServer } from "node:http";
import { createSecureServer } from "node:http2";
import { connect, type AddressInfo, type Socket } from "node:net";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { getGlobalDispatcher } from "undici";
import { createModels, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { configureModelNetwork } from "../../src/server/integrations/model-proxy-env.js";
import { kiroProvider } from "../../src/server/providers/kiro.js";
import { fetchKiroCatalog } from "../../src/server/providers/kiro-catalog.js";
import { kiroFrame } from "./kiro-eventstream.js";

const mode = process.argv[2], proxied = mode === "kiro-proxy", h2 = mode === "kiro-h2";
const root = mkdtempSync(join(tmpdir(), "axiom-kiro-pooling-")), modelsFile = join(root, "models.json");
const sockets = new Set<Socket>(), sessions = new Set<any>();
let tlsHandshakes = 0, connects = 0, hint = false, closePeer = false, rejectProxy = false;
const frame = kiroFrame("assistantResponseEvent", { content: "local pool success" });
const tls = { key: readFileSync(new URL("./kiro-pooling-key.pem", import.meta.url)), cert: readFileSync(new URL("./kiro-pooling-cert.pem", import.meta.url)) };
const target = h2 ? createSecureServer(tls) : createHttpsServer(tls);
const proxy = createHttpServer();
const track = (socket: Socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); };
target.on("connection", track);
proxy.on("connection", track);
target.on("secureConnection", () => tlsHandshakes++);
if (h2) target.on("session", session => { sessions.add(session); session.once("close", () => sessions.delete(session)); session.on("error", () => {}); });
// No remote DNS or forwarding: every CONNECT is pinned to this local target.
proxy.on("connect", (request, socket, head) => {
  connects++;
  assert.equal(new URL(`http://${request.url}`).hostname, "pool-fixture.invalid");
  if (rejectProxy) { socket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n"); return; }
  assert.equal(request.url, `pool-fixture.invalid:${(target.address() as AddressInfo).port}`);
  const upstream = connect((target.address() as AddressInfo).port, "127.0.0.1"); track(upstream);
  upstream.on("error", () => socket.destroy()); socket.on("error", () => upstream.destroy());
  socket.on("close", () => upstream.destroy()); upstream.on("close", () => socket.destroy());
  upstream.once("connect", () => { socket.write("HTTP/1.1 200 Connection Established\r\n\r\n"); if (head.length) upstream.write(head); socket.pipe(upstream); upstream.pipe(socket); });
});
target.on("request", async (request: any, response: any) => {
  for await (const chunk of request) { /* Fully consume local request. */ }
  if (!h2) { response.setHeader("Connection", closePeer ? "close" : "keep-alive"); response.setHeader("Keep-Alive", hint ? "timeout=3" : ""); }
  if (String(request.headers["x-amz-target"]).endsWith("ListAvailableModels")) {
    response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ models: [{ modelId: "local-pool-model" }], defaultModel: { modelId: "local-pool-model" } }));
  } else {
    response.setHeader("content-type", "application/vnd.amazon.eventstream");
    if (h2 && closePeer) { const session = request.stream.session; response.once("finish", () => session.goaway()); }
    response.end(frame);
  }
});
if (!h2) (target as ReturnType<typeof createHttpsServer>).keepAliveTimeout = 30000;
async function listen(server: any) { await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); }
const result: Record<string, unknown> = { mode, passed: false };
try {
  await listen(target); await listen(proxy);
  writeFileSync(modelsFile, JSON.stringify({ providers: { kiro: { axiomProxy: proxied ? { mode: "external", url: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}` } : { mode: "direct" } } } }));
  const provider = mode === "other-direct" ? "fixture" : "kiro";
  configureModelNetwork(root, modelsFile, provider);
  const dispatcher = getGlobalDispatcher(); configureModelNetwork(root, modelsFile, provider);
  assert.equal(dispatcher, getGlobalDispatcher()); result.idempotent = true;
  assert.throws(() => configureModelNetwork(root, modelsFile, provider === "kiro" ? "fixture" : "kiro"), /重新创建执行进程/);
  const account = { type: "oauth" as const, access: "PUBLIC-LOCAL-TEST-ACCESS", refresh: "PUBLIC-LOCAL-TEST-REFRESH", expires: Date.now() + 3600000, authMethod: "builder-id" as const, authRegion: "us-east-1" };
  const credentials = new InMemoryCredentialStore(); await credentials.modify("kiro", async () => account);
  const models = createModels({ credentials }); models.setProvider(kiroProvider());
  const model = { id: "local-pool-model", name: "Local pool fixture", provider: "kiro", api: "kiro-chat" as const, baseUrl: "https://q.us-east-1.amazonaws.com", input: ["text" as const], reasoning: false, contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const origin = `https://${proxied ? "pool-fixture.invalid" : "127.0.0.1"}:${(target.address() as AddressInfo).port}`;
  const transport: typeof fetch = (input, options) => {
    assert.ok(["runtime.us-east-1.kiro.dev", "q.us-east-1.amazonaws.com"].includes(new URL(String(input)).hostname));
    return globalThis.fetch(origin, options);
  };
  async function chat() {
    const stream = models.stream(model, { messages: [{ role: "user", content: "local fixture", timestamp: 1 }] }, { fetch: transport });
    for await (const event of stream) { /* Read production decoder through EOF. */ }
    const message = await stream.result(); assert.equal(message.stopReason, "stop", message.errorMessage);
    await pause(15);
  }
  for (let i = 0; i < 3; i++) await chat();
  assert.equal(tlsHandshakes, 1, "short turns reuse the same TLS connection");
  await pause(4600); await chat();
  assert.equal(tlsHandshakes, mode === "other-direct" ? 2 : 1); result.afterIdle = tlsHandshakes;
  if (proxied) { assert.equal(connects, 1); result.connectsAfterIdle = connects; }
  // Catalog and chat share the configured dispatcher; the rewrite to a single
  // origin here is a fixture only, not a claim that real q/runtime share sockets.
  assert.equal((await fetchKiroCatalog(account, new AbortController().signal, transport)).length, 1);
  await pause(50); // Let the catalog socket return to the pool before the next turn.
  if (!h2) {
    hint = true; await chat(); const before = tlsHandshakes;
    await pause(3000); await chat(); assert.ok(tlsHandshakes > before, "respect a shorter server keep-alive hint"); result.shortHintReconnected = true; hint = false;
  }
  const beforeClose = tlsHandshakes;
  closePeer = true; await chat(); await pause(100);
  closePeer = false; await chat(); assert.ok(tlsHandshakes > beforeClose, "recover after peer close/GOAWAY"); result.peerCloseReconnected = true;
  if (proxied) {
    rejectProxy = true;
    const local = `https://127.0.0.1:${(target.address() as AddressInfo).port}`;
    const before = connects; const bypass = await globalThis.fetch(local, { method: "POST" }); await bypass.arrayBuffer();
    assert.equal(connects, before); result.noProxyBypass = true;
    const unconnected = `https://pool-fixture.invalid:${(target.address() as AddressInfo).port + 1}`;
    // A rejected CONNECT fails on a fresh origin without reaching target TLS.
    // This does not independently monitor DNS or prove every no-fallback path.
    const beforeFailure = connects, beforeTls = tlsHandshakes;
    await assert.rejects(globalThis.fetch(unconnected));
    assert.ok(connects > beforeFailure); assert.equal(tlsHandshakes, beforeTls); result.proxyRejectionFailed = true;
  }
  result.passed = true;
} finally {
  await getGlobalDispatcher().destroy();
  for (const session of sessions) session.destroy();
  for (const socket of sockets) socket.destroy();
  await Promise.all([target, proxy].map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  rmSync(root, { recursive: true, force: true });
}
console.log(JSON.stringify(result));
