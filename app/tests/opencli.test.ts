import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { randomUUID } from "node:crypto";
import { loadSkills, formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";
import { OpenCliService, executeOpenCli, type OpenCliExecute } from "../src/server/integrations/opencli.js";
import { openCliConfigPath, openCliEnvironment, openCliSkillNames, openCliSkillPaths, readOpenCliConfig } from "../src/server/integrations/opencli-runtime.js";
import { resourceIdentity } from "../src/server/agents/resource-identity.js";
import { Store } from "../src/server/storage.js";
import { openCliResources } from "../src/server/integrations/opencli-resources.js";
import { startServer } from "../src/server/index.js";
import { WebSocket } from "ws";
import { once } from "node:events";

export function openCliFixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-opencli-"));
  const prefix = join(root, "global prefix"), modules = join(prefix, "node_modules");
  const packageRoot = join(modules, "@jackwener", "opencli");
  const calls: string[][] = [];
  let version = "1.8.8", failInstall = false, hold: Promise<void> | undefined;
  const install = (value: string) => {
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "@jackwener/opencli", version: value, bin: { opencli: "cli.js" } }));
    writeFileSync(join(packageRoot, "cli.js"), "// fixture\n");
    for (const name of openCliSkillNames) {
      const dir = join(packageRoot, "skills", name); mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: Official fixture ${value}\n---\n\nRead this guide only when needed.\n`);
    }
  };
  const execute: OpenCliExecute = async (args, options) => {
    calls.push(args);
    if (args[1] === "--version") return "11.0.0";
    if (args[1] === "root") return modules;
    if (args[1] === "prefix") return prefix;
    if (args[1] === "view") return JSON.stringify(version);
    if (args[1] === "doctor") return "[MISSING] Extension: not connected\nBrowser connectivity test failed";
    if (args[1] === "install") {
      if (hold) await Promise.race([hold, new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(Error("aborted")), { once: true }))]);
      if (failInstall) throw Error("fixture network failure token=secret-value");
      install(version); return "installed";
    }
    throw Error(`Unexpected arguments: ${args.join(" ")}`);
  };
  return { root, prefix, packageRoot, calls, install, execute, locateNpm: () => "npm-cli.js", setVersion: (value: string) => { version = value; }, fail: () => { failInstall = true; }, hold: (value: Promise<void>) => { hold = value; } };
}
const call = (service: OpenCliService, op: string, params = {}) => service.command({ requestId: randomUUID(), op, params });
async function settle(service: OpenCliService) {
  const until = Date.now() + 5000;
  while (service.snapshot().job?.running) {
    assert.ok(Date.now() < until, "operation did not settle");
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return service.snapshot();
}

test("OpenCLI: install receipt is short, jobs are exclusive and idempotent; official skills load without copying", async () => {
  const f = openCliFixture(), store = new Store(join(f.root, "data"));
  const service = new OpenCliService(f.root, () => {}, f.execute, f.locateNpm);
  try {
    await call(service, "opencli.check");
    assert.equal((await settle(service)).version, undefined);
    let release!: () => void;
    f.hold(new Promise<void>((r) => { release = r; }));
    const command = { requestId: randomUUID(), op: "opencli.install", params: { version: "1.8.8" } };
    const first = await store.external(command, () => service.command(command));
    assert.equal(service.snapshot().job?.running, true);
    assert.deepEqual(await store.external(command, () => service.command(command)), first);
    await assert.rejects(call(service, "opencli.install", { version: "1.8.8" }), { code: "BUSY" });
    await assert.rejects(call(service, "opencli.save", { ...service.snapshot().settings, revision: "" }), { code: "BUSY" });
    release();
    const installed = await settle(service);
    assert.equal(installed.version, "1.8.8");
    assert.equal(installed.configured, true);
    assert.equal(f.calls.filter((args) => args[1] === "install").length, 1);
    const args = f.calls.find((args) => args[1] === "install")!;
    assert.ok(args.includes("--ignore-scripts")); assert.ok(args.includes("@jackwener/opencli@1.8.8"));
    const config = readOpenCliConfig(f.root)!;
    const loaded = loadSkills({ cwd: f.root, agentDir: join(f.root, "pi"), includeDefaults: false, skillPaths: openCliSkillPaths(config) });
    assert.deepEqual(loaded.skills.map((s) => s.name).sort(), [...openCliSkillNames].sort());
    assert.equal(loaded.diagnostics.length, 0);
    assert.ok(!formatSkillsForPrompt(loaded.skills).includes("Read this guide only when needed."));
    await call(service, "opencli.doctor");
    const diagnosed = await settle(service);
    assert.ok(diagnosed.diagnostic?.text.includes("[MISSING]"));
    assert.ok(!diagnosed.job?.message.includes("连接成功"), "exit zero must not imply a healthy browser");
  } finally { await service.close(); store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("OpenCLI: revision conflicts preserve config; environment and in-place skill updates invalidate worker reuse", async () => {
  const f = openCliFixture(); f.install("1.8.8");
  const service = new OpenCliService(f.root, () => {}, f.execute, f.locateNpm);
  try {
    await call(service, "opencli.refresh"); await settle(service);
    const before = resourceIdentity(f.root, join(f.root, "pi"));
    await call(service, "opencli.save", { enabled: true, profile: "work-profile", window: "background", revision: "" });
    assert.notEqual(before, resourceIdentity(f.root, join(f.root, "pi")));
    const saved = readFileSync(openCliConfigPath(f.root), "utf8");
    await assert.rejects(call(service, "opencli.save", { enabled: false, profile: "", window: "foreground", revision: "" }), { code: "CONFIGURATION_CONFLICT" });
    assert.equal(readFileSync(openCliConfigPath(f.root), "utf8"), saved);
    const config = readOpenCliConfig(f.root)!;
    const env = openCliEnvironment(config, { Path: "old", PATH: "other", OPENCLI_PROFILE: "old-profile" });
    assert.deepEqual(Object.keys(env).filter((k) => k.toUpperCase() === "PATH"), ["PATH"]);
    assert.equal(env.PATH?.split(delimiter)[0], config.binDirectory);
    assert.equal(env.OPENCLI_PROFILE, "work-profile"); assert.equal(env.OPENCLI_WINDOW, "background");
    assert.equal(openCliEnvironment({ ...config, profile: "" }, env).OPENCLI_PROFILE, undefined);
    const identity = resourceIdentity(f.root, join(f.root, "pi"));
    f.install("1.8.9");
    assert.notEqual(identity, resourceIdentity(f.root, join(f.root, "pi")), "target files change without replacing a symlink");
    await call(service, "opencli.save", { enabled: false, profile: "", window: "foreground", revision: config.revision });
    assert.deepEqual(openCliSkillPaths(readOpenCliConfig(f.root)!), []);
  } finally { await service.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("OpenCLI: failed update, shutdown and interrupted restart never claim rollback or replay npm", async () => {
  const f = openCliFixture(); f.install("1.8.8"); f.setVersion("1.8.9");
  let service = new OpenCliService(f.root, () => {}, f.execute, f.locateNpm);
  try {
    await call(service, "opencli.check"); await settle(service);
    await call(service, "opencli.save", { ...service.snapshot().settings, revision: "" });
    const original = readFileSync(openCliConfigPath(f.root), "utf8");
    f.fail();
    await call(service, "opencli.install", { version: "1.8.9" });
    const failed = await settle(service);
    assert.equal(failed.version, "1.8.8"); assert.ok(failed.job?.error?.includes("network failure"));
    assert.ok(!failed.job?.error?.includes("secret-value"));
    assert.equal(readFileSync(openCliConfigPath(f.root), "utf8"), original);
    f.hold(new Promise(() => {}));
    await call(service, "opencli.install", { version: "1.8.9" });
    await new Promise<void>((r) => setImmediate(r));
    await service.close();
    assert.equal(service.snapshot().job?.running, false);
    const callCount = f.calls.length;
    writeFileSync(join(f.root, "integrations", "opencli-job.json"), JSON.stringify({ id: "interrupted", kind: "install", running: true, message: "installing" }));
    service = new OpenCliService(f.root, () => {}, f.execute, f.locateNpm);
    assert.equal(service.snapshot().job?.running, false);
    assert.ok(service.snapshot().job?.error?.includes("中断"));
    assert.equal(f.calls.length, callCount);
    writeFileSync(openCliConfigPath(f.root), "broken");
    await call(service, "opencli.refresh"); await settle(service);
    await assert.rejects(call(service, "opencli.save", { enabled: true, profile: "", window: "foreground", revision: "" }));
    assert.equal(readFileSync(openCliConfigPath(f.root), "utf8"), "broken");
  } finally { await service.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("OpenCLI process runner separates stdout from npm warnings and terminates timed out processes", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-opencli-runner-"));
  const options = { cwd: root, env: process.env, signal: new AbortController().signal, timeout: 5000 };
  try {
    assert.equal(await executeOpenCli(["-e", 'console.error("warning"); console.log("1.8.8")'], options), "1.8.8");
    await assert.rejects(executeOpenCli(["-e", "setInterval(()=>{}, 1000)"], { ...options, timeout: 100 }), /超时/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("OpenCLI: optional resource failures stay local; failed initial journal write never leaves a phantom job", async () => {
  const f = openCliFixture(); f.install("1.8.8");
  const service = new OpenCliService(f.root, () => {}, f.execute, f.locateNpm);
  try {
    await call(service, "opencli.refresh"); await settle(service);
    await call(service, "opencli.save", { ...service.snapshot().settings, revision: "" });
    assert.equal(openCliResources(f.root, f.root).skills.length, 2);
    rmSync(join(f.packageRoot, "skills", "opencli-browser"), { recursive: true });
    assert.ok(openCliResources(f.root, f.root).warning);
    assert.deepEqual(openCliResources(f.root, f.root).skills, []);
    writeFileSync(openCliConfigPath(f.root), "broken");
    assert.ok(openCliResources(f.root, f.root).warning, "corrupt optional config must not throw into main agent startup");
    rmSync(join(f.root, "integrations", "opencli-job.json"));
    mkdirSync(join(f.root, "integrations", "opencli-job.json"));
    const count = f.calls.length;
    await assert.rejects(call(service, "opencli.refresh"), { code: "STORAGE_ERROR" });
    assert.equal(service.snapshot().job?.running, false);
    assert.equal(service.installing, false);
    assert.equal(f.calls.length, count);
  } finally { await service.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("OpenCLI: failed environment checks settle their child before releasing job admission", async () => {
  const f = openCliFixture();
  const calls: string[][] = [];
  const service = new OpenCliService(f.root, () => {}, async (args) => { calls.push(args); throw Error("npm unavailable"); }, f.locateNpm);
  try {
    await call(service, "opencli.refresh"); await settle(service);
    assert.equal(calls.length, 1, "sequential probing must not leave root/prefix children behind on first failure");
    assert.equal(service.snapshot().job?.running, false);
  } finally { await service.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("OpenCLI: install rejects a prompt already admitted but still preparing its model", async () => {
  const f = openCliFixture();
  const app = await startServer({ root: join(f.root, "data"), port: 0, openCli: { execute: f.execute, locateNpm: f.locateNpm } });
  const ws = new WebSocket(app.origin.replace("http:", "ws:") + "/ws", { headers: { Origin: app.origin } });
  await once(ws, "open");
  const waiting = new Map<string, (value: any) => void>();
  ws.on("message", (raw) => { const value = JSON.parse(raw.toString()); if (value.type === "receipt") waiting.get(value.requestId)?.(value); });
  const send = (op: string, extra = {}) => new Promise<any>((resolve) => { const requestId = randomUUID(); waiting.set(requestId, resolve); ws.send(JSON.stringify({ requestId, op, ...extra })); });
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const admitted = new Promise<void>((r) => { entered = r; });
  const original = app.tasks.command.bind(app.tasks);
  app.tasks.command = async (c) => { if (c.op === "prompt") { entered(); await gate; return {}; } return original(c); };
  try {
    const workspace = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: f.root, authorized: true } }) as { id: string };
    const session = app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as { id: string };
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    const prompt = send("prompt", { ...scope, params: { text: "fixture" } });
    await admitted;
    assert.equal(app.agents.active(scope), false, "the async pre-launch window has no active run yet");
    const rejected = await send("opencli.install", { params: { version: "1.8.8" } });
    assert.equal(rejected.error.code, "AGENT_BUSY");
    release(); await prompt;
    assert.equal(f.calls.length, 0);
  } finally { release(); ws.terminate(); await app.close(); rmSync(f.root, { recursive: true, force: true }); }
});
