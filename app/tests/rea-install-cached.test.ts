import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { crc32, deflateRawSync } from "node:zlib";
import { ReaService, type ReaDependencies } from "../src/server/integrations/rea.js";
import { listEngines } from "../src/server/integrations/rea-engines.js";
import { ghidraBuildEnvironment } from "../src/server/integrations/rea-engine-ghidra.js";
import { officialEngineUrl, prepareEngine, type EngineRelease } from "../src/server/integrations/rea-engine-install.js";
import { openHopperInstaller, prepareEngineDownload } from "../src/server/integrations/rea-engine-download.js";
import type { EngineRun } from "../src/server/integrations/rea-engine-process.js";
import { atomicReaJson, reaConfigPath, readReaConfig, type ReaConfig } from "../src/server/integrations/rea-runtime.js";
import { writeReaPackage } from "./rea-fixture.js";
import { tmpdir } from "./temporary.js";

const temporary = () => mkdtempSync(join(tmpdir(), "axiom-rea-cached-install-"));
const signal = () => new AbortController().signal;
const ok = { code: 0, stdout: "", stderr: "" };
const mac = { skip: process.platform !== "darwin" };
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const call = (service: ReaService, op: string, params = {}) => service.command({ requestId: randomUUID(), op, params });
async function settle(service: ReaService) {
  const deadline = Date.now() + 10_000;
  while (service.snapshot().jobs?.some(job => job.running)) { assert.ok(Date.now() < deadline, "job timed out"); await new Promise(resolve => setTimeout(resolve, 5)); }
  return service.snapshot();
}
function config(root: string) {
  const directory = `v6.7.0-${randomUUID()}`, java = join(root, "JDK with spaces");
  writeReaPackage(join(root, "integrations", "rea", "versions", directory, "node_modules", "rea-agents"), "6.7.0");
  mkdirSync(join(java, "bin"), { recursive: true });
  const value: ReaConfig = { format: 1, revision: randomUUID(), enabled: false, installation: { version: "6.7.0", directory }, engines: { java } };
  atomicReaJson(reaConfigPath(root), value); return value;
}
// Tiny valid archives exercise the production parser; fixture scripts are never executed.
function zip(entries: Record<string, string>) {
  const locals: Buffer[] = [], centrals: Buffer[] = []; let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const filename = Buffer.from(name), raw = Buffer.from(content), compressed = deflateRawSync(raw), crc = crc32(raw);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE((0o100755 << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    const bytes = Buffer.concat([local, filename, compressed]); locals.push(bytes); centrals.push(central, filename); offset += bytes.length;
  }
  const central = Buffer.concat(centrals), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(locals.length, 8); end.writeUInt16LE(locals.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}
const binaries = [["Ghidra/Features/Decompiler", "decompile"], ["Ghidra/Features/Decompiler", "sleigh"], ["Ghidra/Features/FileFormats", "lzfse"], ["GPL/DemanglerGnu", "demangler_gnu_v2_24"], ["GPL/DemanglerGnu", "demangler_gnu_v2_41"]];
async function ghidraFixture(root: string, mode = "success") {
  config(root);
  const gradle = zip({ "gradle-9.7.1/bin/gradle": "fixture gradle: never executed" });
  const gradleUrl = "https://services.gradle.org/distributions/gradle-9.7.1-bin.zip";
  const properties = `distributionUrl=${mode === "url" ? "https://evil.test/gradle-9.7.1-bin.zip" : gradleUrl}\n${mode === "checksum-file" ? "" : `distributionSha256Sum=${mode === "checksum" ? "0".repeat(64) : sha256(gradle)}\n`}`;
  const data = zip({ "ghidra_12.1.4_PUBLIC/Ghidra/application.properties": "application.version=12.1.4\n", "ghidra_12.1.4_PUBLIC/support/gradle/gradle-wrapper.properties": properties });
  const release: EngineRelease = { url: "https://github.com/fixture/ghidra/12.1.4.zip", version: "12.1.4", format: "zip", sha256: sha256(data), size: data.length };
  const cached = await prepareEngineDownload(root, "ghidra", release, signal(), () => {}, async () => new Response(data));
  const value = readReaConfig(root);
  value.downloads = { ghidra: { directory: basename(cached.directory), filename: cached.filename, version: release.version } };
  atomicReaJson(reaConfigPath(root), value);
  const fetches: string[] = [], commands: string[] = [];
  const fetcher = async (url: string) => {
    fetches.push(url);
    assert.ok([gradleUrl, `${gradleUrl}.sha256`].includes(url), "must reuse Ghidra ZIP, with no other network requests");
    return new Response(url.endsWith(".sha256") ? `${sha256(gradle)}\n` : gradle);
  };
  const run: EngineRun = async (file, args, options) => {
    options.signal.throwIfAborted(); commands.push(file);
    assert.equal(options.cwd, root);
    if (file.endsWith("/java")) return { ...ok, stdout: args.includes("--list-modules") ? "jdk.compiler@21.0.13\n" : `java.version = 21.0.13\nsun.arch.data.model = 64\nos.arch = ${process.arch === "arm64" ? "aarch64" : "amd64"}\n` };
    if (file === "/usr/bin/xcrun") return mode === "clt" ? { ...ok, code: 1 } : { ...ok, stdout: "/fixture/toolchain\n" };
    if (file === "/bin/sh") {
      assert.deepEqual(args.slice(1, 3), ["--project-dir", args[2]]);
      assert.deepEqual(args.slice(3), ["--no-daemon", "--offline", "--console=plain", "buildNatives"]);
      assert.equal(options.timeout, 600_000); assert.match(options.env!.GRADLE_USER_HOME!, /ghidra-.*\/gradle-home$/);
      for (const key of ["GRADLE_OPTS", "JAVA_OPTS", "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS"]) assert.equal(options.env![key], "");
      if (mode === "cancel") await new Promise<void>((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
      if (mode === "build") return { ...ok, code: 1, stderr: "fixture compiler failure" };
      const home = dirname(dirname(args[2])), platform = process.arch === "arm64" ? "mac_arm_64" : "mac_x86_64";
      for (const [module, binary] of binaries) {
        if (mode === "missing-native" && binary === "sleigh") continue;
        const path = join(home, module, "build", "os", platform, binary); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, "native fixture", { mode: 0o700 });
      }
      return ok;
    }
    assert.equal(file, "/usr/bin/lipo"); assert.deepEqual(args.slice(0, 2), ["-verify_arch", process.arch === "arm64" ? "arm64" : "x86_64"]);
    return { ...ok, code: mode === "architecture" ? 1 : 0 };
  };
  return { data, release, cached, fetcher, fetches, run, commands };
}

test("Ghidra preflight rejects old, incomplete, 32-bit and wrong-architecture JDKs and missing CLT", async () => {
  const root = temporary(); config(root);
  try {
    for (const mode of ["old", "modules", "bits", "architecture", "clt", "success"]) {
      const run: EngineRun = async (file, args) => file === "/usr/bin/xcrun" ? { ...ok, code: mode === "clt" ? 1 : 0, stdout: "/fixture/tool\n" } : { ...ok, stdout: args.includes("--list-modules") ? mode === "modules" ? "java.base@21\n" : "jdk.compiler@21\n" : `java.version = ${mode === "old" ? "17" : "21"}\nsun.arch.data.model = ${mode === "bits" ? "32" : "64"}\nos.arch = ${mode === "architecture" ? "amd64" : "aarch64"}\n` };
      const result = ghidraBuildEnvironment(root, signal(), run, { platform: "darwin", arch: "arm64" });
      if (mode === "success") assert.equal((await result).JAVA_HOME, readReaConfig(root).engines!.java);
      else await assert.rejects(result, mode === "clt" ? /xcode-select --install/ : mode === "architecture" ? /CPU 架构/ : /JDK 21/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Gradle trust policy admits only official binary distributions and checksum URLs", () => {
  for (const domain of ["services.gradle.org", "downloads.gradle.org"]) {
    officialEngineUrl(`https://${domain}/distributions/gradle-9.7.1-bin.zip`);
    officialEngineUrl(`https://${domain}/distributions/gradle-9.7.1-bin.zip.sha256`);
    for (const suffix of ["-all.zip", "-bin.zip?x=1", "-bin.zip#fragment", "-bin.zip/other"]) assert.throws(() => officialEngineUrl(`https://${domain}/distributions/gradle-9.7.1${suffix}`));
  }
  assert.throws(() => officialEngineUrl("https://services.gradle.org.evil.test/distributions/gradle-9.7.1-bin.zip"));
});

test("cached Ghidra uses a verified private ZIP, offline Gradle and all five architecture-checked natives", mac, async () => {
  for (const mode of ["success", "checksum-file"]) {
    const root = temporary();
    try {
      const fixture = await ghidraFixture(root, mode), before = readReaConfig(root);
      const installed = await prepareEngine(root, "ghidra", signal(), () => {}, fixture.fetcher, fixture.release, { cachedOnly: true, run: fixture.run });
      assert.ok(existsSync(join(installed.path, "Ghidra/application.properties")));
      assert.equal(fixture.fetches.length, mode === "checksum-file" ? 2 : 1);
      assert.equal(fixture.commands.filter(file => file === "/usr/bin/lipo").length, 5);
      assert.deepEqual(readFileSync(fixture.cached.path), fixture.data);
      assert.deepEqual(readReaConfig(root), before, "preparation does not publish the candidate before doctor validation");
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("cached Ghidra failures preserve the original package and clean unpublished candidates", mac, async () => {
  for (const [mode, message] of [["clt", /xcode-select/], ["url", /发行地址/], ["checksum", /SHA-256/], ["build", /compiler failure/], ["missing-native", /sleigh/], ["architecture", /CPU 架构/], ["corrupt", /校验失败/]]) {
    const root = temporary();
    try {
      const fixture = await ghidraFixture(root, mode as string);
      if (mode === "corrupt") writeFileSync(fixture.cached.path, Buffer.alloc(fixture.data.length, 88));
      const saved = readFileSync(fixture.cached.path);
      await assert.rejects(prepareEngine(root, "ghidra", signal(), () => {}, fixture.fetcher, fixture.release, { cachedOnly: true, run: fixture.run }), message as RegExp);
      assert.deepEqual(readFileSync(fixture.cached.path), saved); assert.equal(readReaConfig(root).engines?.ghidra, undefined);
      const engines = join(root, "integrations", "rea", "engines"); assert.deepEqual(existsSync(engines) ? readdirSync(engines) : [], []);
      if (["clt", "url", "corrupt"].includes(mode as string)) assert.equal(fixture.fetches.length, 0);
      if (["url", "checksum", "corrupt"].includes(mode as string)) assert.ok(!fixture.commands.includes("/bin/sh"));
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("Ghidra cached installation survives restart without a token; validation, version drift and cancellation cannot publish it", mac, async () => {
  for (const mode of ["success", "verify", "version", "cancel"]) {
    const root = temporary(), fixture = await ghidraFixture(root, mode), before = readReaConfig(root); let preparations = 0;
    const dependencies: ReaDependencies = {
      engineRelease: async () => ({ ...fixture.release, version: mode === "version" ? "12.1.5" : fixture.release.version }),
      prepareEngine: (root, id, sig, notify, _fetcher, release, options) => { preparations++; return prepareEngine(root, id, sig, notify, fixture.fetcher, release, { ...options, run: fixture.run }); },
      checkEngines: async (_root, value) => listEngines(value).map(item => item.id === "ghidra" ? { ...item, status: mode === "verify" ? "error" : "ready", checkedAt: Date.now() } : item),
    };
    let service = new ReaService(root, () => {}, dependencies);
    try {
      await service.close(); service = new ReaService(root, () => {}, dependencies);
      const item = service.snapshot().engines!.find(item => item.id === "ghidra")!;
      assert.equal(item.available, undefined); assert.ok(item.download);
      const params = { engine: "ghidra", revision: item.revision, version: fixture.release.version, downloaded: true, confirm: true };
      await assert.rejects(call(service, "rea.engine-install", { ...params, confirm: false }), /确认/);
      await assert.rejects(call(service, "rea.engine-install", { ...params, version: "12.1.0" }), /确认/);
      await assert.rejects(call(service, "rea.engine-install", { ...params, revision: "stale" }), /变化/);
      await call(service, "rea.engine-install", params);
      if (mode === "cancel") {
        const deadline = Date.now() + 5000;
        while (!fixture.commands.includes("/bin/sh")) { assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 5)); }
        await call(service, "rea.cancel", { jobId: service.snapshot().job!.id });
      }
      const state = await settle(service), saved = readReaConfig(root), job = state.job!;
      assert.deepEqual(saved.downloads, before.downloads); assert.deepEqual(readFileSync(fixture.cached.path), fixture.data);
      assert.equal(preparations, mode === "version" ? 0 : 1);
      if (mode === "success") {
        assert.equal(job.error, undefined); assert.equal(job.message, "组件已安装。"); assert.equal(saved.managedEngines!.ghidra!.length, 1);
        assert.ok(existsSync(saved.engines!.ghidra!));
        const latest = state.engines!.find(item => item.id === "ghidra")!;
        await call(service, "rea.engine-install", { ...params, revision: latest.revision }); await settle(service);
        assert.equal(preparations, 1, "already ready version is checked and reused");
      } else {
        assert.equal(saved.engines?.ghidra, undefined); assert.equal(saved.managedEngines?.ghidra, undefined);
        const engines = join(root, "integrations", "rea", "engines"); assert.deepEqual(existsSync(engines) ? readdirSync(engines) : [], []);
        if (mode === "cancel") { assert.equal(job.error, undefined); assert.match(job.message, /已取消/); } else assert.match(job.error!, mode === "version" ? /推荐版本不同/ : /检测未通过/);
      }
    } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
  }
});

async function hopperFixture(root: string) {
  config(root);
  const data = Buffer.from("Hopper fixture DMG: never opened"), release: EngineRelease = { version: "6.6.0", url: "https://www.hopperapp.com/downloader/public/Hopper-6.6.0-demo.dmg", format: "dmg", size: data.length, sha1: createHash("sha1").update(data).digest("hex") };
  const cached = await prepareEngineDownload(root, "hopper", release, signal(), () => {}, async () => new Response(data));
  const record = { directory: basename(cached.directory), filename: cached.filename, version: release.version };
  atomicReaJson(reaConfigPath(root), { ...readReaConfig(root), downloads: { hopper: record } });
  return { data, cached, record, release };
}

test("Hopper opener validates the recorded official DMG and never invokes a waiting installer", mac, async () => {
  for (const mode of ["success", "replaced-cache", "corrupt", "url", "open-error", "cancel"]) {
    const root = temporary(); let opens = 0;
    try {
      const fixture = await hopperFixture(root), controller = new AbortController();
      if (mode === "corrupt") writeFileSync(fixture.cached.path, Buffer.alloc(fixture.data.length, 88));
      if (mode === "url") writeFileSync(join(fixture.cached.directory, "source.json"), JSON.stringify({ ...fixture.release, url: "https://github.com/fixture/untrusted.dmg", installed: false }));
      if (mode === "cancel") controller.abort();
      const run: EngineRun = async (file, args, options) => {
        opens++; assert.equal(file, "/usr/bin/open"); assert.equal(args.length, 1); assert.notEqual(args[0], fixture.cached.path); assert.equal(options.timeout, 15_000); assert.notEqual(options.signal, controller.signal);
        if (mode === "replaced-cache") writeFileSync(fixture.cached.path, "changed after verification");
        assert.deepEqual(readFileSync(args[0]), fixture.data, "the system receives a private verified copy unaffected by cache changes");
        return { ...ok, code: mode === "open-error" ? 1 : 0, stderr: mode === "open-error" ? "LaunchServices unavailable" : "" };
      };
      const result = openHopperInstaller(root, fixture.record, controller.signal, run);
      if (["success", "replaced-cache"].includes(mode)) await result; else await assert.rejects(result);
      assert.equal(opens, ["success", "replaced-cache", "open-error"].includes(mode) ? 1 : 0); assert.ok(existsSync(fixture.cached.path));
      assert.equal(readReaConfig(root).engines?.hopper, undefined); assert.equal(readReaConfig(root).managedEngines, undefined);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("Hopper service confirms the cached version after restart and reports system installation still pending", mac, async () => {
  for (const mode of ["success", "cancel"]) {
    const root = temporary(), fixture = await hopperFixture(root), before = readReaConfig(root); let entered!: () => void;
    const opened = new Promise<void>(resolve => { entered = resolve; });
    const dependencies: ReaDependencies = { openHopperInstaller: (root, record, sig) => openHopperInstaller(root, record, sig, async (_file, _args, options) => {
      entered();
      if (mode === "cancel") await new Promise<void>((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
      return ok;
    }) };
    let service = new ReaService(root, () => {}, dependencies);
    try {
      await service.close(); service = new ReaService(root, () => {}, dependencies);
      const params = { engine: "hopper", revision: service.snapshot().engines!.find(item => item.id === "hopper")!.revision, version: fixture.record.version, confirm: true };
      await assert.rejects(call(service, "rea.engine-open-installer", { ...params, confirm: false }), /确认/);
      await assert.rejects(call(service, "rea.engine-open-installer", { ...params, version: "6.6.1" }), /确认/);
      await assert.rejects(call(service, "rea.engine-open-installer", { ...params, revision: "stale" }), /变化/);
      await call(service, "rea.engine-open-installer", params); await opened;
      if (mode === "cancel") await call(service, "rea.cancel", { jobId: service.snapshot().job!.id });
      const state = await settle(service);
      assert.equal(state.job?.kind, "engine-open-installer"); assert.equal(state.job?.error, undefined);
      assert.match(state.job!.message, mode === "success" ? /已打开.*完成安装后检查更新/ : /已取消.*可能已打开/);
      assert.deepEqual(readReaConfig(root), before); assert.deepEqual(readFileSync(fixture.cached.path), fixture.data);
      const tasks = JSON.parse(readFileSync(join(root, "maintenance", "tasks.json"), "utf8")).tasks;
      assert.equal(tasks.at(-1).resource, "rea:hopper"); assert.equal(tasks.at(-1).status, mode === "success" ? "succeeded" : "cancelled");
      atomicReaJson(reaConfigPath(root), { ...before, installation: { ...before.installation!, version: "6.9.0" } });
      await assert.rejects(call(service, "rea.engine-open-installer", params), /尚未适配/);
    } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
  }
});
