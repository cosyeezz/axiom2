import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { StdioTransport } from "@earendil-works/pi-mcp";
import { componentEnvironment, prepareComponentEnvironment, supervisorEnvironment } from "../src/server/integrations/component-environment.js";
import { inspectNodeRuntime, recordNodeRuntime, runtimeReceipt, selectNodeRelease } from "../src/server/integrations/managed-node.js";
import { inspectNodeLauncher, writeNodeLauncher } from "../src/server/integrations/node-launcher.js";
import { modelToolTransport } from "../src/server/integrations/model-proxy-tools.js";
import { openCliCommandDirectory, openCliEnvironment, type OpenCliConfig } from "../src/server/integrations/opencli-runtime.js";
import { managedNodeFixture } from "./fixtures/managed-node.js";
import { tmpdir } from "./temporary.js";

const temporary = () => mkdtempSync(join(tmpdir(), "axiom-component-env-"));
const signal = () => new AbortController().signal;

test("component child environments are independent and do not mutate system or other language environments", () => {
  const root = temporary();
  try {
    const source = { HOME: root, PATH: "system-path", NODE_OPTIONS: "--require poison", NODE_PATH: "global-node", PYTHONPATH: "python", PYTHONHOME: "global-python", VIRTUAL_ENV: "venv", JAVA_TOOL_OPTIONS: "poison", CLASSPATH: "global-classes", npm_config_prefix: "global-prefix", NPM_CONFIG_REGISTRY: "custom-registry", RTK_DB_PATH: "shared-rtk-db", KEEP: "unchanged" };
    const before = { ...source }, originalPath = process.env.PATH;
    const rea = componentEnvironment(join(root, "rea"), source, join(root, "private-node"));
    const opencli = componentEnvironment(join(root, "opencli"), source);
    prepareComponentEnvironment(join(root, "rea"));
    for (const name of ["NODE_OPTIONS", "NODE_PATH", "PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV", "JAVA_TOOL_OPTIONS", "CLASSPATH", "RTK_DB_PATH", "npm_config_prefix", "NPM_CONFIG_REGISTRY"]) assert.equal(rea[name], undefined, name);
    assert.equal(rea.PATH, [join(root, "private-node"), "system-path"].join(delimiter));
    assert.equal(opencli.PATH, "system-path");
    assert.notEqual(rea.npm_config_cache, opencli.npm_config_cache);
    assert.notEqual(rea.XDG_CONFIG_HOME, opencli.XDG_CONFIG_HOME);
    assert.notEqual(rea.TMPDIR, opencli.TMPDIR);
    assert.equal(rea.HOME, source.HOME); assert.equal(rea.KEEP, "unchanged");
    assert.ok(existsSync(rea.XDG_STATE_HOME!)); assert.ok(existsSync(rea.TMPDIR!));
    assert.deepEqual(source, before); assert.equal(process.env.PATH, originalPath);
    const supervisor = supervisorEnvironment(source);
    assert.equal(supervisor.NODE_OPTIONS, undefined); assert.equal(supervisor.NODE_PATH, undefined);
    assert.equal(supervisor.PATH, source.PATH, "supervisors do not run under a component Node");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("private Node selection uses exact target engines and a matching official LTS asset, never the backend Node", () => {
  const index = [
    { version: "v22.23.2", npm: "11.0.0", lts: "Jod", files: ["osx-arm64-tar", "linux-x64", "win-x64-zip"] },
    { version: "v22.23.4", npm: "11.1.0", lts: "Jod", files: ["osx-arm64-tar", "linux-x64", "win-x64-zip"] },
    { version: "v24.22.1", npm: "11.2.0", lts: "Krypton", files: ["osx-arm64-tar", "linux-x64", "win-x64-zip"] },
    { version: "v26.12.1", npm: "12.0.0", lts: false, files: ["osx-arm64-tar", "linux-x64", "win-x64-zip"] },
  ];
  const range = "^22.23.4 || ^24.22.1 || >=26.12.1";
  assert.equal(selectNodeRelease(index, range, "darwin", "arm64").version, "v24.22.1");
  assert.equal(selectNodeRelease(index, "^22.23.4", "win32", "x64").version, "v22.23.4");
  assert.equal(selectNodeRelease(index, range, "linux", "x64").version, "v24.22.1");
  assert.throws(() => selectNodeRelease(index, range, "linux", "arm64"), /没有满足/);
  assert.throws(() => selectNodeRelease(index, ">=28", "darwin", "arm64"), /没有满足/);
  assert.throws(() => selectNodeRelease(index, "invalid"), /元数据无效/);
});

for (const defect of ["node", "npm-entry", "npm-lib", "npm-dependency", "npm-package", "npm-deleted", "npm-added"] as const) test(`private runtime rejects ${defect} changes without falling back to the host`, async () => {
  const prefix = temporary();
  try {
    const runtime = await managedNodeFixture(() => "6.8.0").prepare("rea", prefix, "rea-agents", "6.8.0", signal(), () => {});
    const npmRoot = dirname(dirname(runtime.npm)), lib = join(npmRoot, "lib", "cli.js"), dependency = join(npmRoot, "node_modules", "example", "index.js"), pkg = join(npmRoot, "package.json");
    mkdirSync(dirname(lib), { recursive: true }); mkdirSync(dirname(dependency), { recursive: true });
    writeFileSync(lib, "// cli implementation\n"); writeFileSync(dependency, "// dependency\n"); writeFileSync(pkg, '{"version":"11.0.0"}\n');
    rmSync(runtimeReceipt(prefix)); recordNodeRuntime(prefix, runtime.binding);
    assert.equal(inspectNodeRuntime(prefix, runtime.binding).node, runtime.node);
    assert.notEqual(runtime.node, process.execPath);
    if (defect === "node") writeFileSync(runtime.node, "not a node binary");
    else if (defect === "npm-deleted") rmSync(dependency);
    else if (defect === "npm-added") writeFileSync(join(npmRoot, "unexpected.js"), "extra");
    else writeFileSync(({ "npm-entry": runtime.npm, "npm-lib": lib, "npm-dependency": dependency, "npm-package": pkg })[defect], "changed");
    assert.throws(() => inspectNodeRuntime(prefix, runtime.binding), /Node\/npm 已变化|ENOENT/);
  } finally { rmSync(prefix, { recursive: true, force: true }); }
});

test("OpenCLI launcher enters private Node only in its child, sanitizes startup injections and retains literal execution-time values", async () => {
  const prefix = temporary();
  try {
    const runtime = await managedNodeFixture(() => "1.8.8").prepare("opencli", prefix, "@jackwener/opencli", "1.8.8", signal(), () => {});
    const entry = join(prefix, "entry.cjs"), environment = join(prefix, "environment");
    writeFileSync(entry, 'console.log(JSON.stringify({execPath:process.execPath,args:process.argv.slice(2),path:process.env.PATH,nodeOptions:process.env.NODE_OPTIONS,python:process.env.PYTHONPATH,tmp:process.env.TMPDIR,profile:process.env.OPENCLI_PROFILE,proxy:process.env.HTTPS_PROXY}));\n');
    writeNodeLauncher(prefix, runtime.node, entry);
    const files = inspectNodeLauncher(prefix, runtime.node, entry);
    const wrapper = readFileSync(join(prefix, "commands", "opencli.cjs"), "utf8");
    assert.ok(!wrapper.includes("http://install-secret"));
    assert.ok(!wrapper.includes('"HTTPS_PROXY":'), "generated code never persists proxy credentials");
    const config: OpenCliConfig = { format: 1, revision: "test", packageRoot: join(prefix, "node_modules", "@jackwener", "opencli"), binDirectory: join(prefix, "node_modules", ".bin"), runtime: runtime.binding, enabled: true, profile: "!literal-$HOME", window: "foreground" };
    const source = { ...process.env, NODE_OPTIONS: "--require /missing-component-test-injection.cjs", NODE_PATH: "global", PYTHONPATH: "global-python", HTTPS_PROXY: "http://runtime-user:p$literal@127.0.0.1:9876" };
    const env = openCliEnvironment(config, source), before = { ...source };
    assert.equal(env.PATH!.split(delimiter)[0], openCliCommandDirectory(config));
    assert.ok(!env.PATH!.split(delimiter).includes(dirname(runtime.node)), "private Node is not injected into the agent shell PATH");
    const launcher = join(prefix, "commands", process.platform === "win32" ? "opencli.cmd" : "opencli");
    const result = process.platform === "win32" ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `""${launcher}" "argument space""`], { env, encoding: "utf8", timeout: 10_000 }) : spawnSync(launcher, ["argument space"], { env, encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    const value = JSON.parse(result.stdout);
    assert.equal(value.execPath, runtime.node); assert.deepEqual(value.args, ["argument space"]);
    assert.equal(value.nodeOptions, undefined); assert.equal(value.python, undefined);
    assert.equal(value.tmp, join(environment, "tmp")); assert.equal(value.profile, "!literal-$HOME");
    assert.equal(value.proxy, source.HTTPS_PROXY);
    assert.deepEqual(source, before); assert.ok(files.includes(launcher));
    assert.deepEqual(inspectNodeLauncher(prefix, runtime.node, entry), files);
    writeFileSync(join(prefix, "commands", "opencli.cjs"), "changed");
    assert.throws(() => inspectNodeLauncher(prefix, runtime.node, entry), /已变化/);
  } finally { rmSync(prefix, { recursive: true, force: true }); }
});

test("PowerShell launcher restores its caller's Node injection environment even after a failed child", { skip: process.platform !== "win32" }, async () => {
  const prefix = temporary();
  try {
    const runtime = await managedNodeFixture(() => "1.8.8").prepare("opencli", prefix, "@jackwener/opencli", "1.8.8", signal(), () => {});
    const entry = join(prefix, "entry.cjs");
    writeFileSync(entry, "console.log(JSON.stringify({execPath:process.execPath,nodeOptions:process.env.NODE_OPTIONS,nodePath:process.env.NODE_PATH,repl:process.env.NODE_REPL_EXTERNAL_MODULE}));process.exitCode=7;\n");
    writeNodeLauncher(prefix, runtime.node, entry);
    const env = { ...process.env, NODE_OPTIONS: "--require C:/missing-axiom-component-injection.cjs", NODE_PATH: "preserved caller modules", NODE_REPL_EXTERNAL_MODULE: "preserved caller repl" };
    const launcher = join(prefix, "commands", "opencli.ps1").replaceAll("'", "''");
    const script = `& '${launcher}'; $code=$LASTEXITCODE; Write-Output ('PARENT:' + (@{options=$env:NODE_OPTIONS;path=$env:NODE_PATH;repl=$env:NODE_REPL_EXTERNAL_MODULE} | ConvertTo-Json -Compress)); exit $code`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { env, encoding: "utf8", timeout: 15_000 });
    assert.equal(result.status, 7, result.error?.message ?? result.stderr);
    const lines = result.stdout.trim().split(/\r?\n/), child = JSON.parse(lines[0]), parent = JSON.parse(lines.find(line => line.startsWith("PARENT:"))!.slice(7));
    assert.equal(child.execPath, runtime.node); assert.equal(child.nodeOptions, undefined); assert.equal(child.nodePath, undefined); assert.equal(child.repl, undefined);
    assert.deepEqual(parent, { options: env.NODE_OPTIONS, path: env.NODE_PATH, repl: env.NODE_REPL_EXTERNAL_MODULE });
  } finally { rmSync(prefix, { recursive: true, force: true }); }
});

test("built-in REA MCP transport preserves literal resolved environment and never re-merges host injections", () => {
  const root = temporary();
  try {
    const env = { PATH: "private-node", XDG_CONFIG_HOME: join(root, "environment", "config"), TOKEN: "!literal-command-$MISSING", HTTP_PROXY: "http://user:p$a$s$s@127.0.0.1:1234" };
    const transport = modelToolTransport({ name: "rea", scope: "extension", source: join(root, "integrations", "rea", "config.json"), config: { command: process.execPath, args: ["mcp"], cwd: root, env } }, join(root, "different-cwd"), undefined);
    assert.ok(transport instanceof StdioTransport);
    assert.equal(transport.options.inheritEnv, false);
    assert.equal(transport.options.cwd, root); assert.deepEqual(transport.options.env, env);
    assert.ok(existsSync(join(root, "environment", "tmp")));
    const custom = modelToolTransport({ name: "custom", scope: "extension", source: "user", config: { command: process.execPath, env: { VALUE: "$$literal" } } }, root, undefined);
    assert.ok(custom instanceof StdioTransport); assert.equal(custom.options.env?.VALUE, "$literal", "custom MCP still uses documented Pi interpolation");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
