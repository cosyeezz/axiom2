import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { ReaService, type ReaDependencies } from "../src/server/integrations/rea.js";
import { checkEngines, listEngines } from "../src/server/integrations/rea-engines.js";
import { prepareEngineDownload, reuseEngineDownload, storedEngineDownload } from "../src/server/integrations/rea-engine-download.js";
import { atomicReaJson, reaConfigPath, readReaConfig, type ReaConfig } from "../src/server/integrations/rea-runtime.js";
import { engineDownloadSatisfied, engineRecommendationSatisfied, type ReaEngineDownload } from "../src/shared/rea-engines.js";
import type { EngineRelease } from "../src/server/integrations/rea-engine-install.js";
import { fixtureEngineRelease, writeReaPackage } from "./rea-fixture.js";
import { tmpdir } from "./temporary.js";

const signal = () => new AbortController().signal;
const temporary = () => mkdtempSync(join(tmpdir(), "axiom-rea-reuse-"));
const call = (service: ReaService, op: string, params = {}) => service.command({ requestId: randomUUID(), op, params });
async function settle(service: ReaService) {
  const deadline = Date.now() + 10_000;
  while (service.snapshot().jobs?.some(job => job.running)) { assert.ok(Date.now() < deadline, "job timed out"); await new Promise(resolve => setTimeout(resolve, 5)); }
  return service.snapshot();
}
function config(root: string): ReaConfig {
  const directory = `v6.7.0-${randomUUID()}`;
  writeReaPackage(join(root, "integrations", "rea", "versions", directory, "node_modules", "rea-agents"), "6.7.0");
  const value: ReaConfig = { format: 1, revision: randomUUID(), enabled: false, installation: { version: "6.7.0", directory } };
  atomicReaJson(reaConfigPath(root), value); return value;
}
function selection(service: ReaService, id: "java" | "hopper") {
  const item = service.snapshot().engines!.find(item => item.id === id)!;
  assert.ok(item.available);
  return { engine: id, revision: item.revision, token: item.available.token, version: item.available.version };
}
const data = Buffer.from("fixture Hopper DMG: never executed");
const release: EngineRelease = { version: "6.6.0", format: "dmg", url: "https://www.hopperapp.com/downloader/public/Hopper-6.6.0-demo.dmg", sha1: createHash("sha1").update(data).digest("hex"), size: data.length };
async function downloaded(root: string) {
  const prepared = await prepareEngineDownload(root, "hopper", release, signal(), () => {}, async () => new Response(data));
  const record: ReaEngineDownload = { directory: basename(prepared.directory), filename: prepared.filename, version: release.version };
  return { ...prepared, record };
}

test("equivalent installed JDK is revalidated without downloading and its recommendation survives restart", async () => {
  const root = temporary(), initial = config(root), java = join(root, "external JDK");
  mkdirSync(java); writeFileSync(join(java, "release"), 'JAVA_RUNTIME_VERSION="21.0.13+9-LTS"\n');
  initial.engines = { java }; atomicReaJson(reaConfigPath(root), initial);
  let preparations = 0, probes = 0;
  const dependencies: ReaDependencies = {
    engineRelease: async id => ({ ...await fixtureEngineRelease(id), version: "21.0.13+9.0.LTS" }),
    prepareEngine: async () => { preparations++; throw Error("equivalent version must not be downloaded"); },
    checkEngines: (root, value, packageRoot, sig, _run, only) => checkEngines(root, value, packageRoot, sig, async (_file, args) => {
      probes++; return { code: 0, stdout: args.includes("--list-modules") ? "jdk.compiler@21.0.13\n" : "", stderr: "java.version = 21.0.13\n" };
    }, only),
  };
  const service = new ReaService(root, () => {}, dependencies);
  try {
    await call(service, "rea.engine-check", { engine: "java" }); await settle(service);
    assert.equal(engineRecommendationSatisfied(service.snapshot().engines![0]), true);
    await call(service, "rea.engine-install", selection(service, "java")); const state = await settle(service);
    assert.equal(state.job?.error, undefined); assert.equal(state.job?.message, "已是推荐版本。");
    assert.equal(preparations, 0); assert.equal(probes, 4, "both the check and no-op installation verify the JDK");
    assert.equal(readReaConfig(root).engines?.java, java); assert.equal(readReaConfig(root).managedEngines, undefined);
    const restarted = new ReaService(root, () => {}, dependencies);
    try {
      const item = restarted.snapshot().engines![0];
      assert.equal(item.version, "21.0.13+9-LTS"); assert.equal(item.recommendedVersion, "21.0.13+9.0.LTS");
      assert.equal(item.available, undefined); assert.equal(engineRecommendationSatisfied(item), true);
      await call(restarted, "rea.refresh"); assert.equal(probes, 4, "refresh does not execute the JDK");
    } finally { await restarted.close(); }
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("an equal version with a failed environment check is repaired rather than silently reused", async () => {
  const root = temporary(), initial = config(root), java = join(root, "broken-jdk");
  mkdirSync(java); writeFileSync(join(java, "release"), 'JAVA_RUNTIME_VERSION="21.0.13+8-LTS"\n');
  initial.engines = { java }; atomicReaJson(reaConfigPath(root), initial); let preparations = 0;
  const service = new ReaService(root, () => {}, {
    engineRelease: fixtureEngineRelease,
    checkEngines: async (_root, value) => listEngines(value).map(item => item.id === "java" ? { ...item, checkedAt: Date.now(), status: item.path === java ? "error" : "ready" } : item),
    prepareEngine: async () => {
      preparations++; const directory = join(root, "integrations", "rea", "engines", `java-${randomUUID()}`);
      mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, "release"), 'JAVA_RUNTIME_VERSION="21.0.13+8-LTS"\n');
      return { directory, path: directory };
    },
  });
  try {
    await call(service, "rea.engine-check", { engine: "java" }); await settle(service);
    assert.equal(engineRecommendationSatisfied(service.snapshot().engines![0]), false);
    await call(service, "rea.engine-install", selection(service, "java")); const state = await settle(service);
    assert.equal(state.job?.error, undefined); assert.equal(preparations, 1);
    assert.notEqual(readReaConfig(root).engines?.java, java); assert.ok(existsSync(java));
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("managed versions survive restart, while explicit unknown JAR results and missing files stay unknown", () => {
  const root = temporary(), initial = config(root), directory = `jadx-${randomUUID()}`, managed = join(root, "integrations", "rea", "engines", directory), jar = join(managed, "jadx.jar");
  mkdirSync(managed, { recursive: true }); writeFileSync(jar, "unknown jar");
  writeFileSync(join(managed, "source.json"), JSON.stringify({ version: "0.7.1" }));
  initial.engines = { jadx: jar }; initial.managedEngines = { jadx: [{ directory, path: jar }] };
  try {
    const items = listEngines(initial), item = items.find(item => item.id === "jadx")!;
    assert.equal(item.version, "0.7.1", "legacy source metadata supplies the passive version");
    item.version = undefined; item.checkedAt = Date.now(); item.status = "ready";
    assert.equal(listEngines(initial, items).find(item => item.id === "jadx")!.version, undefined, "do not overwrite an explicit unknown JAR digest with metadata");
    rmSync(jar);
    const missing = listEngines(initial).find(item => item.id === "jadx")!;
    assert.equal(missing.version, undefined); assert.equal(missing.status, "missing"); assert.equal(engineRecommendationSatisfied(missing), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("cached packages require the exact release, a fresh digest and ordinary files", async () => {
  const root = temporary();
  try {
    const packageFile = await downloaded(root);
    assert.equal((await reuseEngineDownload(root, "hopper", packageFile.record, release, signal()))?.path, packageFile.path);
    assert.equal(await reuseEngineDownload(root, "hopper", packageFile.record, { ...release, version: "6.6.1" }, signal()), undefined);
    writeFileSync(packageFile.path, Buffer.alloc(data.length, 88));
    assert.equal(await reuseEngineDownload(root, "hopper", packageFile.record, release, signal()), undefined);
    assert.ok(existsSync(packageFile.path), "bad existing packages are retained");
    for (const size of ["wrong", 1.5, null, -1]) {
      writeFileSync(join(packageFile.directory, "source.json"), JSON.stringify({ ...release, size, installed: false }));
      assert.equal(storedEngineDownload(root, "hopper", packageFile.record), undefined, "malformed sizes must not break refresh");
    }
    writeFileSync(join(packageFile.directory, "source.json"), JSON.stringify({ ...release, installed: false }));
    rmSync(packageFile.path); assert.equal(storedEngineDownload(root, "hopper", packageFile.record), undefined);
    const outside = join(root, "outside.dmg"); writeFileSync(outside, data); symlinkSync(outside, packageFile.path);
    assert.throws(() => storedEngineDownload(root, "hopper", packageFile.record), { code: "stop-unconfirmed" });
    assert.deepEqual(readFileSync(outside), data);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("cancelling cached-package verification preserves the original download", async () => {
  const root = temporary();
  try {
    const packageFile = await downloaded(root), controller = new AbortController(); controller.abort();
    await assert.rejects(reuseEngineDownload(root, "hopper", packageFile.record, release, controller.signal));
    assert.deepEqual(readFileSync(packageFile.path), data);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("manual download requests reuse verified packages after refresh and restart", { skip: process.platform !== "darwin" }, async () => {
  const root = temporary(); config(root); let preparations = 0;
  const dependencies: ReaDependencies = {
    engineRelease: async () => release,
    checkEngines: async (_root, value) => listEngines(value),
    prepareEngineDownload: async (root, id, selected, sig, notify) => {
      preparations++; return prepareEngineDownload(root, id, selected, sig, notify, async () => new Response(data));
    },
  };
  let service = new ReaService(root, () => {}, dependencies);
  try {
    await call(service, "rea.engine-check", { engine: "hopper" }); await settle(service);
    await call(service, "rea.engine-download", selection(service, "hopper")); await settle(service);
    const saved = readReaConfig(root).downloads!.hopper!, path = service.snapshot().engines!.find(item => item.id === "hopper")!.download!.path;
    assert.equal(preparations, 1);
    await service.close(); service = new ReaService(root, () => {}, dependencies);
    assert.equal(engineDownloadSatisfied(service.snapshot().engines!.find(item => item.id === "hopper")!), true);
    await call(service, "rea.engine-check", { engine: "hopper" }); await settle(service);
    await call(service, "rea.engine-download", selection(service, "hopper")); const state = await settle(service);
    assert.equal(state.job?.error, undefined); assert.match(state.job!.message, /复用/); assert.equal(preparations, 1);
    assert.deepEqual(readReaConfig(root).downloads!.hopper, saved); assert.deepEqual(readFileSync(path), data);
    writeFileSync(path, Buffer.alloc(data.length, 90));
    await call(service, "rea.engine-check", { engine: "hopper" }); await settle(service);
    assert.equal(readReaConfig(root).downloads?.hopper, undefined, "a failed digest removes only the stale registration");
    assert.ok(existsSync(path)); assert.equal(service.snapshot().engines!.find(item => item.id === "hopper")!.download, undefined);
    await call(service, "rea.engine-download", selection(service, "hopper")); await settle(service);
    assert.equal(preparations, 2); assert.notEqual(readReaConfig(root).downloads!.hopper!.directory, saved.directory); assert.ok(existsSync(path));
    const latest = service.snapshot().engines!.find(item => item.id === "hopper")!.download!.path;
    rmSync(latest); await call(service, "rea.refresh");
    assert.equal(engineDownloadSatisfied(service.snapshot().engines!.find(item => item.id === "hopper")!), false);
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
});
