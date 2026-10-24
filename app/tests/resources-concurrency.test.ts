import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "./temporary.js";
import { Store } from "../src/server/storage.js";
import { Capabilities } from "../src/server/capabilities.js";
import { Resources } from "../src/server/resources.js";
import { MaintenanceError } from "../src/shared/maintenance.js";
import type { ResourceJob, ResourceState } from "../src/shared/resources.js";
import type { OpenCliExecute } from "../src/server/integrations/opencli.js";
function file(path: string, value: unknown) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value)); }
async function until(predicate: () => boolean) { for (let i = 0; i < 500; i++) { if (predicate()) return; await delay(10); } assert.fail("operation did not reach its expected state"); }
async function fixture(t: TestContext, beforeChange = async () => {}) {
  const root = mkdtempSync(join(tmpdir(), "axiom-resource-concurrency-")), pi = join(root, "shared-pi");
  const old = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = pi;
  const skillNames = new Map<string, string[]>();
  const gates = new Map<string, { release: () => void; fail: (reason?: Error) => void; signal: AbortSignal }>();
  const execute: OpenCliExecute = async (args, options) => {
    const directory = args[args.indexOf("--prefix") + 1], name = args.at(-1)!;
    await new Promise<void>((resolve, reject) => {
      const signal = options!.signal!;
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      gates.set(name, { release: () => { signal.removeEventListener("abort", abort); resolve(); }, fail: (reason = Error("isolated fixture failure")) => { signal.removeEventListener("abort", abort); reject(reason); }, signal });
      if (signal.aborted) abort();
    });
    const packageRoot = join(directory, "node_modules", name);
    file(join(packageRoot, "package.json"), { name, version: "1.0.0", bin: "index.js", pi: { skills: ["skills"] } });
    file(join(packageRoot, "index.js"), "// local fixture only");
    for (const skill of skillNames.get(name) ?? [name]) file(join(packageRoot, "skills", skill, "SKILL.md"), `---\nname: ${skill}\ndescription: concurrency fixture\n---\nGuide`);
    return "";
  };
  const store = new Store(root); new Capabilities(store, () => {}, pi);
  // No OS command is launched by this fixture; unknown is injected explicitly.
  const resources = new Resources(store, pi, () => {}, beforeChange, async (args, options) => {
    let unknown = false;
    try { return await execute(args, options); }
    catch (error) { unknown = error instanceof MaintenanceError && error.code === "stop-unconfirmed"; throw error; }
    finally { if (!unknown) options.onStopped("not-started"); }
  });
  t.after(async () => { await resources.close(); store.close(); if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old; rmSync(root, { recursive: true, force: true }); });
  const admit = async (params: Record<string, unknown>) => {
    const state = await resources.refresh();
    const response = await resources.command({ requestId: randomUUID(), op: "resources.install", params: { revision: state.revision, ...params } }) as ResourceState;
    assert.ok(response.acceptedJobId);
    return response.acceptedJobId;
  };
  const job = (id: string): ResourceJob => resources.snapshot().jobs!.find(job => job.id === id)!;
  return { root, pi, store, resources, gates, skillNames, admit, job };
}
test("independent MCP installs finish out of order, merge records, and keep exact job identities", async t => {
  const f = await fixture(t);
  file(join(f.pi, "mcp.json"), { mcpServers: { existing: { url: "https://example.invalid/mcp" } } });
  const first = await f.admit({ kind: "mcp", name: "first", source: "fixture-first" });
  await until(() => f.gates.has("fixture-first"));
  const second = await f.admit({ kind: "mcp", name: "second", source: "fixture-second" });
  await until(() => f.gates.has("fixture-second"));
  assert.equal(f.resources.snapshot().jobs!.filter(job => job.running).length, 2);
  await assert.rejects(f.admit({ kind: "mcp", name: "first", source: "fixture-conflict" }), /此资源或共享安装目录正在维护/);
  const existing = f.resources.snapshot().items.find(item => item.name === "existing")!;
  await f.resources.command({ requestId: randomUUID(), op: "resources.detail", params: { id: existing.id } });
  f.gates.get("fixture-second")!.release();
  await until(() => !f.job(second).running);
  assert.equal(f.job(first).running, true); assert.equal(f.job(second).error, undefined);
  assert.equal(f.job(second).resourceId, "mcp:second");
  f.gates.get("fixture-first")!.release();
  await until(() => !f.resources.busy);
  assert.equal(f.job(first).error, undefined); assert.equal(f.job(first).resourceId, "mcp:first");
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(f.pi, "mcp.json"), "utf8")).mcpServers).sort(), ["existing", "first", "second"]);
  assert.equal(JSON.parse(readFileSync(join(f.root, "resources", "installed.json"), "utf8")).items.length, 2);
  const persisted = JSON.parse(readFileSync(join(f.root, "resources", "job.json"), "utf8"));
  assert.equal(persisted.jobs.length, 2); assert.ok(persisted.jobs.every((job: ResourceJob) => !job.running));
});
test("one failed installation cannot fail or abort a parallel skill installation", async t => {
  const f = await fixture(t);
  const first = await f.admit({ kind: "skill", source: "npm:fixture-fails" });
  const second = await f.admit({ kind: "skill", source: "npm:fixture-kept" });
  await until(() => f.gates.size === 2);
  f.gates.get("fixture-fails")!.fail();
  await until(() => !f.job(first).running);
  assert.ok(f.job(first).error); assert.equal(f.job(second).running, true);
  assert.equal(f.gates.get("fixture-kept")!.signal.aborted, false);
  f.gates.get("fixture-kept")!.release();
  await until(() => !f.resources.busy);
  assert.equal(f.job(second).error, undefined);
  assert.ok(f.resources.snapshot().items.some(item => item.id === f.job(second).resourceId && item.name === "fixture-kept"));
  const settings = JSON.parse(readFileSync(join(f.root, "pi", "settings.json"), "utf8"));
  assert.equal(settings.skills.length, 1);
});
test("a failed skill move restores only its own entries after another installation commits", async t => {
  const f = await fixture(t), project = join(f.root, "project");
  mkdirSync(project, { recursive: true });
  f.store.db.prepare("INSERT INTO workspaces(id,path,pathKey,name,authorized) VALUES(?,?,?,?,1)").run("project", project, project, "Project");
  const source = join(f.root, "source");
  file(join(source, "SKILL.md"), "---\nname: original\ndescription: move fixture\n---\nGuide");
  const installed = await f.admit({ kind: "skill", source });
  await until(() => !f.resources.busy);
  assert.equal(f.job(installed).error, undefined);
  const targetId = f.job(installed).resourceId!, recordsPath = join(f.root, "resources", "installed.json"), settingsPath = join(f.root, "pi", "settings.json");
  const owned = JSON.parse(readFileSync(recordsPath, "utf8")).items[0];
  const originalSettings = JSON.parse(readFileSync(settingsPath, "utf8"));
  originalSettings.skills.push(owned.directory); file(settingsPath, originalSettings);
  let armed = false, entered = false, release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const service = f.resources as any, patch = service.patchArray.bind(service), manager = service.manager.bind(service);
  service.patchArray = (...args: any[]) => { const undo = patch(...args); if (args[0] === recordsPath) armed = true; return undo; };
  service.manager = (cwd: string) => {
    const value = manager(cwd);
    if (armed && cwd === f.root) {
      armed = false; const resolve = value.manager.resolve.bind(value.manager);
      value.manager.resolve = async (...args: any[]) => { entered = true; await barrier; return resolve(...args); };
    }
    return value;
  };
  try {
    const state = await f.resources.refresh();
    const response = await f.resources.command({ requestId: randomUUID(), op: "resources.move", params: { id: targetId, destinationScopeId: "project", revision: state.revision } }) as ResourceState;
    await until(() => entered);
    const other = await f.admit({ kind: "skill", source: "npm:fixture-concurrent" });
    await until(() => f.gates.has("fixture-concurrent")); f.gates.get("fixture-concurrent")!.release();
    await until(() => !f.job(other).running); assert.equal(f.job(other).error, undefined);
    release(); await until(() => !f.resources.busy);
    assert.match(f.job(response.acceptedJobId!).error ?? "", /原范围仍/);
    const records = JSON.parse(readFileSync(recordsPath, "utf8")).items;
    assert.equal(records.length, 2); assert.equal(records.find((item: any) => item.id === targetId).scopeId, "global");
    assert.ok(records.some((item: any) => item.id === f.job(other).resourceId));
    const paths = JSON.parse(readFileSync(settingsPath, "utf8")).skills;
    assert.deepEqual(paths.filter((path: string) => originalSettings.skills.includes(path)), originalSettings.skills);
    assert.equal(paths.length, 3, "the independent installation's path survives rollback");
  } finally { release(); }
});

test("restart exposes every interrupted job and close aborts every live operation", async t => {
  const f = await fixture(t);
  const first = await f.admit({ kind: "mcp", name: "one", source: "fixture-one" });
  const second = await f.admit({ kind: "mcp", name: "two", source: "fixture-two" });
  await until(() => f.gates.size === 2);
  const restarted = new Resources(f.store, f.pi, () => {}, async () => {});
  assert.deepEqual(restarted.snapshot().jobs!.map(job => job.id), [first, second]);
  assert.ok(restarted.snapshot().jobs!.every(job => !job.running && job.error?.includes("未自动重复操作")));
  await restarted.close();
  await f.resources.close();
  assert.ok([...f.gates.values()].every(gate => gate.signal.aborted));
  assert.ok(f.resources.snapshot().jobs!.every(job => !job.running && job.error));
  assert.equal(f.resources.busy, false);
});
test("npm prefix conflicts are rejected while independent Git repositories are admitted without running installers", async t => {
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  const f = await fixture(t, () => barrier);
  await f.admit({ kind: "package", source: "npm:fixture-one" });
  await assert.rejects(f.admit({ kind: "package", source: "npm:fixture-two" }), /此资源或共享安装目录正在维护/);
  await f.admit({ kind: "package", source: "git:github.com/fixture/one" });
  await f.admit({ kind: "package", source: "git:github.com/fixture/two" });
  assert.equal(f.resources.snapshot().jobs!.filter(job => job.running).length, 3);
  const closing = f.resources.close(); release(); await closing;
  assert.equal(f.gates.size, 0);
  assert.ok(f.resources.snapshot().jobs!.every(job => !job.running && job.error));
});

test("a multi-skill move reserves every real name in its old scope until rollback ends", async t => {
  const f = await fixture(t), project = join(f.root, "project");
  mkdirSync(project, { recursive: true });
  f.store.db.prepare("INSERT INTO workspaces(id,path,pathKey,name,authorized) VALUES(?,?,?,?,1)").run("project", project, project, "Project");
  f.skillNames.set("fixture-bundle", ["alpha", "beta"]);
  const installation = await f.admit({ kind: "skill", source: "npm:fixture-bundle" });
  await until(() => f.gates.has("fixture-bundle")); f.gates.get("fixture-bundle")!.release();
  await until(() => !f.resources.busy); assert.equal(f.job(installation).error, undefined);
  const id = f.job(installation).resourceId!, records = join(f.root, "resources", "installed.json");
  const service = f.resources as any, patch = service.patchArray.bind(service), manager = service.manager.bind(service);
  let armed = false, entered = false, release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  service.patchArray = (...args: any[]) => { const undo = patch(...args); if (args[0] === records) armed = true; return undo; };
  service.manager = (cwd: string) => {
    const value = manager(cwd);
    if (armed && cwd === f.root) { armed = false; value.manager.resolve = async () => { entered = true; await barrier; throw Error("forced move validation failure"); }; }
    return value;
  };
  try {
    const state = await f.resources.refresh();
    const moved = await f.resources.command({ requestId: randomUUID(), op: "resources.move", params: { revision: state.revision, id, destinationScopeId: "project" } }) as ResourceState;
    await until(() => entered);
    const source = join(f.root, "unrelated-source"); file(join(source, "SKILL.md"), "---\nname: unused\ndescription: fixture\n---\nGuide");
    await assert.rejects(f.admit({ kind: "skill", source, name: "beta" }), /此资源或共享安装目录正在维护/);
    const npm = await f.admit({ kind: "skill", source: "npm:fixture-collision" });
    f.skillNames.set("fixture-collision", ["beta"]);
    await until(() => f.gates.has("fixture-collision")); f.gates.get("fixture-collision")!.release();
    await until(() => !f.job(npm).running); assert.match(f.job(npm).error ?? "", /同名技能正在/);
    release(); await until(() => !f.resources.busy);
    assert.ok(f.job(moved.acceptedJobId!).error);
    const saved = JSON.parse(readFileSync(records, "utf8")).items;
    assert.equal(saved.length, 1); assert.equal(saved[0].scopeId, "global");
    assert.ok(f.resources.snapshot().items.some(item => item.id === id && item.scopeId === "global"));
  } finally { release(); }
});

test("refresh never publishes a catalog read before a settings change with its new revision", async t => {
  const f = await fixture(t), project = join(f.root, "project"), settings = join(project, ".pi", "settings.json");
  mkdirSync(project, { recursive: true });
  f.store.db.prepare("INSERT INTO workspaces(id,path,pathKey,name,authorized) VALUES(?,?,?,?,1)").run("project", project, project, "Project");
  const first = join(f.root, "first"), second = join(f.root, "second");
  for (const [directory, name] of [[first, "first"], [second, "second"]]) {
    file(join(directory, "package.json"), { name, version: "1.0.0", pi: { skills: ["skills"] } });
    file(join(directory, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: fixture\n---\nGuide`);
  }
  file(settings, { packages: [first] });
  const service = f.resources as any, manager = service.manager.bind(service);
  let reads = 0, entered = false, release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  service.manager = (cwd: string) => {
    const value = manager(cwd);
    if (cwd === project && ++reads === 1) {
      const resolve = value.manager.resolve.bind(value.manager);
      value.manager.resolve = async (...args: any[]) => { entered = true; await barrier; return resolve(...args); };
    }
    return value;
  };
  const published: ResourceState[] = []; service.publish = () => published.push(f.resources.snapshot());
  const refresh = f.resources.refresh();
  try {
    await until(() => entered); file(settings, { packages: [second] }); release();
    const state = await refresh;
    assert.ok(reads >= 2);
    assert.ok(state.items.some(item => item.source === second));
    assert.ok(!published.some(state => state.items.some(item => item.source === first)), "stale package list must never be published");
  } finally { release(); await refresh; }
});

test("unconfirmed npm exits keep their directory and durable conflict barrier across restart", async t => {
  const f = await fixture(t);
  const id = await f.admit({ kind: "mcp", name: "uncertain", source: "fixture-unknown" });
  await until(() => f.gates.has("fixture-unknown"));
  const pending = join(f.root, "resources", `.npm-operation-${id}.json`);
  const directory = JSON.parse(readFileSync(pending, "utf8")).directory;
  assert.ok(existsSync(directory), "intent must exist before installer starts");
  f.gates.get("fixture-unknown")!.fail(new MaintenanceError("stop-unconfirmed", "fixture unknown stop"));
  await until(() => !f.resources.busy);
  assert.match(f.job(id).error ?? "", /退出尚未确认/);
  assert.ok(existsSync(directory)); assert.ok(existsSync(pending));
  assert.ok(f.resources.snapshot().warnings.some(warning => warning.includes(directory)));
  const restarted = new Resources(f.store, f.pi, () => {}, async () => { assert.fail("unknown install must not be replayed"); });
  try {
    const state = await restarted.refresh();
    await assert.rejects(restarted.command({ requestId: randomUUID(), op: "resources.install", params: { revision: state.revision, kind: "mcp", name: "uncertain", source: "fixture-other" } }), { code: "stop-unconfirmed" });
    assert.ok(existsSync(directory)); assert.ok(existsSync(pending));
    assert.equal(readdirSync(join(f.root, "resources")).filter(name => name.startsWith(".npm-operation-")).length, 1);
  } finally { await restarted.close(); }
});
