import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ModelService } from "../src/server/model-service.js";
import { Logins } from "../src/server/auth.js";
import { closeModelNetworks } from "../src/server/model-network.js";
import { atomicProxyJson, proxyConfigPath, proxyRuntimePath } from "../src/server/integrations/model-proxy-config.js";
import { readProviderProxy } from "../src/server/integrations/model-proxy-env.js";
import { fixtureLoginNetwork } from "./model-network-fixture.js";

async function until(check: () => boolean) {
  for (let n = 0; n < 1500 && !check(); n++) await delay(10);
  assert.ok(check(), "authentication must settle");
}

test("first OAuth login validates and persists its proxy before authentication, preserving other configuration", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-oauth-proxy-")), previous = process.env.AXIOM_PI_DIR;
  delete process.env.AXIOM_PI_DIR;
  const models = new ModelService(root), owner = {};
  const file = join(models.dir, "models.json");
  let calls = 0;
  const network = fixtureLoginNetwork(models);
  const logins = new Logins(models, () => {}, async () => {}, async () => {}, async (...args) => {
    calls++;
    assert.deepEqual(readProviderProxy(file, "openai"), { mode: "external", url: "http://user:PROXY-SECRET@127.0.0.1:7890/" });
    return network(...args);
  });
  try {
    await models.raw();
    const raw = JSON.stringify({ providers: { anthropic: { headers: {}, axiomProxy: { mode: "direct" } } } });
    writeFileSync(file, raw);
    const createRuntime = models.runtime.bind(models);
    const native = (await createRuntime()).getProvider("openai")!;
    models.runtime = async path => {
      const runtime = await createRuntime(path);
      runtime.registerNativeProvider({ ...native, auth: { ...native.auth, oauth: {
        ...native.auth.oauth!,
        async login() { return { type: "oauth", access: "TEST-ACCESS", refresh: "TEST-REFRESH", expires: Date.now() + 3600000 }; },
      } } });
      return runtime;
    };
    const { revision } = await models.load();
    await assert.rejects(logins.start(owner, "openai", "oauth", revision, { mode: "external", url: "socks5://PROXY-SECRET" }), { code: "INVALID_CONFIG" });
    await assert.rejects(logins.start(owner, "openai", "oauth", revision, { mode: "builtin", profileId: randomUUID() }), { code: "PROXY_UNAVAILABLE" });
    await assert.rejects(logins.start(owner, "openai", "oauth", "stale", { mode: "direct" }), { code: "REVISION_CONFLICT" });
    assert.equal(await models.raw(), raw);
    assert.equal(calls, 0);
    assert.equal(models.authActive, false);
    const first = await logins.start(owner, "openai", "oauth", revision, { mode: "external", url: "http://user:PROXY-SECRET@127.0.0.1:7890" });
    await until(() => !models.authActive);
    assert.equal(logins.get(owner, first.id).state.status, "completed");
    const saved = JSON.parse(await models.raw());
    assert.deepEqual(saved.providers.anthropic, JSON.parse(raw).providers.anthropic);
    assert.deepEqual(Object.keys(saved.providers.openai), ["headers", "axiomProxy"], "OAuth adds no custom protocol or endpoint");
    assert.deepEqual(saved.providers.openai.headers, {});
    assert.ok(!JSON.stringify(logins.get(owner, first.id).state).includes("PROXY-SECRET"));
    const current = (await models.load()).revision;
    const second = await logins.start(owner, "openai", "oauth", current, { mode: "external", url: "", keepUrl: true });
    await until(() => !models.authActive);
    assert.equal(logins.get(owner, second.id).state.status, "completed");
    assert.equal(calls, 2);
  } finally {
    await logins.close();
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("native OpenAI callback reaches selected builtin proxy for token exchange over real IPC", { timeout: 30000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-native-oauth-proxy-")), previous = process.env.AXIOM_PI_DIR;
  delete process.env.AXIOM_PI_DIR;
  const models = new ModelService(root), owner = {}, sockets = new Set<Socket>();
  const targets: string[] = [], authHeaders: (string | undefined)[] = [];
  const proxy = createServer();
  proxy.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  proxy.on("connect", (request, socket) => {
    targets.push(request.url!); authHeaders.push(request.headers["proxy-authorization"]);
    // Deliberately stop here: exercise the native HTTPS proxy route without contacting OpenAI.
    socket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
  });
  await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const profileId = randomUUID();
  atomicProxyJson(proxyConfigPath(root), { revision: randomUUID(), installations: {}, bindings: {}, profiles: [{ id: profileId, kernel: "xray", name: "Local test entry", node: "fixture", source: "{}" }] });
  atomicProxyJson(proxyRuntimePath(root), { [profileId]: { status: "running", generation: randomUUID(), port: (proxy.address() as AddressInfo).port, token: "ENTRY-SECRET" } });
  const states: string[] = [];
  const logins = new Logins(models, (_owner, state) => states.push(JSON.stringify(state)), async () => {}, async () => {});
  try {
    const revision = (await models.load()).revision;
    const flow = await logins.start(owner, "openai", "oauth", revision, { mode: "builtin", profileId });
    await until(() => !!logins.get(owner, flow.id).state.url || !models.authActive);
    const state = logins.get(owner, flow.id).state;
    assert.ok(state.url, state.message);
    const authorize = new URL(state.url), callback = new URL(authorize.searchParams.get("redirect_uri")!);
    callback.search = new URLSearchParams({ state: authorize.searchParams.get("state")!, code: "FAKE-CODE", client_id: "fixture-client" }).toString();
    const response = await fetch(callback);
    assert.equal(response.status, 200, "loopback callback succeeds independently of token exchange");
    await response.text();
    await until(() => !models.authActive);
    assert.ok(targets.length >= 1);
    assert.ok(targets.every(target => target === "auth.openai.com:443"));
    assert.ok(authHeaders.every(value => value === `Basic ${Buffer.from("axiom:ENTRY-SECRET").toString("base64")}`));
    const result = logins.get(owner, flow.id).state;
    assert.equal(result.status, "failed", "browser callback alone must not count as persisted authentication");
    assert.match(result.message, /已收到授权回调/);
    assert.ok(states.some(value => value.includes("正在通过所选网络")));
    assert.ok(states.every(value => !value.includes("ENTRY-SECRET") && !value.includes("FAKE-CODE")));
    assert.deepEqual(readProviderProxy(join(models.dir, "models.json"), "openai"), { mode: "builtin", profileId });
    assert.equal((await (await models.runtime()).listCredentials()).some(c => c.providerId === "openai"), false);
    assert.equal(readFileSync(join(models.dir, "models.json"), "utf8").includes("ENTRY-SECRET"), false);
  } finally {
    await logins.close(); await closeModelNetworks(root);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => proxy.close(() => resolve()));
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
