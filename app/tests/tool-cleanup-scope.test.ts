import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "./temporary.js";
import { cleanupScope, assertCleanupScope } from "../src/server/integrations/cleanup-scope.js";
import { OpenCliService } from "../src/server/integrations/opencli.js";
import { openCliFixture } from "./fixtures/opencli.js";
import { openCliConfigPath, readOpenCliConfig } from "../src/server/integrations/opencli-runtime.js";
import { ReaService } from "../src/server/integrations/rea.js";
import { atomicReaJson, readReaConfig, reaConfigPath, reaDirectory, type ReaConfig } from "../src/server/integrations/rea-runtime.js";
import { removeRea } from "../src/server/integrations/rea-removal.js";
import { ModelProxyService } from "../src/server/integrations/model-proxy.js";
import { beginBuiltinOperation } from "../src/server/integrations/builtin-operation.js";
import { atomicProxyJson, readProxyConfig, proxyConfigPath, proxyDirectory, type ProxyConfig } from "../src/server/integrations/model-proxy-config.js";

const turn = () => new Promise<void>(resolve => setImmediate(resolve));
async function settle(service: { snapshot(): { job?: { running: boolean; error?: string } } }) {
  const deadline = Date.now() + 5000;
  await turn();
  while (service.snapshot().job?.running) { assert.ok(Date.now() < deadline, "maintenance must settle"); await turn(); }
}
function directory(parent: string, name: string) { const path = join(parent, name); fs.mkdirSync(path, { recursive: true }); return path; }

test("cleanup confirmation binds candidate set and directory identity, while order is immaterial", () => {
  const root = fs.mkdtempSync(join(tmpdir(), "cleanup-scope-"));
  try {
    const a = directory(root, "a"), b = directory(root, "b"), missing = join(root, "missing");
    const scope = cleanupScope([b, a, a, missing]);
    assert.deepEqual(scope, cleanupScope([missing, a, b]));
    fs.renameSync(a, join(root, "original")); directory(root, "a");
    assert.throws(() => assertCleanupScope(scope.revision, cleanupScope(scope.paths)), /范围已变化/);
    const current = cleanupScope(scope.paths);
    directory(root, "missing");
    assert.throws(() => assertCleanupScope(current.revision, cleanupScope(current.paths)), /范围已变化/);
    assert.throws(() => cleanupScope(Array.from({ length: 1025 }, (_, i) => join(root, String(i)))), /核实上限/);
    const link = join(root, "link"); fs.symlinkSync(b, link, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => cleanupScope([link]), /身份无效/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("OpenCLI orphan preview is read-only and a stale preview does not block forced uninstall", async () => {
  const f = openCliFixture();
  const parent = join(f.root, "integrations", "opencli", "versions");
  const first = directory(parent, `v1.8.8-${randomUUID()}`);
  const own = (path: string) => { const operation = beginBuiltinOperation(f.root, "opencli"); try { operation.trackDirectory(path); operation.finish(); } finally { operation.close(); } };
  own(first);
  let barriers = 0, mutateGate: (() => void) | undefined;
  const s = new OpenCliService(f.root, () => {}, async () => { throw Error("preview must not execute"); }, f.locateNpm, undefined, async work => { barriers++; mutateGate?.(); mutateGate = undefined; await turn(); return work(); });
  try {
    const before = s.snapshot();
    assert.deepEqual(before.cleanup?.paths, [first]);
    assert.deepEqual(s.snapshot().cleanup, before.cleanup);
    assert.equal(fs.existsSync(openCliConfigPath(f.root)), false);
    const second = directory(parent, `v1.8.9-${randomUUID()}`); own(second);
    await s.command({ requestId: randomUUID(), op: "opencli.uninstall", params: { confirm: true, revision: before.revision, cleanupRevision: before.cleanup!.revision } });
    await settle(s); assert.equal(s.snapshot().job?.error, undefined, "component standard: no scope check");
    assert.equal(barriers, 1); void mutateGate;
    assert.equal(fs.existsSync(first), false); assert.equal(fs.existsSync(second), false);
    assert.equal(readOpenCliConfig(f.root)!.detached, true);
    assert.deepEqual(s.snapshot().cleanup?.paths, []);
  } finally { await s.close(); fs.rmSync(f.root, { recursive: true, force: true }); }
});

for (const engine of [undefined, "java"] as const) test(`REA ${engine || "program"} preview lists only owned scope; a replaced directory does not block forced uninstall`, async () => {
  const root = fs.mkdtempSync(join(tmpdir(), "rea-scope-"));
  const programName = `v6.7.0-${randomUUID()}`, engineName = `java-${randomUUID()}`;
  const program = directory(join(reaDirectory(root), "versions"), programName);
  const java = directory(join(reaDirectory(root), "engines"), engineName);
  const external = directory(root, "external-java");
  const unknown = directory(join(reaDirectory(root), "engines"), `java-${randomUUID()}`);
  const config: ReaConfig = { format: 1, revision: randomUUID(), enabled: true, skillInstalled: false, mcpInstalled: false, installation: { version: "6.7.0", directory: programName }, engines: { java: external }, managedEngines: { java: [{ directory: engineName, path: java }] } };
  atomicReaJson(reaConfigPath(root), config);
  let barriers = 0;
  const s = new ReaService(root, () => {}, { removal: async work => { barriers++; return work(); } });
  try {
    const bytes = fs.readFileSync(reaConfigPath(root), "utf8");
    const state = s.snapshot(), scope = engine ? state.engines!.find(item => item.id === engine)!.cleanup! : state.cleanup!;
    assert.deepEqual(scope.paths, [engine ? java : program]);
    assert.deepEqual(state.engines!.find(item => item.id === 'java')!.cleanupUnverified, [unknown]);
    assert.equal(fs.readFileSync(reaConfigPath(root), "utf8"), bytes);
    const target = scope.paths[0]; fs.renameSync(target, join(root, "original")); fs.mkdirSync(target);
    assert.throws(() => removeRea(root, config.revision, engine, scope.revision), /范围已变化/);
    await s.command({ op: engine ? 'rea.engine-uninstall' : 'rea.uninstall', requestId: randomUUID(), params: { confirm: true, revision: engine ? state.engines!.find(item => item.id === engine)!.revision : state.revision, cleanupRevision: scope.revision, ...(engine ? { engine } : {}) } });
    await settle(s); assert.equal(s.snapshot().job?.error, undefined);
    assert.equal(fs.existsSync(target), false); assert.ok(fs.existsSync(external), "external files are kept");
    const after = readReaConfig(root);
    if (engine) { assert.equal(after.engines?.java, undefined); assert.equal(fs.existsSync(unknown), false); assert.equal(after.installation?.directory, programName); }
    else { assert.equal(after.installation, undefined); assert.ok(fs.existsSync(java), "program uninstall keeps engine directories"); }
  } finally { await s.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

for (const importer of [false, true]) test(`Xray ${importer ? "importer" : "core"} changes after preview do not block forced uninstall`, async () => {
  const root = fs.mkdtempSync(join(tmpdir(), "proxy-scope-"));
  const parent = join(proxyDirectory(root), importer ? "importer" : "versions");
  const name = importer ? "xray-knife-11.4.1-win32-x64" : `xray-1.0.0-${randomUUID()}`;
  const first = directory(parent, name);
  const config: ProxyConfig = { revision: randomUUID(), installations: importer ? {} : { xray: { directory: name, version: "1.0.0" } }, profiles: [], bindings: {} };
  atomicProxyJson(proxyConfigPath(root), config);
  const s = new ModelProxyService(root, () => {});
  try {
    const bytes = fs.readFileSync(proxyConfigPath(root), "utf8"), before = s.snapshot();
    const scope = before.cleanup!.xray!;
    assert.deepEqual(scope.paths, [first]);
    assert.deepEqual(s.snapshot().cleanup!.xray, scope);
    assert.equal(fs.readFileSync(proxyConfigPath(root), "utf8"), bytes);
    const added = directory(parent, importer ? "xray-knife-11.4.0-win32-x64" : `xray-0.9.0-${randomUUID()}`);
    await s.command({ requestId: randomUUID(), op: "modelProxy.uninstall", params: { revision: before.revision, confirm: true, cleanupRevision: scope.revision, kernel: "xray" } });
    await settle(s);
    assert.equal(s.snapshot().job?.error, undefined);
    assert.equal(fs.existsSync(first), false); assert.equal(fs.existsSync(added), false);
    assert.equal(readProxyConfig(root).installations.xray, undefined);
  } finally { await s.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
