import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { atomicProxyJson, proxyConfigPath, proxyDirectory, proxyExecutable, readProxyConfig } from "../src/server/integrations/model-proxy-config.js";
import { inspectProxySource } from "../src/server/integrations/model-proxy-import.js";
import { ModelProxyService } from "../src/server/integrations/model-proxy.js";

const command = (op: string, params: Record<string, unknown> = {}) => ({ op: `modelProxy.${op}`, requestId: randomUUID(), params });
function fixture(native?: string) {
  const root = mkdtempSync(join(tmpdir(), "axiom-proxy-import-"));
  const installation = { version: "1.19.33", directory: `mihomo-1.19.33-${randomUUID()}` };
  const executable = proxyExecutable(root, "mihomo", installation);
  mkdirSync(dirname(executable), { recursive: true });
  if (native) copyFileSync(native, executable);
  else writeFileSync(executable, `#!${process.execPath}
const fs=require('node:fs'),http=require('node:http');
const c=JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('-f')+1]));
if(c['mixed-port']!==0||c.tun.enable||c.dns.enable||!c.secret)process.exit(2);
const source=fs.readFileSync(c['proxy-providers'].source.path,'utf8');
http.createServer((req,res)=>{if(req.headers.authorization!=='Bearer '+c.secret){res.writeHead(401);res.end();return;}
res.end(JSON.stringify({proxies:source==='hold'?[]:[{name:'香港 (A)',type:'Vless'}]}));
}).listen(Number(c['external-controller'].split(':').pop()),'127.0.0.1');
`, { mode: 0o700 });
  atomicProxyJson(proxyConfigPath(root), { revision: "initial", profiles: [], installations: { mihomo: installation }, bindings: {} });
  return { root, installation };
}
async function completed(service: ModelProxyService) {
  const deadline = Date.now() + 8000;
  while (service.snapshot().job?.running && Date.now() < deadline) await delay(20);
  assert.equal(service.snapshot().job?.running, false);
  return service.snapshot();
}
function assertClean(root: string) {
  const imports = join(proxyDirectory(root), "imports");
  assert.deepEqual(existsSync(imports) ? readdirSync(imports) : [], []);
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

test("inspection returns only node metadata, does not save a profile, and cleans its process directory", { skip: process.platform === "win32", timeout: 12000 }, async () => {
  const { root } = fixture(), service = new ModelProxyService(root, () => {});
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

test("inspection cancellation and service close stop the job, reject concurrent writes and clean imports", { skip: process.platform === "win32", timeout: 15000 }, async () => {
  const { root } = fixture(), service = new ModelProxyService(root, () => {});
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
