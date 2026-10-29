import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkEngines, discoverEnginePaths, engineInstallable } from "../src/server/integrations/rea-engines.js";
import { prepareEngine, type EngineRelease } from "../src/server/integrations/rea-engine-install.js";
import { atomicReaJson, reaConfigPath, type ReaConfig } from "../src/server/integrations/rea-runtime.js";
import { writeReaPackage } from "./rea-fixture.js";
import { tmpdir } from "./temporary.js";

const signal = () => new AbortController().signal;
const release: EngineRelease = { version: "12.1.4", format: "zip", url: "https://github.com/fixture/ghidra.zip", sha256: "a".repeat(64) };
function fixture(root: string, version: string) {
  const directory = `v${version}-${randomUUID()}`, packageRoot = join(root, "integrations", "rea", "versions", directory, "node_modules", "rea-agents");
  writeReaPackage(packageRoot, version);
  const ghidra = join(root, "Ghidra home"); mkdirSync(ghidra);
  const config: ReaConfig = { format: 1, revision: randomUUID(), enabled: false, installation: { version, directory }, engines: { ghidra } };
  atomicReaJson(reaConfigPath(root), config);
  return { config, packageRoot };
}
async function isolatedJava(run: () => Promise<void>) {
  const before = { ...process.env };
  try {
    for (const key of Object.keys(process.env)) if (["PATH", "JAVA_HOME"].includes(key.toUpperCase())) delete process.env[key];
    process.env.PATH = "";
    await run();
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
  }
}

test("Ghidra without a JDK reports the prerequisite before doctor or installation touches the package", { skip: !engineInstallable("ghidra") }, async () => isolatedJava(async () => {
  for (const version of ["6.7.0", "6.8.0"]) {
    const root = mkdtempSync(join(tmpdir(), "axiom-ghidra-java-"));
    try {
      const { config, packageRoot } = fixture(root, version), directory = `ghidra-${randomUUID()}`;
      const downloads = join(root, "integrations", "rea", "downloads", directory), cached = join(downloads, "package.zip");
      mkdirSync(downloads, { recursive: true }); writeFileSync(cached, "retained package");
      config.downloads = { ghidra: { directory, filename: "package.zip", version: release.version } };
      atomicReaJson(reaConfigPath(root), config);
      const before = readFileSync(reaConfigPath(root), "utf8");
      for (const java of [undefined, "relative-jdk"]) {
        if (java) process.env.JAVA_HOME = java; else delete process.env.JAVA_HOME;
        let probes = 0;
        const items = await checkEngines(root, config, packageRoot, signal(), async () => {
          probes++; return { code: 1, stdout: "", stderr: "unexpected doctor" };
        }, "ghidra");
        const ghidra = items.find(item => item.id === "ghidra")!;
        assert.equal(ghidra.status, "error");
        assert.match(ghidra.detail, /Ghidra.*JDK 21.*先安装/);
        assert.equal(probes, 0, "never let REA fall back to a bare java.exe");
        for (const cachedOnly of [false, true]) {
          await assert.rejects(prepareEngine(root, "ghidra", signal(), () => {}, async () => { throw Error("must not fetch"); }, release, { cachedOnly }), /Ghidra.*JDK 21.*先安装/);
          assert.equal(existsSync(join(root, "integrations", "rea", "engines")), false, "fail before creating a staging directory");
          assert.equal(readFileSync(cached, "utf8"), "retained package");
          assert.equal(readFileSync(reaConfigPath(root), "utf8"), before, "active configuration stays unchanged");
        }
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
}));

test("Ghidra doctor receives an absolute JDK home from configuration, JAVA_HOME or PATH", { skip: !engineInstallable("ghidra") }, async () => isolatedJava(async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-ghidra-jdk-"));
  try {
    const { config, packageRoot } = fixture(root, "6.8.0"), java = join(root, "JDK with spaces");
    mkdirSync(join(java, "bin"), { recursive: true });
    writeFileSync(join(java, "bin", process.platform === "win32" ? "java.exe" : "java"), "fixture");
    writeFileSync(join(java, "release"), 'JAVA_VERSION="21.0.13"\n');
    for (const source of ["config", "environment", "PATH"]) {
      config.engines = { ghidra: config.engines!.ghidra, ...(source === "config" ? { java } : {}) };
      if (source === "environment") process.env.JAVA_HOME = java; else delete process.env.JAVA_HOME;
      process.env.PATH = source === "PATH" ? join(java, "bin") : "";
      assert.equal(discoverEnginePaths(config.engines).java, java);
      let probes = 0;
      const items = await checkEngines(root, config, packageRoot, signal(), async (_file, args, options) => {
        probes++; assert.ok(args.includes("doctor")); assert.equal(options.env!.JAVA_HOME, java);
        return { code: 0, stdout: JSON.stringify({ healthy: true, scope_checks: [{ name: "ghidra-java", ok: true }] }), stderr: "" };
      }, "ghidra");
      assert.equal(probes, 1); assert.equal(items.find(item => item.id === "ghidra")!.status, "ready");
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
}));
