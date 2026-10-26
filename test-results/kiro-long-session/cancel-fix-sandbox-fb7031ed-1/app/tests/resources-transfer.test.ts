import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "./temporary.js";
import { Store } from "../src/server/storage.js";
import { Resources } from "../src/server/resources.js";
import { Capabilities } from "../src/server/capabilities.js";
import { skillId } from "../src/server/capability-resources.js";
import type { ResourceDetail } from "../src/shared/resources.js";
function file(path: string, content: string) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
function skill(path: string, content: string) { file(join(path, "SKILL.md"), `---\nname: transfer-skill\ndescription: transfer fixture\n---\n${content}`); file(join(path, "attached.txt"), content); }
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
async function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "axiom-transfer-")), pi = join(root, "shared-pi"), project = join(root, "project");
  const old = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = pi;
  mkdirSync(project, { recursive: true });
  const store = new Store(root); new Capabilities(store, () => {}, pi);
  store.db.prepare("INSERT INTO workspaces(id,path,pathKey,name,authorized) VALUES('project',?,?, 'Project',1)").run(project, project);
  let installs = 0;
  const resources = new Resources(store, pi, () => {}, async () => {}, async (args, options) => {
    installs++;
    const directory = args[args.indexOf("--prefix") + 1], pkg = join(directory, "node_modules/fixture-mcp");
    file(join(pkg, "package.json"), JSON.stringify({ name: "fixture-mcp", version: "1.0.0", bin: "index.js" }));
    file(join(pkg, "index.js"), "// managed executable");
    mkdirSync(join(directory, "node_modules/.bin"), { recursive: true });
    symlinkSync("../fixture-mcp/index.js", join(directory, "node_modules/.bin/fixture"));
    options.onStopped("not-started"); return "";
  });
  t.after(async () => { await resources.close(); store.close(); if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old; rmSync(root, { recursive: true, force: true }); });
  const act = async (op: string, params: Record<string, unknown>) => {
    const state = await resources.refresh();
    await resources.command({ op, requestId: randomUUID(), params: { revision: state.revision, ...params } });
    for (let i = 0; resources.busy && i < 1000; i++) await delay(10);
    assert.equal(resources.busy, false); return resources.snapshot();
  };
  const detail = (id: string) => resources.command({ op: "resources.detail", requestId: randomUUID(), params: { id } }) as Promise<ResourceDetail>;
  return { root, pi, project, store, resources, act, detail, installs: () => installs };
}
for (const managed of [false, true]) for (const fromProject of [false, true]) test(`skill copy is independent: managed=${managed}, fromProject=${fromProject}`, async t => {
  const f = await fixture(t), source = managed ? join(f.root, "import-source") : join(fromProject ? f.project : f.pi, ".pi", "skills", "original");
  skill(source, "original contents");
  let id: string;
  if (managed) {
    const state = await f.act("resources.install", { kind: "skill", source, name: "transfer-skill", scopeId: fromProject ? "project" : "global" });
    assert.equal(state.job?.error, undefined); id = state.job!.resourceId!;
  } else {
    file(join(fromProject ? f.project : join(f.root, "pi"), fromProject ? ".pi/settings.json" : "settings.json"), JSON.stringify({ skills: [source] }));
    id = (await f.resources.refresh()).items.find(item => item.kind === "skill" && item.name === "transfer-skill")!.id;
  }
  const original = (await f.detail(id)).documents[0].path;
  f.store.db.prepare("INSERT OR REPLACE INTO capability_preferences(id,revision,body) VALUES(1,1,?)").run(JSON.stringify({ skills: { [skillId(original)]: false }, mcp: {} }));
  let state = await f.act("resources.copy", { id, destinationScopeId: fromProject ? "global" : "project" });
  assert.equal(state.job?.error, undefined);
  const copiedId = state.job!.resourceId!, copied = (await f.detail(copiedId)).documents[0].path;
  assert.notEqual(copiedId, id); assert.notEqual(copied, original);
  assert.equal(readFileSync(copied, "utf8"), readFileSync(original, "utf8"));
  assert.equal(readFileSync(join(dirname(copied), "attached.txt"), "utf8"), "original contents");
  assert.ok(state.items.some(item => item.id === id));
  const preferences = JSON.parse(String(f.store.db.prepare("SELECT body FROM capability_preferences WHERE id=1").get()!.body));
  assert.equal(preferences.skills[skillId(original)], false); assert.equal(preferences.skills[skillId(copied)], false);
  state = await f.act("resources.remove", { id, confirm: true }); assert.equal(state.job?.error, undefined);
  assert.ok(existsSync(copied)); assert.ok((await f.resources.refresh()).items.some(item => item.id === copiedId));
});
for (const action of ["copy", "move"]) for (const managedTarget of [false, true]) test(`skill ${action} overwrites only the exact target: managed=${managedTarget}`, async t => {
  const f = await fixture(t), source = join(f.pi, "skills/original"), destination = managedTarget ? join(f.root, "import-target") : join(f.project, ".pi/skills/old");  skill(source, "new content"); skill(destination, "old content"); file(join(destination, "obsolete.txt"), "old attachment");
  let oldId: string;
  if (managedTarget) {
    const state = await f.act("resources.install", { kind: "skill", source: destination, name: "transfer-skill", scopeId: "project" });
    assert.equal(state.job?.error, undefined); oldId = state.job!.resourceId!; rmSync(destination, { recursive: true });
  } else oldId = (await f.resources.refresh()).items.find(item => item.scopeId === "project" && item.name === "transfer-skill")!.id;
  const oldPath = (await f.detail(oldId)).location;
  const id = (await f.resources.refresh()).items.find(item => item.scopeId === "global" && item.name === "transfer-skill")!.id;
  let state = await f.act(`resources.${action}`, { id, destinationScopeId: "project" }); assert.match(state.job?.error ?? "", /同名技能/);
  state = await f.act(`resources.${action}`, { id, destinationScopeId: "project", overwrite: true }); assert.equal(state.job?.error, undefined);
  const copied = (await f.detail(state.job!.resourceId!)).documents[0].path;
  assert.match(readFileSync(copied, "utf8"), /new content/); assert.equal(existsSync(join(dirname(copied), "obsolete.txt")), false);
  assert.equal(existsSync(source), action === "copy"); assert.equal(existsSync(oldPath), false);
  assert.equal(state.items.filter(item => item.scopeId === "project" && item.name === "transfer-skill").length, 1);
});
for (const action of ["copy", "move"]) test(`skill ${action} overwrite restores both resources on database failure`, async t => {
  const f = await fixture(t), source = join(f.pi, "skills/original"), destination = join(f.project, ".pi/skills/old");
  skill(source, "source"); skill(destination, "destination");
  const settings = join(f.project, ".pi/settings.json"), originalSettings = '{ "skills": ["./skills/old"], "keep": 1 }\n'; file(settings, originalSettings);
  f.store.db.prepare("INSERT OR REPLACE INTO capability_preferences(id,revision,body) VALUES(1,1,?)").run('{"skills":{},"mcp":{}}');
  f.store.db.exec("CREATE TRIGGER fail_transfer BEFORE UPDATE ON capability_preferences BEGIN SELECT RAISE(ROLLBACK, 'fixture'); END;");
  const id = (await f.resources.refresh()).items.find(item => item.scopeId === "global" && item.name === "transfer-skill")!.id;
  const state = await f.act(`resources.${action}`, { id, destinationScopeId: "project", overwrite: true }); assert.ok(state.job?.error); assert.equal(state.job?.resourceId, undefined);
  assert.match(readFileSync(join(source, "SKILL.md"), "utf8"), /source/); assert.match(readFileSync(join(destination, "SKILL.md"), "utf8"), /destination/);
  assert.equal(readFileSync(settings, "utf8"), originalSettings); assert.equal(existsSync(join(f.root, "pi/settings.json")), false);
  assert.equal(readdirSync(join(f.project, ".pi")).some(name => /\.axiom-.*\.(backup|staging)$/.test(name)), false);
});
for (const action of ["copy", "move"]) test(`MCP ${action} overwrite preserves source as requested and replaces complete raw config`, async t => {
  const f = await fixture(t), source = join(f.pi, "mcp.json"), destination = join(f.project, ".pi/mcp.json");
  const raw = { url: "https://fixture.invalid/mcp", headers: { Authorization: "source-secret" }, enabled: false };
  file(source, JSON.stringify({ keep: 1, mcpServers: { docs: raw } }));
  file(destination, JSON.stringify({ keep: 2, mcpServers: { docs: { command: "old", env: { OLD: "secret" } }, unrelated: { command: "keep" } } }));
  const auth = join(f.pi, "mcp-auth.json"); file(auth, '{"token":"keep"}');
  let state = await f.act(`resources.${action}`, { id: "mcp:docs", destinationScopeId: "project" }); assert.match(state.job?.error ?? "", /同名 MCP/);
  state = await f.act(`resources.${action}`, { id: "mcp:docs", destinationScopeId: "project", overwrite: true }); assert.equal(state.job?.error, undefined);
  assert.deepEqual(json(destination).mcpServers.docs, raw); assert.equal(json(destination).keep, 2); assert.equal(json(destination).mcpServers.unrelated.command, "keep");
  assert.equal(!!json(source).mcpServers.docs, action === "copy"); assert.equal(readFileSync(auth, "utf8"), '{"token":"keep"}');
  assert.ok(!JSON.stringify(await f.detail(state.job!.resourceId!)).includes("source-secret"));
});
test("managed MCP copy duplicates dependencies and survives removal of source", async t => {
  const f = await fixture(t);
  let state = await f.act("resources.install", { kind: "mcp", name: "managed", source: "fixture-mcp" }); assert.equal(state.job?.error, undefined);
  const original = json(join(f.pi, "mcp.json")).mcpServers.managed.args[0];
  state = await f.act("resources.copy", { id: "mcp:managed", destinationScopeId: "project" }); assert.equal(state.job?.error, undefined);
  const copiedId = state.job!.resourceId!, copied = json(join(f.project, ".pi/mcp.json")).mcpServers.managed.args[0];
  assert.notEqual(copied, original); assert.equal(f.installs(), 1); assert.ok(existsSync(copied));
  assert.equal(json(join(f.root, "resources/installed.json")).items.length, 2);
  state = await f.act("resources.remove", { id: "mcp:managed", confirm: true }); assert.equal(state.job?.error, undefined);
  assert.equal(existsSync(original), false); assert.ok(existsSync(copied));
  state = await f.act("resources.update", { id: copiedId }); assert.equal(state.job?.error, undefined); assert.equal(f.installs(), 2);
});
test("managed MCP overwrite rolls back configs and records on persistence failure", async t => {
  const f = await fixture(t);
  for (const scopeId of ["global", "project"]) { const state = await f.act("resources.install", { kind: "mcp", name: "managed", source: "fixture-mcp", scopeId }); assert.equal(state.job?.error, undefined); }
  const paths = [join(f.pi, "mcp.json"), join(f.project, ".pi/mcp.json"), join(f.root, "resources/installed.json")], before = paths.map(path => readFileSync(path, "utf8"));
  f.store.db.prepare("INSERT OR REPLACE INTO capability_preferences(id,revision,body) VALUES(1,1,?)").run('{"skills":{},"mcp":{}}');
  f.store.db.exec("CREATE TRIGGER fail_transfer BEFORE UPDATE ON capability_preferences BEGIN SELECT RAISE(ABORT, 'fixture'); END;");
  let state = await f.act("resources.copy", { id: "mcp:managed", destinationScopeId: "project", overwrite: true }); assert.match(state.job?.error ?? "", /已恢复原配置/);
  assert.deepEqual(paths.map(path => readFileSync(path, "utf8")), before);
  assert.equal(readdirSync(join(f.root, "resources")).filter(name => /^[a-f0-9-]{36}$/.test(name)).length, 2);
  f.store.db.exec("DROP TRIGGER fail_transfer");
  const oldEntry = json(paths[1]).mcpServers.managed.args[0];
  state = await f.act("resources.copy", { id: "mcp:managed", destinationScopeId: "project", overwrite: true }); assert.equal(state.job?.error, undefined);
  assert.equal(existsSync(oldEntry), false); assert.equal(json(paths[2]).items.length, 2);
});
test("global MCP with inherited project override can be copied but cannot be moved", async t => {
  const f = await fixture(t), source = join(f.pi, "mcp.json"), destination = join(f.project, ".pi/mcp.json");
  const raw = { command: "node", args: ["/external/server.mjs"], env: { KEEP: "source" } };
  file(source, JSON.stringify({ mcpServers: { docs: raw } }));
  file(destination, JSON.stringify({ mcpServers: { docs: { enabled: false } } }));
  const item = (await f.resources.refresh()).items.find(item => item.id === "mcp:docs")!;
  assert.equal(item.copyable, true); assert.equal(item.movable, false);
  await assert.rejects(f.act("resources.move", { id: item.id, destinationScopeId: "project", overwrite: true }), /局部覆盖/);
  const state = await f.act("resources.copy", { id: item.id, destinationScopeId: "project", overwrite: true });
  assert.equal(state.job?.error, undefined);
  assert.deepEqual(json(source).mcpServers.docs, raw); assert.deepEqual(json(destination).mcpServers.docs, raw);
});
test("overwrite never bypasses MCP namespace or unrelated skill path protections", async t => {
  const f = await fixture(t);
  file(join(f.pi, "mcp.json"), '{"mcpServers":{"same-name":{"command":"source"}}}');
  file(join(f.project, ".pi/mcp.json"), '{"mcpServers":{"same_name":{"command":"destination"}}}');
  let state = await f.act("resources.copy", { id: "mcp:same-name", destinationScopeId: "project", overwrite: true }); assert.match(state.job?.error ?? "", /名称空间/);
  skill(join(f.pi, "skills/original"), "source"); file(join(f.project, ".pi/skills/original/unrelated.txt"), "keep");
  const id = (await f.resources.refresh()).items.find(item => item.name === "transfer-skill")!.id;
  state = await f.act("resources.copy", { id, destinationScopeId: "project", overwrite: true }); assert.match(state.job?.error ?? "", /同名文件或目录/);
  assert.equal(readFileSync(join(f.project, ".pi/skills/original/unrelated.txt"), "utf8"), "keep");
});
