import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { tmpdir } from "./temporary.js";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { ModelProxyService } from "../src/server/integrations/model-proxy.js";
import childProcess from "node:child_process";
import { once } from "node:events";
import { proxyRemovalPlan } from "../src/server/integrations/model-proxy-removal.js";
import { ProxyProcess } from "../src/server/integrations/model-proxy-process.js";
import { createProcessOwner } from "../src/server/process-owner-record.js";
import { assertToolProcessesStopped } from "../src/server/integrations/tool-process.js";
import { atomicProxyJson, proxyConfigPath, proxyDirectory, readProxyConfig, type ProxyConfig } from "../src/server/integrations/model-proxy-config.js";
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
async function kernelReady(kernel: childProcess.ChildProcess, exited: Promise<unknown>) {
  let timer!: NodeJS.Timeout;
  try {
    await Promise.race([once(kernel.stdout!, "data"), exited.then(() => { throw Error("fixture kernel exited before readiness"); }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("fixture kernel readiness timed out")), 5000); })]);
  } finally { clearTimeout(timer); }
}
async function settle(s: ModelProxyService) { const deadline = Date.now() + 5000; await turn(); while (s.snapshot().job?.running) { assert.ok(Date.now() < deadline); await turn(); } return s.snapshot(); }
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
test("proxy uninstall awaits owned process stop, can be preempted by another uninstall and preserves unrelated kernel, subscriptions and bindings", { skip: process.platform === "win32" && "requires native POSIX process enumeration" }, async t => {
  const f = fixture(); let release!: () => void, stopping = false;
  t.mock.method(ProxyProcess.prototype, "start", async function(this: ProxyProcess) { this.endpoint.status = "running"; });
  t.mock.method(ProxyProcess.prototype, "stop", async function(this: ProxyProcess) { if (this.profile.kernel === "xray" && !stopping) { stopping = true; await new Promise<void>(done => { release = done; }); } this.endpoint.status = "stopped"; });
  const s = new ModelProxyService(f.root, () => {});
  try {
    await s.initialize(); await uninstall(s); await turn();
    assert.equal(stopping, true); assert.ok(readProxyConfig(f.root).installations.xray); assert.ok(fs.existsSync(f.importer));
    await assert.rejects(s.command({ op: "modelProxy.inspect", requestId: randomUUID(), params: { kernel: "xray", source: "vless://fixture" } }), { code: "BUSY" });
    const second = uninstall(s); await turn(); release();
    await second; assert.equal((await settle(s)).job?.error, undefined);
    const next = readProxyConfig(f.root);
    assert.equal(next.installations.xray, undefined); assert.deepEqual(next.installations.mihomo, f.config.installations.mihomo);
    assert.deepEqual(next.bindings, f.config.bindings); assert.deepEqual(next.profiles.map(p => p.source), f.config.profiles.map(p => p.source));
    assert.equal(next.profiles.find(p => p.kernel === "xray")!.enabled, false);
    assert.equal(s.snapshot().profiles.find(p => p.kernel === "mihomo")!.status, "running");
    assert.equal(fs.existsSync(f.importer), false); assert.deepEqual(s.snapshot().cleanup?.xray?.paths, []);
  } finally { release?.(); await s.close(); f.cleanup(); }
});
test("proxy removal is not blocked by an unrelated application-root tool owner", { skip: process.platform === "win32" }, async () => {
  const f = fixture(), s = new ModelProxyService(f.root, () => {});
  const path = join(f.root, `.axiom-command-${randomUUID()}.json`), owner = createProcessOwner(path);
  try {
    assert.throws(() => assertToolProcessesStopped(f.root), { code: "stop-unconfirmed" });
    const before = s.snapshot();
    await s.command({ requestId: randomUUID(), op: "modelProxy.uninstall", params: { kernel: "xray", confirm: true, revision: before.revision, cleanupRevision: before.cleanup!.xray!.revision } });
    assert.equal((await settle(s)).job?.error, undefined);
    assert.equal(fs.existsSync(join(proxyDirectory(f.root), "versions", f.config.installations.xray!.directory)), false);
    assert.equal(fs.existsSync(path), true, "unrelated tool ownership and lifecycle remain untouched");
  } finally { owner.stopped("not-started"); owner.confirmed(); await s.close(); f.cleanup(); }
});
test("combined Xray plan includes all legacy importer versions while mihomo retains them", () => {
  const f = fixture();
  try {
    const oldImporter = join(proxyDirectory(f.root), "importer", "xray-knife-11.4.0-linux-arm64");
    fs.mkdirSync(oldImporter);
    const plan = proxyRemovalPlan(f.root, "xray", f.config);
    for (const path of [f.importer, oldImporter, join(proxyDirectory(f.root), "versions", f.config.installations.xray!.directory)]) assert.ok(plan.paths.includes(path));
    const other = proxyRemovalPlan(f.root, "mihomo", f.config);
    assert.equal(other.paths.includes(f.importer), false); other.remove();
    assert.ok(fs.existsSync(f.importer)); assert.ok(fs.existsSync(oldImporter));
    plan.remove();
    for (const path of plan.paths) assert.equal(fs.existsSync(path), false);
  } finally { f.cleanup(); }
});
for (const outcome of ["remove", "changed", "denied"] as const) test(`combined Xray uninstall revalidates immediately before injected deletion and handles ${outcome}`, { skip: process.platform === "win32" }, async () => {
  const f = fixture(); let release!: () => void, entered = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const s = new ModelProxyService(f.root, () => {}, { removal: async work => {
    entered = true; await gate;
    if (outcome === "denied") throw Error("fixture barrier denied");
    return work();
  } });
  const path = join(proxyDirectory(f.root), "versions", f.config.installations.xray!.directory);
  try {
    await uninstall(s); await turn();
    assert.equal(entered, true); assert.equal(fs.existsSync(path), true);
    assert.deepEqual(readProxyConfig(f.root).installations, f.config.installations);
    if (outcome === "changed") atomicProxyJson(proxyConfigPath(f.root), { ...f.config, revision: randomUUID() });
    release();
    const error = (await settle(s)).job?.error;
    // Component standard: a configuration change during uninstall does not block it.
    if (outcome === "denied") { assert.match(error!, /barrier denied/); assert.equal(fs.existsSync(path), true); }
    else { assert.equal(error, undefined); assert.equal(fs.existsSync(path), false); }
  } finally { release(); await s.close(); f.cleanup(); }
});

test("proxy uninstall ignores a stale revision and never follows an unsafe parent outside the component", async () => {
  const f = fixture(), versions = join(proxyDirectory(f.root), "versions"), outside = join(f.root, "outside");
  fs.renameSync(versions, outside); fs.symlinkSync(outside, versions, process.platform === "win32" ? "junction" : "dir");
  const s = new ModelProxyService(f.root, () => {});
  try {
    await s.command({ op: "modelProxy.uninstall", requestId: randomUUID(), params: { kernel: "xray", revision: "stale", confirm: true } });
    assert.equal((await settle(s)).job?.error, undefined);
    assert.equal(readProxyConfig(f.root).installations.xray, undefined);
    assert.ok(fs.existsSync(join(outside, f.config.installations.xray!.directory, "sentinel")), "a symlinked parent is never traversed");
  } finally { await s.close(); f.cleanup(); }
});
test("proxy partial removal revokes installation and the next uninstall after restart cleans it", { skip: process.platform === "win32" && "requires native POSIX process enumeration" }, async t => {
  const f = fixture(), rm = fs.rmSync; let s = new ModelProxyService(f.root, () => {});
  const mock = t.mock.method(fs, "rmSync", ((path, options) => {
    if (String(path) === join(proxyDirectory(f.root), "versions", f.config.installations.xray!.directory)) { assert.equal(readProxyConfig(f.root).installations.xray, undefined); throw Error("busy"); }
    return rm(path, options);
  }) as typeof fs.rmSync); syncBuiltinESMExports();
  try {
    await uninstall(s); assert.match((await settle(s)).job!.error!, /部分文件/);
    assert.equal(readProxyConfig(f.root).installations.xray, undefined);
    mock.mock.restore(); syncBuiltinESMExports(); await s.close(); s = new ModelProxyService(f.root, () => {});
    await uninstall(s); assert.equal((await settle(s)).job?.error, undefined);
    assert.equal(fs.existsSync(join(proxyDirectory(f.root), "versions", f.config.installations.xray!.directory)), false);
    assert.equal(readProxyConfig(f.root).removalPending, undefined); assert.equal(fs.existsSync(f.importer), false);
  } finally { mock.mock.restore(); syncBuiltinESMExports(); await s.close(); f.cleanup(); }
});

test("Xray cleanup retries legacy importer-only leftovers after restart", async t => {
  const f = fixture(), rm = fs.rmSync;
  fs.rmSync(join(proxyDirectory(f.root), "versions", f.config.installations.xray!.directory), { recursive: true });
  delete f.config.installations.xray;
  f.config.removalPending = ["xray-knife-11.4.1-win32-x64"];
  atomicProxyJson(proxyConfigPath(f.root), f.config);
  let s = new ModelProxyService(f.root, () => {});
  const mock = t.mock.method(fs, "rmSync", ((path, options) => {
    if (String(path) === f.importer) {
      throw Error("busy");
    }
    return rm(path, options);
  }) as typeof fs.rmSync); syncBuiltinESMExports();
  try {
    assert.deepEqual(s.snapshot().cleanup!.xray!.paths, [f.importer]);
    assert.equal(s.snapshot().removalPending?.xray, true);
    await uninstall(s); assert.match((await settle(s)).job!.error!, /部分文件/);
    assert.equal(readProxyConfig(f.root).installations.xray, undefined);
    assert.deepEqual(readProxyConfig(f.root).bindings, f.config.bindings);
    assert.deepEqual(readProxyConfig(f.root).installations.mihomo, f.config.installations.mihomo);
    mock.mock.restore(); syncBuiltinESMExports(); await s.close(); s = new ModelProxyService(f.root, () => {});
    await uninstall(s); assert.equal((await settle(s)).job?.error, undefined);
    assert.equal(readProxyConfig(f.root).removalPending, undefined); assert.equal(fs.existsSync(f.importer), false);
    assert.deepEqual(s.snapshot().cleanup!.xray!.paths, []);
  } finally { mock.mock.restore(); syncBuiltinESMExports(); await s.close(); f.cleanup(); }
});

test("proxy uninstall stops a live kernel left by an earlier run and deletes it", { skip: process.platform === "win32" && "requires a POSIX fixture executable and process enumeration" }, async () => {
  const f = fixture(), run = join(proxyDirectory(f.root), "runs", randomUUID());
  fs.mkdirSync(run, { recursive: true });
  // 直接托管以存活进程为事实依据：伪造一个仍存活的“内核”进程阻止删除。
  const versions = join(proxyDirectory(f.root), "versions", f.config.installations.xray!.directory);
  fs.mkdirSync(versions, { recursive: true });
  const kernelPath = join(versions, "xray");
  fs.writeFileSync(kernelPath, `#!${process.execPath}\nprocess.stdout.write('ready\\n'); setInterval(() => {}, 1000);\n`); fs.chmodSync(kernelPath, 0o755);
  const kernel = childProcess.spawn(kernelPath, ["run", "-config", "/dev/null"], { stdio: ["ignore", "pipe", "ignore"] });
  const exited = once(kernel, "exit");
  let s: ModelProxyService | undefined;
  try {
    await kernelReady(kernel, exited);
    s = new ModelProxyService(f.root, () => {});
    fs.writeFileSync(join(run, "kernel.json"), JSON.stringify({ pid: kernel.pid, kernel: "xray", executable: kernelPath, startedAt: new Date().toISOString() }));
    await uninstall(s); assert.equal((await settle(s)).job?.error, undefined);
    await exited; assert.equal(fs.existsSync(versions), false); assert.equal(fs.existsSync(f.importer), false);
    assert.equal(readProxyConfig(f.root).installations.xray, undefined);
  } finally { kernel.kill("SIGKILL"); await exited.catch(() => {}); await s?.close(); f.cleanup(); }
});
test("unrelated kernel junction does not block target uninstall", { skip: process.platform === "win32" && "requires native POSIX process enumeration" }, async () => {
  const f = fixture(), versions = join(proxyDirectory(f.root), "versions"), outside = join(f.root, "other-kernel");
  const mihomo = join(versions, f.config.installations.mihomo!.directory);
  fs.renameSync(mihomo, outside); fs.symlinkSync(outside, mihomo, process.platform === "win32" ? "junction" : "dir");
  const s = new ModelProxyService(f.root, () => {});
  try {
    await uninstall(s); assert.equal((await settle(s)).job?.error, undefined);
    assert.ok(fs.existsSync(join(outside, "sentinel"))); assert.equal(readProxyConfig(f.root).installations.xray, undefined);
  } finally { await s.close(); f.cleanup(); }
});
for (const [configured, argument] of [[true, 'run'], [false, 'run'], [true, '-config']] as const) test(`proxy removal stops and deletes running old versions with ${configured ? 'current' : 'no'} installation configured (${argument})`, { skip: process.platform === "win32" }, async () => {
  const f = fixture();
  const old = join(proxyDirectory(f.root), "versions", `xray-0.9.0-${randomUUID()}`);
  fs.mkdirSync(old); const executable = join(old, "xray");
  fs.writeFileSync(executable, `#!${process.execPath}\nprocess.stdout.write('ready\\n'); setInterval(() => {}, 1000);\n`); fs.chmodSync(executable, 0o755);
  if (!configured) { delete f.config.installations.xray; atomicProxyJson(proxyConfigPath(f.root), f.config); }
  const kernel = childProcess.spawn(executable, [argument], { stdio: ["ignore", "pipe", "ignore"] });
  const exited = once(kernel, "exit");
  let s: ModelProxyService | undefined;
  try {
    await kernelReady(kernel, exited);
    s = new ModelProxyService(f.root, () => {});
    const state = s.snapshot();
    assert.ok(state.cleanup!.xray!.paths.includes(old));
    await s.command({ op: "modelProxy.uninstall", requestId: randomUUID(), params: { kernel: "xray" } });
    assert.equal((await settle(s)).job?.error, undefined);
    await exited; assert.equal(fs.existsSync(old), false);
    assert.equal(readProxyConfig(f.root).installations.xray, undefined);
  } finally { kernel.kill("SIGKILL"); await exited.catch(() => {}); await s?.close(); f.cleanup(); }
});
for (const configured of [true, false]) test(`Windows kernel removal deletes ${configured ? "current" : "only historical"} installations without a process scan`, { skip: process.platform !== "win32" }, async () => {
  const f = fixture(), old = join(proxyDirectory(f.root), "versions", `xray-0.9.0-${randomUUID()}`);
  fs.mkdirSync(old); fs.writeFileSync(join(old, "sentinel"), "historical kernel");
  if (!configured) { delete f.config.installations.xray; atomicProxyJson(proxyConfigPath(f.root), f.config); }
  const s = new ModelProxyService(f.root, () => {});
  try {
    const paths = s.snapshot().cleanup!.xray!.paths;
    assert.ok(paths.includes(old));
    await s.command({ op: "modelProxy.uninstall", requestId: randomUUID(), params: { kernel: "xray" } });
    assert.equal((await settle(s)).job?.error, undefined);
    assert.equal(readProxyConfig(f.root).installations.xray, undefined);
    for (const path of paths) assert.equal(fs.existsSync(path), false);
  } finally { await s.close(); f.cleanup(); }
});
test("proxy removal still deletes when process enumeration is unavailable", { skip: process.platform === "win32" }, async t => {
  const f = fixture(), s = new ModelProxyService(f.root, () => {}), execute = childProcess.execFileSync;
  const mock = t.mock.method(childProcess, "execFileSync", ((file, ...args) => { if (file === "ps") throw Error("fixture process scan unavailable"); return (execute as Function)(file, ...args); }) as typeof execute); syncBuiltinESMExports();
  try {
    await uninstall(s); assert.equal((await settle(s)).job?.error, undefined);
    assert.equal(readProxyConfig(f.root).installations.xray, undefined);
    assert.equal(fs.existsSync(join(proxyDirectory(f.root), "versions", f.config.installations.xray!.directory)), false);
  } finally { mock.mock.restore(); syncBuiltinESMExports(); await s.close(); f.cleanup(); }
});
test("stopping one route does not kill another route sharing the same kernel", { skip: process.platform === "win32" }, async () => {
  // 直接托管按可执行文件兜底清理；同一内核的多条线路必须互不误杀，否则第二条线路会被第一条的停止操作带走。
  const f = fixture(), install = f.config.installations.xray!;
  const versions = join(proxyDirectory(f.root), "versions", install.directory);
  const kernelPath = join(versions, "xray");
  // 假内核：读取生成的 config.json，监听其入站端口，使 start 的就绪探测通过。
  fs.writeFileSync(kernelPath, `#!${process.execPath}
const fs = require("node:fs"), net = require("node:net");
const config = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], "utf8"));
net.createServer(socket => socket.destroy()).listen(config.inbounds[0].port, "127.0.0.1");
setTimeout(() => process.exit(0), 120000);
`);
  fs.chmodSync(kernelPath, 0o755);
  const { installedKernelPids } = await import("../src/server/integrations/model-proxy-kernel.js");
  const profile = (id: string) => ({ id, name: id, kernel: "xray" as const, node: "node", source: JSON.stringify({ protocol: "vless", settings: {} }) });
  const live: ProxyProcess[] = [];
  const siblings = (self: () => ProxyProcess | undefined) => () => live.filter(item => item !== self()).flatMap(item => item.processId ? [item.processId] : []);
  let a: ProxyProcess, b: ProxyProcess;
  a = new ProxyProcess(f.root, profile("aaaaaaaa-0000-4000-8000-000000000001"), () => {}, siblings(() => a));
  b = new ProxyProcess(f.root, profile("bbbbbbbb-0000-4000-8000-000000000002"), () => {}, siblings(() => b));
  live.push(a, b);
  try {
    await a.start(install, new AbortController().signal);
    await b.start(install, new AbortController().signal);
    const pidA = a.processId!, pidB = b.processId!;
    assert.equal(a.endpoint.status, "running"); assert.equal(b.endpoint.status, "running");
    assert.equal(installedKernelPids(kernelPath).length, 2);
    await a.stop();
    const afterA = installedKernelPids(kernelPath);
    assert.equal(afterA.includes(pidA), false, "停止的线路 PID 应退出");
    assert.ok(afterA.includes(pidB), "另一条线路的 PID 不应被兜底清理误杀");
    assert.equal(b.endpoint.status, "running");
  } finally { await Promise.allSettled([a.stop(), b.stop()]); f.cleanup(); }
});
