import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
import { windowsEngineSupervisor } from "../src/server/integrations/rea-engine-windows.js";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "./temporary.js";
import { gzipSync, crc32, deflateRawSync } from "node:zlib";
import tar from "tar-stream";
import { archivePath, extractEngineArchive } from "../src/server/integrations/rea-engine-archive.js";
import { engineInstallable, validEnginePath, listEngines, checkEngines } from "../src/server/integrations/rea-engines.js";
import { engineRelease, officialEngineUrl, downloadEngineFile, findEnginePath } from "../src/server/integrations/rea-engine-install.js";
import { atomicReaJson, reaConfigPath, readReaConfig, type ReaConfig } from "../src/server/integrations/rea-runtime.js";
import { ReaService } from "../src/server/integrations/rea.js";
import { runEngine } from "../src/server/integrations/rea-engine-process.js";
import { reaResources } from "../src/server/integrations/rea-resources.js";
import { fixtureEngineRelease, writeReaPackage } from "./rea-fixture.js";

const signal = () => new AbortController().signal;
const temporary = () => mkdtempSync(join(tmpdir(), "axiom-rea-engines-"));
const call = (service: ReaService, op: string, params = {}) => service.command({ requestId: randomUUID(), op, params });
async function settle(service: ReaService) { const deadline = Date.now() + 10_000; while (service.snapshot().job?.running) { assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 5)); } return service.snapshot(); }
function config(root: string): ReaConfig {
  const directory = `v6.7.0-${randomUUID()}`;
  writeReaPackage(join(root, "integrations", "rea", "versions", directory, "node_modules", "rea-agents"), "6.7.0");
  const value: ReaConfig = { format: 1, revision: randomUUID(), enabled: true, installation: { version: "6.7.0", directory } };
  atomicReaJson(reaConfigPath(root), value); return value;
}
test("host matrix explicitly separates Windows x64/arm64, macOS and Linux", () => {
  for (const platform of ["win32", "darwin", "linux"]) for (const arch of ["x64", "arm64"]) {
    const host = { platform, arch };
    assert.equal(engineInstallable("java", host), true);
    assert.equal(engineInstallable("ghidra", host), platform === "darwin" || ["win32", "linux"].includes(platform) && arch === "x64");
    assert.equal(engineInstallable("hopper", host), false);
    assert.equal(engineInstallable("jadx", host), platform !== "win32" || arch === "x64");
    assert.equal(engineInstallable("wabt", host), !(platform === "win32" && arch === "arm64" || platform === "darwin" && arch === "x64"));
    const items = listEngines({ format: 1, revision: "", enabled: true }, [], host);
    assert.equal(items.find(item => item.id === "hopper")!.status === "unsupported", platform === "win32");
  }
  assert.equal(engineInstallable("java", { platform: "linux", arch: "ia32" }), false);
  assert.ok(validEnginePath("C:\\Program Files\\Java\\jdk-21", "win32"));
  assert.ok(validEnginePath("\\\\server\\share\\jdk", "win32"));
  for (const path of ["relative", "C:relative", "\\jdk", "/jdk", "\\\\?\\C:\\jdk", "\\\\.\\pipe\\jdk", "C:\\${JAVA}\\bin", "C:\\bad\npath"]) assert.equal(validEnginePath(path, "win32"), false);
});
test("release selection verifies OS/architecture, fixed versions and official URLs", async () => {
  for (const platform of ["win32", "darwin", "linux"]) for (const arch of ["x64", "arm64"]) {
    const os = ({ win32: "windows", darwin: "mac", linux: "linux" } as Record<string, string>)[platform];
    const release = await engineRelease("java", signal(), { platform, arch }, async url => {
      assert.ok(url.includes(`os=${os}`)); assert.ok(url.includes(`architecture=${arch === "arm64" ? "aarch64" : "x64"}`));
      return Response.json([{ binary: { os, architecture: arch === "arm64" ? "aarch64" : "x64", image_type: "jdk", jvm_impl: "hotspot", package: { link: `https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21/test.${platform === "win32" ? "zip" : "tar.gz"}`, checksum: "a".repeat(64) } }, version: { major: 21, semver: "21.0.9+10" } }]);
    });
    assert.equal(release.format, platform === "win32" ? "zip" : "tar.gz");
  }
  for (const platform of ["win32", "linux"]) {
    const ghidra = await engineRelease("ghidra", signal(), { platform, arch: "x64" }, async () => { throw Error("No metadata request expected"); });
    assert.equal(ghidra.version, "12.1.4"); assert.equal(ghidra.format, "zip");
    assert.match(ghidra.url, /NationalSecurityAgency\/ghidra\/releases\/download\/Ghidra_12\.1\.4_build\//);
    assert.equal(ghidra.sha256, "ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db");
  }
  assert.equal((await engineRelease("ghidra", signal(), { platform: "darwin", arch: "arm64" })).version, "12.1.4");
  const wabt = await engineRelease("wabt", signal(), { platform: "win32", arch: "x64" }, async url => { assert.match(url, /windows-x64.tar.gz.sha256$/); return new Response("a".repeat(64) + "  wabt-1.0.42-windows-x64.tar.gz\n"); });
  assert.match(wabt.url, /windows-x64/);
  await assert.rejects(engineRelease("wabt", signal(), { platform: "darwin", arch: "x64" }));
  for (const url of ["http://github.com/file", "https://evil.test/file", "https://github.com@evil.test/x", "https://github.com:4430/x"]) assert.throws(() => officialEngineUrl(url));
});
async function tarball(entries: { name: string; content?: string; type?: "file" | "symlink" | "directory"; linkname?: string }[]) {
  const pack = tar.pack(), chunks: Buffer[] = [];
  pack.on("data", chunk => chunks.push(chunk as Buffer));
  const done = new Promise<Buffer>(resolve => pack.on("end", () => resolve(gzipSync(Buffer.concat(chunks)))));
  for (const item of entries) pack.entry({ name: item.name, type: item.type ?? "file", linkname: item.linkname, mode: 0o755 }, item.content ?? "");
  pack.finalize(); return done;
}
function zip(name: string, content: string, attrs = 0) {
  const filename = Buffer.from(name), raw = Buffer.from(content), compressed = deflateRawSync(raw), crc = crc32(raw);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(attrs >>> 0, 38);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + filename.length, 12); end.writeUInt32LE(30 + filename.length + compressed.length, 16);
  return Buffer.concat([local, filename, compressed, central, filename, end]);
}
test("archive extraction supports Windows ZIP and tar trees, safe file links; rejects escapes and collisions", async () => {
  const root = temporary();
  try {
    for (const bad of ["/absolute", "../escape", "C:/drive", "a/../../escape", "a\\b", "a/NUL.txt", "a/trailing.", "a/ads:x"]) assert.throws(() => archivePath(bad));
    const good = await tarball([{ name: "jdk/bin/java", content: "executable" }, { name: "jdk/bin/javac", type: "symlink", linkname: "java" }]);
    const packed = join(root, "test.tgz"), dest = join(root, "good"); mkdirSync(dest); writeFileSync(packed, good);
    await extractEngineArchive(packed, dest, "tar.gz", signal()); assert.equal(readFileSync(join(dest, "jdk/bin/javac"), "utf8"), "executable");
    const badArchives = [await tarball([{ name: "../outside", content: "bad" }]), await tarball([{ name: "root/link", type: "symlink", linkname: "../../outside" }]), await tarball([{ name: "root/File", content: "one" }, { name: "root/file", content: "two" }]), await tarball([{ name: "root/link", type: "symlink", linkname: "file" }, { name: "root/link/child", content: "bad" }])];
    for (const [i, data] of badArchives.entries()) { const out = join(root, `bad-${i}`); mkdirSync(out); writeFileSync(packed, data); await assert.rejects(extractEngineArchive(packed, out, "tar.gz", signal())); }
    for (const [i, data] of [zip("jdk/bin/java.exe", "exe"), zip("../outside", "bad"), zip("jdk/link", "target", 0o120777 << 16)].entries()) {
      const out = join(root, `zip-${i}`); mkdirSync(out); writeFileSync(packed, data);
      if (!i) { await extractEngineArchive(packed, out, "zip", signal()); assert.equal(readFileSync(join(out, "jdk/bin/java.exe"), "utf8"), "exe"); }
      else await assert.rejects(extractEngineArchive(packed, out, "zip", signal()));
    }
    const linked = join(root, "linked"), real = join(root, "real"); mkdirSync(real); symlinkSync(real, linked, process.platform === "win32" ? "junction" : "dir");
    writeFileSync(packed, good); await extractEngineArchive(packed, linked, "tar.gz", signal());
    assert.equal(readFileSync(join(real, "jdk/bin/javac"), "utf8"), "executable");
    const budget = join(root, "budget"); mkdirSync(budget);
    await assert.rejects(extractEngineArchive(packed, budget, "tar.gz", signal(), 15), /大小超限/);
    assert.equal(existsSync(join(root, "outside")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("downloads stream and verify SHA256 before any extraction", async () => {
  const root = temporary(), data = Buffer.from("fixture package");
  try {
    const release = { url: "https://github.com/example/release", sha256: createHash("sha256").update(data).digest("hex"), version: "1", format: "jar" as const };
    await downloadEngineFile(release, join(root, "ok"), signal(), async () => new Response(data));
    assert.deepEqual(readFileSync(join(root, "ok")), data);
    await assert.rejects(downloadEngineFile({ ...release, sha256: "0".repeat(64) }, join(root, "bad"), signal(), async () => new Response(data)), /SHA-256/);
    const controller = new AbortController(); controller.abort(); await assert.rejects(downloadEngineFile(release, join(root, "cancelled"), controller.signal, async () => new Response(data)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("refresh is passive, paths persist with revision guard and only REA MCP receives environment", async () => {
  const root = temporary(), initial = config(root); let probes = 0;
  const service = new ReaService(root, () => {}, { checkEngines: async (_root, value) => { probes++; return listEngines(value); } });
  try {
    await call(service, "rea.refresh"); assert.equal(probes, 0);
    const path = join(root, "JDK with spaces");
    await call(service, "rea.engineSave", { revision: initial.revision, engine: "java", path });
    assert.equal(readReaConfig(root).engines?.java, path); assert.equal(probes, 0);
    await assert.rejects(call(service, "rea.engineSave", { revision: initial.revision, engine: "java", path }), /变化/);
    const server = reaResources(root, root).server!; assert.ok("env" in server.config); assert.equal(server.config.env?.JAVA_HOME, path);
    await call(service, "rea.engines-check"); await settle(service); assert.equal(probes, 1);
    await assert.rejects(call(service, "rea.engineSave", { revision: service.snapshot().revision, engine: "java", path: "relative" }));
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
});
test("managed install commits only verified components; failure and revision races clean staging", async () => {
  for (const mode of ["success", "failure", "conflict", "cancel"] as const) {
    const root = temporary(), initial = config(root), directory = join(root, "integrations", "rea", "engines", `java-${randomUUID()}`);
    let verify: (() => void) | undefined, prepared = false;
    const service = new ReaService(root, () => {}, {
      engineRelease: fixtureEngineRelease,
      prepareEngine: async (_root, _id, _signal, _notify, _fetcher, release) => { assert.equal(release?.version, "21.0.13+8"); prepared = true; mkdirSync(directory, { recursive: true }); return { directory, path: join(directory, "jdk") }; },
      checkEngines: async (_root, value, _package, sig) => {
        if (!prepared) return listEngines(value);
        if (mode === "conflict") atomicReaJson(reaConfigPath(root), { ...initial, revision: "other-writer", engines: { java: join(root, "external-change") } });
        if (mode === "cancel") await new Promise<void>(resolve => { verify = resolve; sig.addEventListener("abort", resolve as () => void, { once: true }); });
        sig.throwIfAborted();
        return listEngines(value).map(item => ({ ...item, status: item.id === "java" && mode !== "failure" ? "ready" : "missing" }));
      },
    });
    try {
      await call(service, "rea.engine-check", { engine: "java" });
      const available = (await settle(service)).engines!.find(item => item.id === "java")!.available!;
      await call(service, "rea.engine-install", { revision: initial.revision, engine: "java", token: available.token, version: available.version });
      if (mode === "cancel") { while (!verify) await new Promise(resolve => setTimeout(resolve, 5)); await call(service, "rea.cancel", { jobId: service.snapshot().job!.id }); }
      const state = await settle(service);
      assert.equal(readReaConfig(root).engines?.java, mode === "success" ? join(directory, "jdk") : mode === "conflict" ? join(root, "external-change") : undefined); assert.equal(existsSync(directory), mode === "success");
      assert.equal(readReaConfig(root).managedEngines?.java?.length ?? 0, mode === "success" ? 1 : 0);
      if (mode === "failure" || mode === "conflict") assert.ok(state.job?.error); else assert.equal(state.job?.error, undefined);
    } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
  }
});
test("probe timeout terminates descendants holding inherited pipes", async () => {
  const started = Date.now();
  await assert.rejects(runEngine(process.execPath, ["-e", "require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'}); setInterval(()=>{},1000)"], { cwd: process.cwd(), signal: signal(), timeout: 250 }), /取消、超时/);
  assert.ok(Date.now() - started < 7000);
});

test("Ghidra and JADX require healthy scoped doctor reports, never merely a zero exit code", { skip: process.platform === "win32" && process.arch !== "x64" }, async () => {
  const root = temporary(), value = config(root), ghidra = join(root, "Ghidra home"), jadx = join(root, "jadx.jar");
  mkdirSync(ghidra); writeFileSync(jadx, "fixture"); value.engines = { ghidra, jadx, java: join(root, "JDK home") };
  const packageRoot = join(root, "integrations", "rea", "versions", value.installation!.directory, "node_modules", "rea-agents");
  try {
    for (const fixture of [
      { code: 0, report: { healthy: true, scope_checks: [{ name: "provider", ok: true }] }, status: "ready" },
      { code: 1, report: { healthy: false, scope_checks: [{ name: "native", ok: false, detail: "missing" }] }, status: "incompatible" },
      { code: 0, report: { healthy: true, scope_checks: [{ name: "native", ok: false }] }, status: "incompatible" },
      { code: 0, report: { healthy: true, scope_checks: [] }, status: "error" },
      { code: 2, report: { healthy: true, scope_checks: [{ ok: true }] }, status: "error" },
      { code: 0, report: { ok: true, data: { healthy: true } }, status: "error" },
    ]) {
      const providers: string[] = [];
      const items = await checkEngines(root, value, packageRoot, signal(), async (_file, args, options) => {
        if (!args.includes("doctor")) return { code: 0, stdout: "jdk.compiler@21\n", stderr: "java.version = 21.0.13\n" };
        const provider = args[3]; providers.push(provider);
        assert.deepEqual(args.slice(1), ["doctor", "--provider", provider, "--skill=false", "--format", "json"]);
        assert.equal(options.env?.GHIDRA_INSTALL_DIR, ghidra); assert.equal(options.env?.REA_JADX_MCP_JAR, jadx);
        return { code: fixture.code, stdout: JSON.stringify(fixture.report), stderr: "" };
      });
      assert.deepEqual(providers, ["ghidra", "jadx"]);
      for (const id of providers) assert.equal(items.find(item => item.id === id)!.status, fixture.status);
      assert.equal(items.find(item => item.id === "jadx")!.version, undefined, "healthy doctor output alone cannot identify an unknown JAR version");
      assert.equal(items.find(item => item.id === "jadx")!.compatibility, "unknown");
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Ghidra archive root is unambiguous before doctor validates its native components", async () => {
  const root = temporary();
  try {
    const home = join(root, "ghidra_12.1.4_PUBLIC");
    for (const name of ["Ghidra", "support"]) mkdirSync(join(home, name), { recursive: true });
    assert.equal(await findEnginePath(root, "ghidra", { platform: "win32", arch: "x64" }), home);
    for (const name of ["Ghidra", "support"]) mkdirSync(join(root, "duplicate", name), { recursive: true });
    await assert.rejects(findEnginePath(root, "ghidra", { platform: "linux", arch: "x64" }), /布局/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("Windows supervisor assigns kill-on-close job before spawning; failures never spawn", () => {
  for (const arch of ["x64", "arm64"]) for (const failure of ["", "CreateJobObjectW", "SetInformationJobObject", "AssignProcessToJobObject"]) {
    const events: string[] = [], child = new EventEmitter(), exited = Error("exit"); let code: number | undefined;
    const functions: Record<string, (...args: unknown[]) => unknown> = {
      CreateJobObjectW: (...args) => { assert.deepEqual(args, [null, null]); return failure === "CreateJobObjectW" ? null : 123; },
      SetInformationJobObject: (job, kind, buffer, size) => { assert.equal(job, 123); assert.equal(kind, 9); assert.equal(size, 144); assert.equal((buffer as Buffer).readUInt32LE(16), 0x2000); return failure === "SetInformationJobObject" ? 0 : 1; },
      GetCurrentProcess: () => -1,
      AssignProcessToJobObject: (job, process) => { assert.equal(job, 123); assert.equal(process, -1); events.push("assign"); return failure === "AssignProcessToJobObject" ? 0 : 1; },
      GetLastError: () => 5,
    };
    const context = { Buffer, console: { error: () => {} }, process: { arch, argv: ["node", JSON.stringify(["koffi-fixture", "C:\\Program Files\\jdk\\bin\\java.exe", ["--version"]])], exit: (value: number) => { code = value; throw exited; } }, require: (name: string) => {
      if (name === "koffi-fixture") return { load: () => ({ func: (declaration: string) => functions[/__stdcall (\w+)/.exec(declaration)![1]] }) };
      assert.equal(name, "node:child_process"); return { spawn: (file: string, args: string[]) => { assert.deepEqual(events, ["assign"]); assert.equal(file, "C:\\Program Files\\jdk\\bin\\java.exe"); assert.equal(JSON.stringify(args), '["--version"]'); events.push("spawn"); return child; } };
    } };
    if (failure) { assert.throws(() => runInNewContext(windowsEngineSupervisor, context), error => error === exited); assert.equal(code, 125); assert.ok(!events.includes("spawn")); }
    else { runInNewContext(windowsEngineSupervisor, context); assert.equal(child.listenerCount("close"), 0); assert.throws(() => child.emit("exit", 7), error => error === exited); assert.equal(code, 7); }
  }
});
test("probe descendants are cleaned even when their direct parent exits first", async () => {
  const root = temporary(), pidPath = join(root, "descendant.pid"); let pid: number | undefined;
  const alive = () => { try { process.kill(pid!, 0); return true; } catch { return false; } };
  try {
    const script = `const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});require('node:fs').writeFileSync(${JSON.stringify(pidPath)},String(c.pid));process.exit(0);`;
    const result = runEngine(process.execPath, ["-e", script], { cwd: root, signal: signal(), timeout: 1500 });
    if (process.platform === "win32") assert.equal((await result).code, 0);
    else await assert.rejects(result, /取消、超时/);
    pid = Number(readFileSync(pidPath, "utf8"));
    const deadline = Date.now() + 3000;
    while (alive() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(alive(), false, "orphan descendant must not survive");
  } finally { if (pid && alive()) process.kill(pid, "SIGKILL"); rmSync(root, { recursive: true, force: true }); }
});

test("WABT checks all three versions without starting an analysis", async () => {
  const root = temporary(), calls: string[][] = [];
  try {
    const value: ReaConfig = { format: 1, revision: "", enabled: false, engines: { wabt: root } };
    const items = await checkEngines(root, value, undefined, signal(), async (file, args) => { calls.push([file, ...args]); return { code: 0, stdout: "1.0.42\n", stderr: "" }; });
    assert.equal(items.find(item => item.id === "wabt")!.status, "ready");
    const wabt = calls.filter(args => /wasm/.test(args[0])); assert.equal(wabt.length, 3); assert.ok(wabt.every(args => args[1] === "--version"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
