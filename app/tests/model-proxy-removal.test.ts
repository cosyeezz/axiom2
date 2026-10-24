import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { ModelProxyService } from "../src/server/integrations/model-proxy.js";
import { ProxyProcess } from "../src/server/integrations/model-proxy-process.js";
import { atomicProxyJson, proxyConfigPath, proxyDirectory, readProxyConfig, type ProxyConfig } from "../src/server/integrations/model-proxy-config.js";
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
async function settle(s: ModelProxyService) { const deadline = Date.now() + 5000; await turn(); while (s.snapshot().job?.running) { assert.ok(Date.now() < deadline); await turn(); } return s.snapshot(); }
async function settleImporter(s: ModelProxyService) { const deadline = Date.now() + 5000; await turn(); while (s.snapshot().importer?.busy) { assert.ok(Date.now() < deadline); await turn(); } return s.snapshot().importer!; }
const importerCommand = (s: ModelProxyService, action: string) => s.command({ requestId: randomUUID(), op: `modelProxy.importer${action}`, params: { revision: s.snapshot().revision, confirm: true } });
function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), "axiom-proxy-remove-"));
  const config: ProxyConfig = { revision: randomUUID(), installations: {}, profiles: [], bindings: {} };
  for (const kernel of ["xray", "mihomo"] as const) {
    const directory = `${kernel}-1.0.0-${randomUUID()}`;
    fs.mkdirSync(join(proxyDirectory(root), "versions", directory), { recursive: true });
    fs.writeFileSync(join(proxyDirectory(root), "versions", directory, "sentinel"), kernel);
    config.installations[kernel] = { directory, version: "1.0.0" };
    const id = randomUUID(); config.profiles.push({ id, name: kernel, kernel, node: "node", source: "fixture secret subscription", enabled: true }); config.bindings[kernel] = id;
  }
  const importer = join(proxyDirectory(root), "importer", "xray-knife-11.4.1-win32-x64"); fs.mkdirSync(importer, { recursive: true });
  atomicProxyJson(proxyConfigPath(root), config);
  return { root, config, importer, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const uninstall = (s: ModelProxyService) => s.command({ requestId: randomUUID(), op: "modelProxy.uninstall", params: { kernel: "xray", revision: s.snapshot().revision, confirm: true } });
test("proxy uninstall awaits owned process stop and preserves unrelated kernel, subscriptions and bindings", async t => {
  const f = fixture(); let release!: () => void, stopping = false;
  t.mock.method(ProxyProcess.prototype, "start", async function(this: ProxyProcess) { this.endpoint.status = "running"; });
  t.mock.method(ProxyProcess.prototype, "stop", async function(this: ProxyProcess) { if (this.profile.kernel === "xray" && !stopping) { stopping = true; await new Promise<void>(done => { release = done; }); } this.endpoint.status = "stopped"; });
  const s = new ModelProxyService(f.root, () => {});
  try {
    await s.initialize(); await uninstall(s); await turn();
    assert.equal(stopping, true); assert.ok(readProxyConfig(f.root).installations.xray); assert.ok(fs.existsSync(f.importer));
    await assert.rejects(s.command({ op: "modelProxy.cancel", requestId: randomUUID() }), { code: "NOT_CANCELLABLE" });
    await assert.rejects(uninstall(s), { code: "BUSY" });
    await importerCommand(s, "Check");
    assert.equal((await settleImporter(s)).verifiedVersion, undefined, "an empty directory is not a verified installation");
    assert.equal(s.snapshot().job?.running, true, "independent importer check finishes while the kernel stop is pending");
    release(); assert.equal((await settle(s)).job?.error, undefined);
    const next = readProxyConfig(f.root);
    assert.equal(next.installations.xray, undefined); assert.deepEqual(next.installations.mihomo, f.config.installations.mihomo);
    assert.deepEqual(next.bindings, f.config.bindings); assert.deepEqual(next.profiles.map(p => p.source), f.config.profiles.map(p => p.source));
    assert.equal(next.profiles.find(p => p.kernel === "xray")!.enabled, false);
    assert.equal(s.snapshot().profiles.find(p => p.kernel === "mihomo")!.status, "running");
    assert.equal(fs.existsSync(f.importer), true); assert.equal(s.snapshot().importer?.filesPresent, true);
  } finally { release?.(); await s.close(); f.cleanup(); }
});
test("proxy uninstall rejects stale revision and unsafe parent without modifying configuration", async () => {
  const f = fixture(), versions = join(proxyDirectory(f.root), "versions"), outside = join(f.root, "outside");
  fs.renameSync(versions, outside); fs.symlinkSync(outside, versions, process.platform === "win32" ? "junction" : "dir");
  const s = new ModelProxyService(f.root, () => {});
  try {
    await assert.rejects(s.command({ op: "modelProxy.uninstall", requestId: randomUUID(), params: { kernel: "xray", revision: "stale", confirm: true } }), { code: "REVISION_CONFLICT" });
    const before = fs.readFileSync(proxyConfigPath(f.root), "utf8");
    await uninstall(s); assert.match((await settle(s)).job!.error!, /托管安装目录/);
    assert.equal(fs.readFileSync(proxyConfigPath(f.root), "utf8"), before);
    assert.ok(fs.existsSync(join(outside, f.config.installations.xray!.directory, "sentinel")));
  } finally { await s.close(); f.cleanup(); }
});
test("proxy partial removal revokes installation and can be retried after restart", async t => {
  const f = fixture(), rm = fs.rmSync; let s = new ModelProxyService(f.root, () => {});
  const mock = t.mock.method(fs, "rmSync", ((path, options) => {
    if (String(path) === join(proxyDirectory(f.root), "versions", f.config.installations.xray!.directory)) { assert.equal(readProxyConfig(f.root).installations.xray, undefined); throw Error("busy"); }
    return rm(path, options);
  }) as typeof fs.rmSync); syncBuiltinESMExports();
  try {
    await uninstall(s); assert.match((await settle(s)).job!.error!, /部分文件/);
    assert.equal(s.snapshot().removalPending?.xray, true);
    mock.mock.restore(); syncBuiltinESMExports(); await s.close(); s = new ModelProxyService(f.root, () => {});
    await uninstall(s); assert.equal((await settle(s)).job?.error, undefined);
    assert.equal(readProxyConfig(f.root).removalPending, undefined); assert.equal(fs.existsSync(f.importer), true);
  } finally { mock.mock.restore(); syncBuiltinESMExports(); await s.close(); f.cleanup(); }
});

test("importer uninstall preserves running kernels and retries its own pending removal after restart", async t => {
  const f = fixture(), rm = fs.rmSync; let stops = 0, s = new ModelProxyService(f.root, () => {});
  t.mock.method(ProxyProcess.prototype, "start", async function(this: ProxyProcess) { this.endpoint.status = "running"; });
  t.mock.method(ProxyProcess.prototype, "stop", async () => { stops++; });
  const mock = t.mock.method(fs, "rmSync", ((path, options) => {
    if (String(path) === f.importer) {
      assert.ok(readProxyConfig(f.root).removalPending?.includes("xray-knife-11.4.1-win32-x64"));
      throw Error("busy");
    }
    return rm(path, options);
  }) as typeof fs.rmSync); syncBuiltinESMExports();
  try {
    await s.initialize();
    await importerCommand(s, "Uninstall");
    assert.match((await settleImporter(s)).error!, /部分文件/);
    assert.equal(stops, 0); assert.ok(s.snapshot().profiles.every(p => p.status === "running"));
    assert.deepEqual(readProxyConfig(f.root).installations, f.config.installations);
    assert.deepEqual(readProxyConfig(f.root).profiles, f.config.profiles);
    assert.equal(s.snapshot().removalPending?.xray, false);
    mock.mock.restore(); syncBuiltinESMExports(); await s.close(); s = new ModelProxyService(f.root, () => {});
    assert.equal(s.snapshot().importer?.removalPending, true);
    await importerCommand(s, "Uninstall"); assert.equal((await settleImporter(s)).error, undefined);
    assert.equal(readProxyConfig(f.root).removalPending, undefined); assert.equal(fs.existsSync(f.importer), false);
  } finally { mock.mock.restore(); syncBuiltinESMExports(); await s.close(); f.cleanup(); }
});

test("proxy refuses deletion after an unconfirmed historical kernel exit", async () => {
  const f = fixture(), run = join(proxyDirectory(f.root), "runs", randomUUID());
  fs.mkdirSync(run, { recursive: true }); fs.writeFileSync(join(run, "owner.json"), JSON.stringify({ kernel: "xray", directory: f.config.installations.xray!.directory }));
  const s = new ModelProxyService(f.root, () => {});
  try {
    await uninstall(s); assert.match((await settle(s)).job!.error!, /尚有代理进程未确认退出/);
    assert.deepEqual(readProxyConfig(f.root), f.config); assert.ok(fs.existsSync(f.importer));
  } finally { await s.close(); f.cleanup(); }
});
test("unrelated kernel junction does not block target uninstall", async () => {
  const f = fixture(), versions = join(proxyDirectory(f.root), "versions"), outside = join(f.root, "other-kernel");
  const mihomo = join(versions, f.config.installations.mihomo!.directory);
  fs.renameSync(mihomo, outside); fs.symlinkSync(outside, mihomo, process.platform === "win32" ? "junction" : "dir");
  const s = new ModelProxyService(f.root, () => {});
  try {
    await uninstall(s); assert.equal((await settle(s)).job?.error, undefined);
    assert.ok(fs.existsSync(join(outside, "sentinel"))); assert.equal(readProxyConfig(f.root).installations.xray, undefined);
  } finally { await s.close(); f.cleanup(); }
});
