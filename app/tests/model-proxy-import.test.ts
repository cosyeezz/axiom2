import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { MaintenanceService } from "../src/server/maintenance.js";
import { defaultMaintenanceBudgets } from "../src/shared/maintenance.js";
import { atomicProxyJson, proxyConfigPath, proxyDirectory, proxyExecutable, readProxyConfig } from "../src/server/integrations/model-proxy-config.js";
import { inspectProxySource } from "../src/server/integrations/model-proxy-import.js";
import { ModelProxyService } from "../src/server/integrations/model-proxy.js";

const command = (op: string, params: Record<string, unknown> = {}) => ({ op: `modelProxy.${op}`, requestId: randomUUID(), params });
function fixture(native?: string, t?: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "axiom-proxy-import-"));
  const installation = { version: "1.19.33", directory: `mihomo-1.19.33-${randomUUID()}` };
  const executable = proxyExecutable(root, "mihomo", installation);
  mkdirSync(dirname(executable), { recursive: true });
  let guardianChild: childProcess.ChildProcess | undefined;
  if (native) copyFileSync(native, executable);
  else {
    const script = join(root, "fake-core.cjs");
    const originalFork = childProcess.fork;
    const mock = t!.mock.method(childProcess, "fork", ((...args: Parameters<typeof childProcess.fork>) => {
      const child = guardianChild = originalFork(...args), send = child.send.bind(child);
      child.send = ((message: any, ...rest: any[]) => {
        if (message?.type === "start" && message.executable === executable) message = { ...message, executable: process.execPath, args: [script, ...message.args] };
        return (send as any)(message, ...rest);
      }) as typeof child.send;
      return child;
    }) as typeof childProcess.fork);
    syncBuiltinESMExports(); t!.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
    writeFileSync(script, `
const fs=require('node:fs'),http=require('node:http');
const c=JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('-f')+1]));
if(c['mixed-port']!==0||c.tun.enable||c.dns.enable||!c.secret)process.exit(2);
const source=fs.readFileSync(c['proxy-providers'].source.path,'utf8');
fs.writeFileSync(${JSON.stringify(join(root, "kernel.pid"))},String(process.pid));
const readyAt=Date.now()+(source==='delayed'?1200:0);
if(source==='crash') setTimeout(()=>process.kill(process.ppid,'SIGKILL'),30);
http.createServer((req,res)=>{if(req.headers.authorization!=='Bearer '+c.secret){res.writeHead(401);res.end();return;}
res.end(JSON.stringify({proxies:source==='hold'||source==='crash'||Date.now()<readyAt?[]:[{name:'香港 (A)',type:'Vless'}]}));
}).listen(Number(c['external-controller'].split(':').pop()),'127.0.0.1');
`, { mode: 0o700 });
  }
  atomicProxyJson(proxyConfigPath(root), { revision: "initial", profiles: [], installations: { mihomo: installation }, bindings: {} });
  return { root, installation, guardianChild: () => guardianChild };
}
async function completed(service: ModelProxyService) {
  const deadline = Date.now() + 8000;
  while (service.snapshot().job?.running && Date.now() < deadline) await delay(20);
  assert.equal(service.snapshot().job?.running, false);
  return service.snapshot();
}
function assertClean(root: string) {
  for (const container of ["imports", "runs"]) {
    const directory = join(proxyDirectory(root), container);
    assert.deepEqual(existsSync(directory) ? readdirSync(directory) : [], []);
  }
}

test("node inspection requires an installed core and validates input without echoing credentials", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-import-missing-")), service = new ModelProxyService(root, () => {});
  try {
    await assert.rejects(service.command(command("inspect", { source: "" })), { code: "INVALID_INPUT" });
    await assert.rejects(service.command(command("inspect", { source: "vless://PRIVATE-SECRET" })), { code: "NOT_INSTALLED" });
    assert.equal(JSON.stringify(service.snapshot()).includes("PRIVATE-SECRET"), false);
    assertClean(root);
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("inspection returns only node metadata, does not save a profile, and cleans its process directory", { timeout: 12000 }, async t => {
  const { root } = fixture(undefined, t), service = new ModelProxyService(root, () => {});
  try {
    const start = await service.command(command("inspect", { source: "PRIVATE-SECRET" }));
    assert.equal(start.job?.running, true);
    const result = await completed(service);
    assert.equal(result.job?.error, undefined);
    assert.deepEqual(result.inspection, { id: start.job!.id, nodes: [{ name: "香港 (A)", type: "Vless" }] });
    assert.equal(JSON.stringify(result).includes("PRIVATE-SECRET"), false);
    assert.equal(readProxyConfig(root).profiles.length, 0);
    assertClean(root);
    const saved = await service.command(command("save", { revision: "initial", name: "节点", kernel: "mihomo", node: " 香港 (A) ", source: "PRIVATE-SECRET" }));
    assert.equal(saved.profiles[0].node, " 香港 (A) ", "native names are preserved exactly");
    assert.equal(JSON.stringify(saved).includes("PRIVATE-SECRET"), false);
    assert.match(readFileSync(proxyConfigPath(root), "utf8"), /PRIVATE-SECRET/);
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("inspection cancellation and service close stop the job, reject concurrent writes and clean imports", { timeout: 15000 }, async t => {
  const { root } = fixture(undefined, t), service = new ModelProxyService(root, () => {});
  try {
    const start = await service.command(command("inspect", { source: "hold" }));
    await assert.rejects(service.command(command("remove", { revision: "initial", id: "missing" })), { code: "BUSY" });
    await assert.rejects(service.command(command("cancel", { jobId: "stale" })), { code: "REVISION_CONFLICT" });
    await delay(150);
    const cancelled = await service.command(command("cancel", { jobId: start.job!.id }));
    assert.equal(cancelled.job?.running, false); assert.equal(cancelled.job?.message, "操作已取消。");
    assert.equal(cancelled.inspection, undefined); assertClean(root);
    await service.command(command("inspect", { source: "hold" }));
    await service.close(); assertClean(root);
    await assert.rejects(service.command(command("inspect", { source: "hold" })), { code: "CLOSING" });
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("inspection uses the live maintenance deadline beyond the old 30-second limit", { timeout: 15000 }, async t => {
  const { root, installation } = fixture(undefined, t);
  const maintenance = new MaintenanceService(root), controller = new AbortController();
  const realNow = Date.now;
  let clock: ReturnType<typeof t.mock.method> | undefined;
  try {
    const pending = maintenance.run({ id: "extended-import", resource: "proxy:mihomo", label: "测试", action: "check", params: { budgets: { ...defaultMaintenanceBudgets, totalMs: 60000 } } }, controller,
      () => inspectProxySource(root, installation, "delayed", controller.signal));
    void pending.catch(() => {});
    const deadline = realNow() + 8000;
    while (!existsSync(join(root, "kernel.pid")) && realNow() < deadline) await delay(20);
    assert.ok(existsSync(join(root, "kernel.pid")));
    clock = t.mock.method(Date, "now", () => realNow() + 31000);
    assert.deepEqual(await pending, [{ name: "香港 (A)", type: "Vless" }]);
    assertClean(root);
  } finally { clock?.mock.restore(); controller.abort(); maintenance.close(); rmSync(root, { recursive: true, force: true }); }
});

test("import supervisor crash cleans descendants using Job or namespace proof", { timeout: 15000 }, async t => {
  const { root, installation } = fixture(undefined, t);
  const maintenance = new MaintenanceService(root);
  try {
    await assert.rejects(maintenance.run({ id: "crashed-import", resource: "proxy:mihomo", label: "测试", action: "check" }, new AbortController(),
      () => inspectProxySource(root, installation, "crash", new AbortController().signal)), /无法识别节点/);
    assert.equal(maintenance.snapshot().tasks[0].status, "failed");
    assertClean(root);
  } finally { maintenance.close(); rmSync(root, { recursive: true, force: true }); }
});

test("lost Linux native receipt preserves import ownership as unknown", { skip: process.platform !== "linux", timeout: 15000 }, async t => {
  const f = fixture(undefined, t), maintenance = new MaintenanceService(f.root), controller = new AbortController();
  try {
    const pending = maintenance.run({ id: "lost-receipt", resource: "proxy:mihomo", label: "测试", action: "check" }, controller,
      () => inspectProxySource(f.root, f.installation, "hold", controller.signal));
    void pending.catch(() => {});
    const until = Date.now() + 8000;
    while (!existsSync(join(f.root, "kernel.pid")) && Date.now() < until) await delay(20);
    assert.ok(existsSync(join(f.root, "kernel.pid")));
    f.guardianChild()!.kill("SIGKILL");
    await assert.rejects(pending, { code: "stop-unconfirmed" });
    assert.equal(maintenance.snapshot().tasks[0].status, "unknown");
    const runs = join(proxyDirectory(f.root), "runs");
    const owner = JSON.parse(readFileSync(join(runs, readdirSync(runs)[0], "owner.json"), "utf8"));
    assert.equal(owner.directory, f.installation.directory);
  } finally { controller.abort(); maintenance.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("source limits count UTF-8 bytes for both inspection and saving", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-import-bytes-")), service = new ModelProxyService(root, () => {});
  try {
    for (const source of ["x".repeat(2_000_001), "界".repeat(700_000)]) {
      for (const op of ["inspect", "save"]) {
        await assert.rejects(service.command(command(op, { revision: "", source, name: "Too large", kernel: "mihomo", node: "node" })), { code: "INVALID_INPUT" });
      }
    }
    assert.equal(service.snapshot().profiles.length, 0);
    assertClean(root);
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
});

const native = process.env.AXIOM_TEST_MIHOMO;
test("installed mihomo imports URI and Base64 natively, including an unnamed node", { skip: !native, timeout: 20000 }, async () => {
  const { root, installation } = fixture(native);
  const uri = "vless://11111111-1111-4111-8111-111111111111@example.invalid:443?encryption=none&security=tls&type=tcp";
  try {
    for (const [source, name] of [[uri, "未命名节点"], [`${uri}#${encodeURIComponent("香港 🚀")}`, "香港 🚀"], [Buffer.from(`${uri}#base64`).toString("base64"), "base64"]]) {
      const nodes = await inspectProxySource(root, installation, source, AbortSignal.timeout(5000));
      assert.deepEqual(nodes, [{ name, type: "Vless" }]); assertClean(root);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
