import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compareEngineVersions } from "../src/shared/rea-engines.js";
import { ReaService } from "../src/server/integrations/rea.js";
import { checkEngines, listEngines } from "../src/server/integrations/rea-engines.js";
import { downloadEngineFile, engineRelease, officialEngineUrl, type EngineRelease } from "../src/server/integrations/rea-engine-install.js";
import { prepareEngineDownload } from "../src/server/integrations/rea-engine-download.js";
import { engineVersionPolicy, installedEngineVersion } from "../src/server/integrations/rea-engine-policy.js";
import { atomicReaJson, reaConfigPath, readReaConfig, type ReaConfig } from "../src/server/integrations/rea-runtime.js";
import { fixtureEngineRelease, writeReaPackage } from "./rea-fixture.js";
import { tmpdir } from "./temporary.js";

const temporary = () => mkdtempSync(join(tmpdir(), "axiom-rea-maintenance-"));
const signal = () => new AbortController().signal;
const call = (service: ReaService, op: string, params = {}) => service.command({ requestId: randomUUID(), op, params });
async function settle(service: ReaService) {
  const deadline = Date.now() + 10_000;
  while (service.snapshot().job?.running) { assert.ok(Date.now() < deadline, "REA job timed out"); await new Promise(resolve => setTimeout(resolve, 5)); }
  return service.snapshot();
}
function config(root: string): ReaConfig {
  const directory = `v6.7.0-${randomUUID()}`;
  writeReaPackage(join(root, "integrations", "rea", "versions", directory, "node_modules", "rea-agents"), "6.7.0");
  const value: ReaConfig = { format: 1, revision: randomUUID(), enabled: false, installation: { version: "6.7.0", directory } };
  atomicReaJson(reaConfigPath(root), value); return value;
}
const dmg = Buffer.from("fixture DMG: never mounted or executed");
const hopper: EngineRelease = { version: "6.6.0", url: "https://www.hopperapp.com/downloader/public/Hopper-6.6.0-demo.dmg", format: "dmg", size: dmg.length, sha1: createHash("sha1").update(dmg).digest("hex") };

test("Hopper release feed selects the stable macOS package and validates source metadata", async () => {
  const item = { version: "6.6.0", public: "1", beta: "0", filename: hopper.url.replace(".com/", ".com:443/"), file_hash: hopper.sha1, file_length: String(dmg.length), deployment_target: "12.4" };
  const release = await engineRelease("hopper", signal(), { platform: "darwin", arch: "arm64" }, async url => {
    assert.equal(url, "https://www.hopperapp.com/include/files-api.php?request=releases&public=true");
    return Response.json({ "OS X": item, Linux: { version: "9.9.9" } });
  });
  assert.deepEqual(release, { ...hopper, minimumSystem: "macOS 12.4+" });
  for (const patch of [{ beta: "1" }, { public: "0" }, { file_hash: "invalid" }, { file_length: "0" }, { filename: "https://evil.test/Hopper-6.6.0-demo.dmg" }, { filename: hopper.url.replace("6.6.0", "6.5.0") }]) {
    await assert.rejects(engineRelease("hopper", signal(), { platform: "darwin", arch: "x64" }, async () => Response.json({ "OS X": { ...item, ...patch } })));
  }
  for (const url of ["https://www.hopperapp.com/other.dmg", `${hopper.url}?untrusted=1`, hopper.url.replace("www.hopperapp.com", "hopperapp.com.evil.test")]) assert.throws(() => officialEngineUrl(url));
  await assert.rejects(engineRelease("hopper", signal(), { platform: "win32", arch: "x64" }));
});

test("manual downloads verify SHA-1 and length, record origin, and clean failed or cancelled candidates", async () => {
  const root = temporary(); let fetches = 0;
  const fetcher = async () => { fetches++; return new Response(dmg); };
  try {
    const installed = await prepareEngineDownload(root, "hopper", hopper, signal(), () => {}, fetcher);
    assert.deepEqual(readFileSync(installed.path), dmg);
    assert.equal(JSON.parse(readFileSync(join(installed.directory, "source.json"), "utf8")).installed, false);
    for (const release of [{ ...hopper, sha1: "0".repeat(40) }, { ...hopper, size: dmg.length + 1 }]) {
      await assert.rejects(prepareEngineDownload(root, "hopper", release, signal(), () => {}, fetcher), /SHA-1/);
    }
    const before = fetches;
    await assert.rejects(downloadEngineFile({ ...hopper, sha1: undefined }, join(root, "bad"), signal(), fetcher), /校验值/);
    assert.equal(fetches, before, "invalid metadata must be rejected before opening a response");
    const controller = new AbortController(); controller.abort();
    await assert.rejects(prepareEngineDownload(root, "hopper", hopper, controller.signal, () => {}, fetcher));
    assert.equal(readdirSync(join(root, "integrations", "rea", "downloads")).length, 1);
    assert.equal(existsSync(reaConfigPath(root)), false, "download alone never installs or edits configuration");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("versions come from local metadata and REA policy, and newer local builds are never labelled updates", () => {
  const root = temporary();
  try {
    writeFileSync(join(root, "release"), 'JAVA_VERSION="21.0.13"\nJAVA_RUNTIME_VERSION="21.0.13+8-LTS"\n');
    assert.equal(installedEngineVersion("java", root), "21.0.13+8-LTS");
    mkdirSync(join(root, "Ghidra")); writeFileSync(join(root, "Ghidra", "application.properties"), "application.version=12.1.5\n");
    assert.equal(installedEngineVersion("ghidra", root), "12.1.5");
    mkdirSync(join(root, "Contents", "MacOS"), { recursive: true });
    writeFileSync(join(root, "Contents", "Info.plist"), "<plist><dict><key>CFBundleShortVersionString</key><string>6.6.0</string></dict></plist>");
    assert.equal(installedEngineVersion("hopper", join(root, "Contents", "MacOS", "hopper")), "6.6.0");
    for (const [id, version, compatibility] of [["ghidra", "12.1.5", "compatible"], ["ghidra", "12.2.0", "incompatible"], ["jadx", "0.7.0", "incompatible"], ["wabt", "1.0.42", "compatible"], ["java", "16.0.2", "incompatible"], ["hopper", "6.6.0", "unknown"]] as const) assert.equal(engineVersionPolicy(id, version, "6.7.0").compatibility, compatibility);
    assert.equal(engineVersionPolicy("ghidra", "12.1.4", "6.8.0").compatibility, "unknown");
    assert.equal(compareEngineVersions("12.1.4", "12.1.5"), -1);
    assert.equal(compareEngineVersions("21.0.13+8", "21.0.13+8-LTS"), 0);
    assert.equal(compareEngineVersions("21.0.13+9.0.LTS", "21.0.13+9-LTS"), 0);
    assert.equal(compareEngineVersions("21.0.13+9.0.LTS", "21.0.13+8-LTS"), 1);
    assert.equal(compareEngineVersions("21.0.13+8", "21.0.9+10"), 1);
    assert.equal(compareEngineVersions("21.0.13+8", "22.0.1"), -1);
    assert.equal(compareEngineVersions("invalid", "21.0.13+9"), undefined);
    const value = config(root);
    const items = listEngines({ ...value, engines: { java: root }, managedEngines: { java: [{ directory: `java-${randomUUID()}`, path: join(root, "old") }] } });
    assert.equal(items[0].managed, true); assert.equal(items[0].activeManaged, false); assert.equal(items[0].version, "21.0.13+8-LTS");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("checking one component avoids unrelated probes and reports incompatible local WABT version", async () => {
  const root = temporary(), value = config(root), calls: string[] = [];
  try {
    value.engines = { java: root, wabt: root };
    const items = await checkEngines(root, value, undefined, signal(), async file => { calls.push(file); return { code: 0, stdout: "1.0.43\n", stderr: "" }; }, "wabt");
    assert.equal(calls.length, 1); assert.match(calls[0], /wasm-validate/);
    const wabt = items.find(item => item.id === "wabt")!;
    assert.equal(wabt.version, "1.0.43"); assert.equal(wabt.compatibility, "incompatible"); assert.equal(wabt.status, "error");
    assert.equal(items[0].checkedAt, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("install uses the checked release and rejects forged, expired and unadapted selections", async () => {
  const root = temporary(), initial = config(root); let releases = 0, preparations = 0;
  const service = new ReaService(root, () => {}, {
    engineRelease: async id => { releases++; return fixtureEngineRelease(id); },
    checkEngines: async (_root, value) => listEngines(value).map(item => ({ ...item, status: item.path ? "ready" : item.status })),
    prepareEngine: async (_root, id, _signal, _notify, _fetcher, release) => {
      preparations++; assert.equal(release?.version, "21.0.13+8");
      const directory = join(root, "integrations", "rea", "engines", `${id}-${randomUUID()}`);
      mkdirSync(directory, { recursive: true }); return { directory, path: directory };
    },
  });
  try {
    await assert.rejects(call(service, "rea.engine-install", { engine: "java", revision: initial.revision }), /先检查/);
    await call(service, "rea.engine-check", { engine: "java" });
    const selected = (await settle(service)).engines![0].available!;
    assert.ok(selected); assert.equal(selected.mode, "install"); assert.equal(preparations, 0);
    await assert.rejects(call(service, "rea.engine-install", { engine: "java", revision: initial.revision, token: "forged", version: selected.version }), /先检查/);
    await assert.rejects(call(service, "rea.engine-install", { engine: "java", revision: initial.revision, token: selected.token, version: "21.0.99" }), /先检查/);
    await call(service, "rea.refresh"); assert.equal(releases, 1);
    await call(service, "rea.engine-install", { engine: "java", revision: initial.revision, token: selected.token, version: selected.version });
    assert.equal((await settle(service)).job?.error, undefined); assert.equal(releases, 1); assert.equal(preparations, 1);
    await assert.rejects(call(service, "rea.engine-install", { engine: "java", revision: service.snapshot().revision, token: selected.token, version: selected.version }), /先检查/);
    await call(service, "rea.engine-check", { engine: "java" });
    const next = (await settle(service)).engines![0].available!;
    await call(service, "rea.engineSave", { engine: "java", revision: service.snapshot().revision, path: "" });
    await assert.rejects(call(service, "rea.engine-install", { engine: "java", revision: service.snapshot().revision, token: next.token, version: next.version }), /先检查/);
    const current = readReaConfig(root);
    atomicReaJson(reaConfigPath(root), { ...current, revision: randomUUID(), installation: { ...current.installation, version: "6.8.0" } });
    await assert.rejects(call(service, "rea.engine-check", { engine: "java" }), /尚未适配/);
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("manual download service persists a verified package without switching engines, and rolls back failed attempts", { skip: process.platform !== "darwin" }, async () => {
  for (const mode of ["success", "checksum", "cancel", "conflict"] as const) {
    const root = temporary(), initial = config(root), original = join(root, "existing-hopper");
    initial.engines = { hopper: original }; atomicReaJson(reaConfigPath(root), initial);
    let fetching = false;
    const service = new ReaService(root, () => {}, {
      engineRelease: async () => mode === "checksum" ? { ...hopper, sha1: "0".repeat(40) } : hopper,
      checkEngines: async (_root, value) => listEngines(value),
      prepareEngineDownload: async (root, id, release, sig, notify) => prepareEngineDownload(root, id, release, sig, notify, async () => {
        fetching = true;
        if (mode === "cancel") await new Promise<void>((resolve, reject) => { if (sig.aborted) reject(sig.reason); else sig.addEventListener("abort", () => reject(sig.reason), { once: true }); });
        if (mode === "conflict") atomicReaJson(reaConfigPath(root), { ...initial, revision: "other-writer", engines: { hopper: join(root, "external-change") } });
        return new Response(dmg);
      }),
    });
    try {
      await call(service, "rea.engine-check", { engine: "hopper" });
      const selected = (await settle(service)).engines!.find(item => item.id === "hopper")!.available!;
      assert.equal(selected.mode, "download");
      await assert.rejects(call(service, "rea.engine-install", { engine: "hopper", revision: initial.revision, token: selected.token, version: selected.version }), /维护方式/);
      await call(service, "rea.engine-download", { engine: "hopper", revision: initial.revision, token: selected.token, version: selected.version });
      if (mode === "cancel") {
        const deadline = Date.now() + 3000;
        while (!fetching) { assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 5)); }
        await call(service, "rea.cancel", { jobId: service.snapshot().job!.id });
      }
      const state = await settle(service), saved = readReaConfig(root);
      assert.equal(saved.engines!.hopper, mode === "conflict" ? join(root, "external-change") : original); assert.equal(saved.enabled, false); assert.equal(saved.managedEngines, undefined);
      assert.equal(!!saved.downloads?.hopper, mode === "success");
      assert.equal(readdirSync(join(root, "integrations", "rea", "downloads")).length, mode === "success" ? 1 : 0);
      const tasks = JSON.parse(readFileSync(join(root, "maintenance", "tasks.json"), "utf8")).tasks;
      assert.equal(tasks.at(-1).resource, "rea:hopper");
      assert.equal(tasks.at(-1).status, mode === "success" ? "succeeded" : mode === "cancel" ? "cancelled" : "failed");
      assert.equal(state.pendingOperation, undefined);
      if (mode === "success") {
        assert.equal(state.job?.error, undefined); assert.match(state.job!.message, /待安装/);
        const downloaded = state.engines!.find(item => item.id === "hopper")!.download!;
        assert.deepEqual(readFileSync(downloaded.path), dmg);
        await call(service, "rea.refresh");
        const restarted = new ReaService(root, () => {});
        assert.deepEqual(restarted.snapshot().engines!.find(item => item.id === "hopper")!.download, downloaded);
        await assert.rejects(call(restarted, "rea.engine-download", { engine: "hopper", revision: saved.revision, token: selected.token, version: selected.version }), /先检查/);
        await restarted.close();
      } else if (mode !== "cancel") assert.ok(state.job?.error);
    } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
  }
});

test("refreshes during a release lookup retain the finished version selection", async () => {
  const root = temporary(); config(root);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const service = new ReaService(root, () => {}, {
    checkEngines: async (_root, value) => listEngines(value),
    engineRelease: async id => { entered(); await gate; return fixtureEngineRelease(id); },
  });
  try {
    await call(service, "rea.engine-check", { engine: "java" }); await started;
    await call(service, "rea.get"); await call(service, "rea.refresh");
    release(); const state = await settle(service);
    assert.equal(state.job?.error, undefined); assert.equal(state.engines![0].available?.version, "21.0.13+8");
    assert.ok(state.engines![0].available?.token);
  } finally { release(); await service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("download configuration rejects traversals, mismatched engines and unexpected extensions", () => {
  const root = temporary(), initial = config(root);
  try {
    const record = { directory: `hopper-${randomUUID()}`, version: "6.6.0", filename: "package.dmg" };
    for (const patch of [{ directory: "../../outside" }, { directory: `ghidra-${randomUUID()}` }, { filename: "package.zip" }, { version: "6.6.0\n" }]) {
      atomicReaJson(reaConfigPath(root), { ...initial, downloads: { hopper: { ...record, ...patch } } });
      assert.throws(() => readReaConfig(root), /配置无法读取/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
