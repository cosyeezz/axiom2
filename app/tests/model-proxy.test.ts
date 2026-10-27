import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ProxyProcess, coreConfiguration } from "../src/server/integrations/model-proxy-process.js";
import { ModelProxyService } from "../src/server/integrations/model-proxy.js";
import { atomicProxyJson, proxyConfigPath, proxyDirectory, proxyExecutable, readProxyConfig, type StoredProxyProfile } from "../src/server/integrations/model-proxy-config.js";
import { parseProviderProxy, providerProxyUrl, providerProxyView } from "../src/server/integrations/model-proxy-env.js";
import { ModelService } from "../src/server/model-service.js";
import { Store } from "../src/server/storage.js";
import { configuration } from "../src/server/models.js";
import { closeModelNetworks } from "../src/server/model-network.js";

const profile = (): StoredProxyProfile => ({ id: randomUUID(), name: "Local fixture", kernel: "xray", node: "", source: JSON.stringify({ protocol: "http", settings: { servers: [{ address: "127.0.0.1", port: 1 }] } }) });
const command = (op: string, params: Record<string, unknown>) => ({ op: `modelProxy.${op}`, requestId: randomUUID(), params });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-model-proxy-"));
  const installation = { version: "1.0.0", directory: `xray-1.0.0-${randomUUID()}` };
  const executable = proxyExecutable(root, "xray", installation);
  mkdirSync(dirname(executable), { recursive: true });
  // A local fixture tests ownership/lifetime without downloading a core or using a remote node.
  writeFileSync(executable, `#!${process.execPath}\nif(process.argv.includes('-test'))process.exit(0);const fs=require('node:fs'),net=require('node:net');const c=JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('-config')+1]));net.createServer(s=>s.end()).listen(c.inbounds[0].port,'127.0.0.1');`, { mode: 0o700 });
  return { root, installation };
}

test("external proxy credentials are redacted and invalid inputs never echo them", () => {
  const input = { mode: "external", url: "http://user:SECRET@127.0.0.1:7890" };
  const saved = parseProviderProxy(input);
  assert.deepEqual(providerProxyView(saved), { mode: "external", url: "", keepUrl: true });
  assert.deepEqual(parseProviderProxy({ mode: "external", url: "", keepUrl: true }, saved), saved);
  for (const url of ["socks5://user:SECRET@127.0.0.1:7890", "http://user:SECRET@example.com/path", "http://example.com/?key=SECRET"])
    assert.throws(() => parseProviderProxy({ mode: "external", url }), error => (error as any).code === "INVALID_CONFIG" && !String(error).includes("SECRET"));
});

test("Xray native outbound cannot select a direct/reject/loopback protocol in another case", () => {
  for (const protocol of ["freedom", "Freedom", "FREEDOM", "blackhole", "Blackhole", "loopback", "Loopback"])
    assert.throws(() => coreConfiguration({ ...profile(), source: JSON.stringify({ protocol, settings: {} }) }, 12345, "token", "unused"));
});

test("proxy process stop is idempotent, revokes its entry immediately and cleans each generation", { skip: process.platform === "win32", timeout: 15000 }, async () => {
  const { root, installation } = fixture();
  let current: ProxyProcess | undefined;
  try {
    for (let i = 0; i < 2; i++) {
      current = new ProxyProcess(root, profile(), () => {});
      await current.start(installation, AbortSignal.timeout(10000));
      assert.equal(current.endpoint.status, "running"); assert.ok(current.endpoint.port); assert.ok(current.endpoint.token);
      const directory = join(proxyDirectory(root), "runs", current.endpoint.generation);
      assert.equal(statSync(join(directory, "config.json")).mode & 0o777, 0o600);
      const stopping = current.stop();
      assert.equal(stopping, current.stop()); assert.equal(current.endpoint.status, "stopped");
      assert.equal(current.endpoint.port, undefined); assert.equal(current.endpoint.token, undefined);
      await stopping; assert.equal(existsSync(directory), false);
    }
  } finally { await current?.stop(); rmSync(root, { recursive: true, force: true }); }
});

test("stop before port reservation finishes cannot recreate a credential directory", { skip: process.platform === "win32", timeout: 10000 }, async () => {
  const { root, installation } = fixture(), current = new ProxyProcess(root, profile(), () => {});
  try {
    const starting = current.start(installation, AbortSignal.timeout(5000));
    const rejected = assert.rejects(starting);
    await current.stop(); await rejected;
    assert.equal(existsSync(join(proxyDirectory(root), "runs", current.endpoint.generation)), false);
    assert.equal(current.endpoint.token, undefined);
  } finally { await current.stop(); rmSync(root, { recursive: true, force: true }); }
});

test("concurrent mutations cannot resurrect a deleted profile", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-proxy-mutations-")), service = new ModelProxyService(root, () => {});
  try {
    const saved = await service.command(command("save", { ...profile(), id: undefined, revision: "" }));
    const id = saved.profiles[0].id;
    const removal = service.command(command("remove", { id, revision: saved.revision }));
    const staleSave = service.command(command("save", { id, revision: saved.revision, name: "Resurrect", kernel: "xray", node: "", source: "" }));
    await assert.rejects(staleSave, { code: "BUSY" }); await removal;
    assert.equal(readProxyConfig(root).profiles.length, 0);
    assert.throws(() => providerProxyUrl(root, { mode: "builtin", profileId: id }), { code: "PROXY_UNAVAILABLE" });
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("invalid native route input returns a safe validation receipt", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-proxy-validation-"));
  const service = new ModelProxyService(root, () => {}), store = new Store(root);
  try {
    for (const input of [{ kernel: "xray", source: "{PRIVATE-SECRET", node: "" }, { kernel: "mihomo", source: "proxies: []", node: "   " }]) {
      const request = command("save", { ...input, revision: "", name: "Invalid fixture" });
      await assert.rejects(store.external(request, () => service.command(request)), error =>
        (error as any).code === "INVALID_INPUT" && !String(error).includes("PRIVATE-SECRET"));
      assert.equal(readProxyConfig(root).profiles.length, 0);
    }
  } finally { await service.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("stopped routes preserve the editor and configured models while requests remain unavailable", { timeout: 15000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-proxy-offline-")), previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  const selected = profile();
  atomicProxyJson(proxyConfigPath(root), { revision: randomUUID(), installations: {}, profiles: [selected], bindings: {} });
  const service = new ModelService(root);
  mkdirSync(service.dir, { recursive: true });
  const file = join(service.dir, "models.json");
  const raw = JSON.stringify({ providers: { fixture: { api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", apiKey: "TEST-LEGACY", axiomProxy: { mode: "builtin", profileId: selected.id }, models: [{ id: "fixture" }] } } });
  writeFileSync(file, raw);
  try {
    const draft = await service.read();
    assert.equal(draft.providers[0].proxy?.mode, "builtin");
    assert.equal(draft.providers[0].auth?.error, undefined, "a metadata-only page read does not probe the route");
    assert.throws(() => providerProxyUrl(root, draft.providers[0].proxy), error =>
      (error as any).code === "PROXY_UNAVAILABLE" && /尚未运行/.test(String(error)));
    assert.equal(readFileSync(file, "utf8"), raw, "a page read preserves the source credential without migration");
    assert.equal(JSON.stringify(draft).includes("TEST-LEGACY"), false);
    writeFileSync(join(service.dir, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "TEST-STORED" } }));
    const state = await configuration(root);
    assert.equal(state.error, undefined); assert.ok(state.warning);
    assert.ok(state.available.some(model => model.provider === "fixture" && model.id === "fixture"));
    assert.throws(() => providerProxyUrl(root, draft.providers[0].proxy), { code: "PROXY_UNAVAILABLE" });
    const removing = await service.read(); removing.providers = [];
    await service.save({ ...removing, confirmLogout: true });
    assert.deepEqual(await (await service.runtime()).listCredentials(), [], "local logout still works while the route is stopped");
  } finally {
    await closeModelNetworks(root);
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
