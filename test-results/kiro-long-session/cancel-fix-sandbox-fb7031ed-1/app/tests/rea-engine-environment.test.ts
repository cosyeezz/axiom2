import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { runEngine, type EngineRun } from "../src/server/integrations/rea-engine-process.js";
import { ghidraBuildEnvironment } from "../src/server/integrations/rea-engine-ghidra.js";
import { checkEngines } from "../src/server/integrations/rea-engines.js";
import { atomicReaJson, reaConfigPath, type ReaConfig } from "../src/server/integrations/rea-runtime.js";
import { managedNodeFixture } from "./fixtures/managed-node.js";
import { writeReaPackage } from "./rea-fixture.js";
import { tmpdir } from "./temporary.js";

const signal = () => new AbortController().signal;
const ok = { code: 0, stdout: "", stderr: "" };

test("engine subprocess overrides cannot restore startup injections and have private per-engine state", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-engine-env-")), before = { ...process.env };
  try {
    const values = [];
    for (const id of ["ghidra", "hopper"]) {
      const environmentDirectory = join(root, "integrations", "rea", "environment", "engines", id);
      const result = await runEngine(process.execPath, ["-e", "console.log(JSON.stringify(process.env))"], {
        cwd: root, signal: signal(), environmentDirectory,
        env: { NODE_OPTIONS: "--require /nonexistent-engine-injection.cjs", NODE_PATH: "host-modules", JAVA_TOOL_OPTIONS: "host-java", JDK_JAVA_OPTIONS: "host-jdk", _JAVA_OPTIONS: "host-java", CLASSPATH: "host-classes", PYTHONPATH: "host-python", NPM_CONFIG_PREFIX: "host-prefix", npm_config_registry: "host-registry", XDG_CONFIG_HOME: "host-config", TMPDIR: "host-tmp", REA_ENGINE_TEST: id },
      });
      assert.equal(result.code, 0, result.stderr);
      const value = JSON.parse(result.stdout); values.push(value);
      for (const key of ["NODE_OPTIONS", "NODE_PATH", "JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS", "CLASSPATH", "PYTHONPATH", "NPM_CONFIG_PREFIX", "npm_config_registry"]) assert.equal(value[key], undefined, key);
      assert.equal(value.REA_ENGINE_TEST, id);
      assert.equal(value.XDG_CONFIG_HOME, join(environmentDirectory, "config"));
      assert.equal(value.TMPDIR, join(environmentDirectory, "tmp"));
      assert.equal(value.npm_config_cache, join(environmentDirectory, "cache", "npm"));
      assert.ok(existsSync(value.TMPDIR)); assert.ok(existsSync(value.XDG_CONFIG_HOME));
    }
    assert.notEqual(values[0].TMPDIR, values[1].TMPDIR);
    assert.notEqual(values[0].npm_config_cache, values[1].npm_config_cache);
    assert.deepEqual({ ...process.env }, before, "backend environment stays unchanged");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Ghidra preflight and scoped doctor retain the REA private Node with independent engine directories", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-engine-runtime-"));
  try {
    const directory = `v6.7.0-${randomUUID()}`, prefix = join(root, "integrations", "rea", "versions", directory), packageRoot = join(prefix, "node_modules", "rea-agents");
    const runtime = await managedNodeFixture(() => "6.7.0").prepare("rea", prefix, "rea-agents", "6.7.0", signal(), () => {});
    writeReaPackage(packageRoot, "6.7.0");
    const java = join(root, "jdk"), ghidra = join(root, "ghidra");
    mkdirSync(java); mkdirSync(ghidra);
    const config: ReaConfig = { format: 1, revision: "test", enabled: false, installation: { version: "6.7.0", directory, runtime: runtime.binding }, engines: { java, ghidra } };
    atomicReaJson(reaConfigPath(root), config);
    let preflights = 0;
    const preflight: EngineRun = async (file, args, options) => {
      preflights++;
      assert.equal(options.environmentDirectory, join(root, "integrations", "rea", "environment", "engines", "ghidra"));
      assert.deepEqual(options.env!.PATH!.split(delimiter).slice(0, 2), [join(java, "bin"), dirname(runtime.node)]);
      return { ...ok, stdout: file === "/usr/bin/xcrun" ? "/fixture/toolchain" : args.includes("--list-modules") ? "jdk.compiler@21\n" : "java.version = 21\nsun.arch.data.model = 64\nos.arch = aarch64\n" };
    };
    await ghidraBuildEnvironment(root, signal(), preflight, { platform: "darwin", arch: "arm64" });
    assert.equal(preflights, 5);
    const visited = new Set<string>();
    const doctor: EngineRun = async (file, args, options) => {
      const id = file === runtime.node ? "ghidra" : "java"; visited.add(id);
      assert.equal(options.environmentDirectory, join(root, "integrations", "rea", "environment", "engines", id));
      assert.equal(options.env!.PATH!.split(delimiter)[0], dirname(runtime.node));
      if (id === "ghidra") {
        assert.ok(args.includes("ghidra"));
        return { ...ok, stdout: JSON.stringify({ healthy: true, scope_checks: [{ name: "fixture", ok: true }] }) };
      }
      return { ...ok, stdout: args.includes("--list-modules") ? "jdk.compiler@21\n" : "java.version = 21\n" };
    };
    for (const id of ["java", "ghidra"] as const) {
      const checked = await checkEngines(root, config, packageRoot, signal(), doctor, id);
      assert.equal(checked.find(item => item.id === id)!.status, "ready");
    }
    assert.deepEqual([...visited].sort(), ["ghidra", "java"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
