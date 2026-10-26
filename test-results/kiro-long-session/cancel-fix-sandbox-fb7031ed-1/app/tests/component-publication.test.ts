import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import fs, { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { OpenCliService } from "../src/server/integrations/opencli.js";
import { ReaService } from "../src/server/integrations/rea.js";
import { openCliConfigPath, readOpenCliConfig } from "../src/server/integrations/opencli-runtime.js";
import { reaConfigPath, reaNode, reaPackageRoot, reaSupportedNode, readReaConfig } from "../src/server/integrations/rea-runtime.js";
import { engineVersionPolicy, installedEngineVersion } from "../src/server/integrations/rea-engine-policy.js";
import { listEngines } from "../src/server/integrations/rea-engines.js";
import { openCliFixture } from "./fixtures/opencli.js";
import { reaFixture, writeReaPackage } from "./rea-fixture.js";
import { tmpdir } from "./temporary.js";

const command = (op: string, params = {}) => ({ requestId: randomUUID(), op, params });
async function settle(service: OpenCliService | ReaService) {
  const deadline = Date.now() + 15_000;
  while (service.snapshot().job?.running) { assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 5)); }
}
const temporary = () => mkdtempSync(join(tmpdir(), "axiom-component-publication-"));

test("OpenCLI clears private runtime labels when returning to legacy or unreadable configuration", async () => {
  const f = openCliFixture(), service = new OpenCliService(f.root, () => {}, f.execute, f.locateNpm, undefined, undefined, f.runtime);
  try {
    await service.command(command("opencli.check")); await settle(service);
    await service.command(command("opencli.install", { version: "1.8.8" })); await settle(service);
    assert.equal(service.snapshot().runtimeManaged, true); assert.ok(service.snapshot().npmVersion);
    const current = readOpenCliConfig(f.root)!;
    writeFileSync(openCliConfigPath(f.root), JSON.stringify({ ...current, runtime: undefined }));
    await service.command(command("opencli.refresh")); await settle(service);
    assert.equal(service.snapshot().runtimeManaged, false); assert.equal(service.snapshot().nodeVersion, process.version);
    assert.equal(service.snapshot().npmVersion, undefined, "private npm is not reported as a legacy dependency");
    writeFileSync(openCliConfigPath(f.root), "broken");
    await service.command(command("opencli.refresh")); await settle(service);
    assert.equal(service.snapshot().nodeVersion, ""); assert.equal(service.snapshot().npmVersion, undefined);
    assert.equal(service.snapshot().runtimeManaged, false); assert.ok(service.snapshot().error);
  } finally { await service.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("REA clears stale runtime labels, reports legacy patch incompatibility and still permits private installation", async () => {
  const root = temporary(), f = reaFixture(), service = new ReaService(root, () => {}, f.dependencies);
  try {
    await service.command(command("rea.install", { version: "6.7.0" })); await settle(service);
    assert.equal(service.snapshot().runtimeManaged, true); assert.ok(service.snapshot().npmVersion);
    writeFileSync(reaConfigPath(root), "broken"); await service.command(command("rea.refresh"));
    assert.equal(service.snapshot().nodeVersion, ""); assert.equal(service.snapshot().runtimeManaged, false);
    assert.equal(service.snapshot().npmVersion, undefined); assert.ok(service.snapshot().error);
    assert.equal(reaSupportedNode("22.23.2", "^22.23.4 || ^24.22.1 || >=26.12.1"), false);
    assert.equal(reaSupportedNode("22.23.4", "^22.23.4 || ^24.22.1 || >=26.12.1"), true);
    const directory = `v6.8.0-${randomUUID()}`;
    writeReaPackage(join(root, "integrations", "rea", "versions", directory, "node_modules", "rea-agents"), "6.8.0");
    writeFileSync(reaConfigPath(root), JSON.stringify({ format: 1, revision: "legacy", enabled: true, installation: { version: "6.8.0", directory } }));
    await service.command(command("rea.refresh"));
    assert.equal(service.snapshot().supported, true, "a legacy incompatibility never disables the repair/install action");
    if (!reaSupportedNode(process.versions.node, "^22.23.4 || ^24.22.1 || >=26.12.1")) assert.match(service.snapshot().mcpError!, /无需升级后台 Node/);
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("REA rejects unreviewed tool/dependency contracts before runtime preparation or npm installation", async () => {
  const root = temporary(), f = reaFixture(), service = new ReaService(root, () => {}, f.dependencies);
  try {
    await service.command(command("rea.install", { version: "6.7.0" })); await settle(service);
    const original = readFileSync(reaConfigPath(root), "utf8"), calls = f.calls.length;
    f.setLatest("6.9.0"); await service.command(command("rea.check")); await settle(service);
    await service.command(command("rea.install", { version: "6.9.0" })); await settle(service);
    assert.match(service.snapshot().job!.error!, /配套依赖契约尚未验证/);
    assert.equal(readFileSync(reaConfigPath(root), "utf8"), original); assert.equal(f.calls.length, calls);
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("REA updates retain dependency paths and downloads but invalidate checks tied to the previous program", async () => {
  const root = temporary(), f = reaFixture(); let checks = 0;
  f.dependencies.checkEngines = async (_root, config) => { checks++; return listEngines(config).map(item => item.id === "java" ? { ...item, status: "ready", checkedAt: Date.now() } : item); };
  const service = new ReaService(root, () => {}, f.dependencies);
  try {
    await service.command(command("rea.install", { version: "6.7.0" })); await settle(service);
    const java = join(root, "external jdk"), directory = `ghidra-${randomUUID()}`, cache = join(root, "integrations", "rea", "downloads", directory), data = Buffer.from("fixture cached release");
    fs.mkdirSync(java); fs.mkdirSync(cache, { recursive: true });
    writeFileSync(join(java, "release"), 'JAVA_RUNTIME_VERSION="21.0.13+9-LTS"\n');
    writeFileSync(join(cache, "package.zip"), data);
    writeFileSync(join(cache, "source.json"), JSON.stringify({ installed: false, version: "12.1.4", format: "zip", url: "https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_12.1.4_build/fixture.zip", sha256: createHash("sha256").update(data).digest("hex"), size: data.length }));
    const previous = { ...readReaConfig(root), revision: randomUUID(), engines: { java }, downloads: { ghidra: { directory, filename: "package.zip" as const, version: "12.1.4" } } };
    writeFileSync(reaConfigPath(root), JSON.stringify(previous));
    await service.command(command("rea.engines-check")); await settle(service);
    assert.equal(service.snapshot().engines!.find(item => item.id === "java")!.status, "ready");
    const checkedRevision = service.snapshot().engines!.find(item => item.id === "java")!.validationRevision;
    f.setLatest("6.8.0"); await service.command(command("rea.check")); await settle(service);
    await service.command(command("rea.install", { version: "6.8.0" })); await settle(service);
    assert.equal(service.snapshot().job?.error, undefined); assert.equal(service.snapshot().version, "6.8.0");
    const current = readReaConfig(root), engine = service.snapshot().engines!.find(item => item.id === "java")!;
    assert.deepEqual(current.engines, previous.engines); assert.deepEqual(current.downloads, previous.downloads);
    assert.equal(engine.status, "unchecked"); assert.equal(engine.checkedAt, undefined);
    assert.notEqual(engine.validationRevision, checkedRevision);
    assert.equal(checks, 1, "package MCP validation is not a provider doctor or automatic dependency install");
    assert.deepEqual(readFileSync(join(cache, "package.zip")), data);
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
});

for (const tool of ["rea", "opencli"] as const) test(`${tool} retains a published installation and reports the commit if directory sync fails`, { skip: process.platform === "win32" }, async t => {
  const f = openCliFixture(), rea = reaFixture();
  const service = tool === "rea" ? new ReaService(f.root, () => {}, { ...rea.dependencies, diagnose: async () => ({ text: "fixture", toolCount: 1, at: Date.now() }) }) : new OpenCliService(f.root, () => {}, f.execute, f.locateNpm, undefined, undefined, f.runtime);
  const sync = fs.fsyncSync; let injected = false;
  const mock = t.mock.method(fs, "fsyncSync", ((fd: number) => {
    const published = tool === "rea" ? !!readReaConfig(f.root).installation?.runtime : !!readOpenCliConfig(f.root)?.runtime;
    if (!injected && published && fs.fstatSync(fd).isDirectory()) { injected = true; throw Error("fixture directory sync failure"); }
    return sync(fd);
  }) as typeof fs.fsyncSync); syncBuiltinESMExports();
  try {
    if (tool === "opencli") { await service.command(command("opencli.check")); await settle(service); }
    await service.command(command(`${tool}.install`, { version: tool === "rea" ? "6.7.0" : "1.8.8" })); await settle(service);
    assert.ok(injected); assert.match(service.snapshot().job!.error!, /已切换至/);
    assert.match(service.snapshot().job!.message, /新版本已生效/);
    const packageRoot = tool === "rea" ? reaPackageRoot(f.root) : readOpenCliConfig(f.root)?.packageRoot;
    assert.ok(packageRoot && existsSync(packageRoot));
    if (tool === "rea") assert.ok(existsSync(reaNode(f.root)));
  } finally { mock.mock.restore(); syncBuiltinESMExports(); await service.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("Ghidra version metadata and compatibility accept the upstream release spelling, not arbitrary latest", () => {
  const root = temporary();
  try {
    fs.mkdirSync(join(root, "Ghidra"));
    for (const version of ["12.1", "12.1.4", "12.1.5-DEV", "12.1.4+build"]) {
      writeFileSync(join(root, "Ghidra", "application.properties"), `application.version=${version}\n`);
      assert.equal(installedEngineVersion("ghidra", root), version);
      for (const rea of ["6.7.0", "6.8.0"]) assert.equal(engineVersionPolicy("ghidra", version, rea).compatibility, "compatible");
    }
    for (const version of ["12.2.0", "13.0.0", "12.1-invalid\nline"]) assert.equal(engineVersionPolicy("ghidra", version, "6.8.0").compatibility, "incompatible");
    assert.equal(engineVersionPolicy("ghidra", "12.1.4", "6.9.0").compatibility, "unknown");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
