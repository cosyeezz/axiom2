import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Store } from "../src/server/storage.js";
import { Capabilities } from "../src/server/capabilities.js";
import { Resources } from "../src/server/resources.js";
import { skillId } from "../src/server/capability-resources.js";
import type { ResourceDetail, ResourceState } from "../src/shared/resources.js";
import type { OpenCliExecute } from "../src/server/integrations/opencli.js";
function file(path: string, content: string) { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, content); }
function skill(path: string, content = "guide") { file(join(path, "SKILL.md"), `---\nname: fixture-owned-skill\ndescription: isolated test resource\n---\n${content}`); file(join(path, "scripts/run.js"), "// attached script"); }
async function fixture(t: TestContext, execute?: OpenCliExecute, idle = async () => {}) {
  const root = mkdtempSync(join(tmpdir(), "axiom-resources-")), pi = join(root, "shared-pi");
  const old = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = pi;
  const store = new Store(root); new Capabilities(store, () => {}, pi);
  const resources = new Resources(store, pi, () => {}, idle, execute);
  t.after(async () => { await resources.close(); store.close(); if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old; rmSync(root, { recursive: true, force: true }); });
  const act = async (op: string, params: Record<string, unknown>) => {
    const state = await resources.refresh();
    await resources.command({ op, requestId: randomUUID(), params: { revision: state.revision, ...params } });
    for (let i = 0; resources.busy && i < 1000; i++) await delay(10);
    assert.equal(resources.busy, false, "resource job should finish");
    return resources.snapshot();
  };
  return { root, pi, store, resources, act };
}
test("skill import copies attachments, update replaces old tree, uninstall removes owned dependencies and references", async t => {
  const f = await fixture(t), source = join(f.root, "source"); skill(source);
  let state = await f.act("resources.install", { kind: "skill", source }); assert.equal(state.job?.error, undefined);
  const item = state.items.find(i => i.managed && i.kind === "skill")!; assert.ok(item);
  let settings = JSON.parse(readFileSync(join(f.root, "pi/settings.json"), "utf8"));
  const oldPath = settings.skills[0]; assert.ok(existsSync(join(oldPath, "scripts/run.js")));
  file(join(source, "SKILL.md"), "---\nname: fixture-owned-skill\ndescription: updated guide\n---\nupdated");
  state = await f.act("resources.update", { id: item.id }); assert.equal(state.job?.error, undefined);
  assert.equal(existsSync(oldPath), false); settings = JSON.parse(readFileSync(join(f.root, "pi/settings.json"), "utf8"));
  const newPath = settings.skills[0]; assert.match(readFileSync(join(newPath, "SKILL.md"), "utf8"), /updated/);
  const ownedSkillId = skillId(join(newPath, "SKILL.md"));
  f.store.db.prepare("INSERT OR REPLACE INTO capability_preferences(id,revision,body) VALUES(1,1,?)").run(JSON.stringify({ skills: { [ownedSkillId]: true, keep: true }, mcp: {} }));
  state = await f.act("resources.remove", { id: item.id, confirm: true }); assert.equal(state.job?.error, undefined);
  const preferences = JSON.parse(String(f.store.db.prepare("SELECT body FROM capability_preferences WHERE id=1").get()!.body));
  assert.equal(preferences.skills[ownedSkillId], undefined); assert.equal(preferences.skills.keep, true);
  assert.equal(existsSync(newPath), false); assert.ok(existsSync(join(source, "SKILL.md")), "import source is not owned");
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, "pi/settings.json"), "utf8")).skills, []);
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, "resources/installed.json"), "utf8")).items, []);
});
test("MCP removal clears config, namespaced and legacy OAuth while retaining unrelated credentials", async t => {
  const f = await fixture(t); const url = "https://fixture.invalid/mcp";
  file(join(f.pi, "mcp.json"), JSON.stringify({ autoEnableCodemode: false, mcpServers: { fixture: { url }, other: { command: "never-launch" } } }));
  file(join(f.pi, "mcp-auth.json"), JSON.stringify({ [`mcp__fixture|${url}`]: { tokens: { access_token: "secret" } }, [url]: { tokens: { access_token: "legacy" } }, keep: { tokens: { access_token: "other" } } }));
  const state = await f.act("resources.remove", { id: "mcp:fixture", confirm: true }); assert.equal(state.job?.error, undefined);
  assert.deepEqual(JSON.parse(readFileSync(join(f.pi, "mcp.json"), "utf8")), { autoEnableCodemode: false, mcpServers: { other: { command: "never-launch" } } });
  assert.deepEqual(JSON.parse(readFileSync(join(f.pi, "mcp-auth.json"), "utf8")), { keep: { tokens: { access_token: "other" } } });
  assert.ok(!JSON.stringify(state).includes("secret"));
});
test("MCP removal preserves legacy credentials shared by another named server", async t => {
  const f = await fixture(t), url = "https://shared.fixture.invalid/mcp";
  file(join(f.pi, "mcp.json"), JSON.stringify({ mcpServers: { a: { url }, b: { url } } }));
  file(join(f.pi, "mcp-auth.json"), JSON.stringify({ [`mcp__a|${url}`]: {}, [url]: { shared: true }, [`mcp__b|${url}`]: { other: true } }));
  const state = await f.act("resources.remove", { id: "mcp:a", confirm: true }); assert.equal(state.job?.error, undefined);
  const data = JSON.parse(readFileSync(join(f.pi, "mcp-auth.json"), "utf8"));
  assert.equal(data[`mcp__a|${url}`], undefined); assert.deepEqual(data[url], { shared: true }); assert.deepEqual(data[`mcp__b|${url}`], { other: true });
});
test("removal rejects stale confirmation and busy admission without deleting files", async t => {
  let busy = false; const f = await fixture(t, undefined, async () => { if (busy) throw Error("busy"); });
  file(join(f.pi, "mcp.json"), JSON.stringify({ mcpServers: { a: { command: "one" } } }));
  const state = await f.resources.refresh();
  file(join(f.pi, "mcp.json"), JSON.stringify({ mcpServers: { a: { command: "two" } } }));
  await assert.rejects(f.resources.command({ op: "resources.remove", requestId: randomUUID(), params: { id: "mcp:a", confirm: true, revision: state.revision } }), { code: "REVISION_CONFLICT" });
  busy = true; const result = await f.act("resources.remove", { id: "mcp:a", confirm: true }); assert.ok(result.job?.error);
  assert.equal(JSON.parse(readFileSync(join(f.pi, "mcp.json"), "utf8")).mcpServers.a.command, "two");
});
test("managed npm MCP installs in isolated prefix and removes the entire prefix including cache", async t => {
  let installed = "";
  const execute: OpenCliExecute = async args => {
    assert.ok(args.includes("--ignore-scripts")); installed = args[args.indexOf("--prefix") + 1];
    file(join(installed, "node_modules/fixture-mcp/package.json"), JSON.stringify({ name: "fixture-mcp", version: "1.0.0", bin: "index.js" }));
    file(join(installed, "node_modules/fixture-mcp/index.js"), "// fixture"); file(join(installed, "cache/fixture"), "cache"); return "";
  };
  const f = await fixture(t, execute);
  let state = await f.act("resources.install", { kind: "mcp", name: "fixture", source: "fixture-mcp", config: JSON.stringify({ command: "placeholder", args: ["--fixture"], env: { FIXTURE: "true" } }) }); assert.equal(state.job?.error, undefined);
  assert.ok(existsSync(installed)); const config = JSON.parse(readFileSync(join(f.pi, "mcp.json"), "utf8"));
  assert.equal(config.mcpServers.fixture.command, process.execPath); assert.ok(config.mcpServers.fixture.args[0].startsWith(installed));
  assert.deepEqual(config.mcpServers.fixture.args.slice(1), ["--fixture"]);
  state = await f.act("resources.update", { id: "mcp:fixture" }); assert.equal(state.job?.error, undefined);
  assert.deepEqual(JSON.parse(readFileSync(join(f.pi, "mcp.json"), "utf8")).mcpServers.fixture.args.slice(1), ["--fixture"]);
  state = await f.act("resources.remove", { id: "mcp:fixture", confirm: true }); assert.equal(state.job?.error, undefined);
  assert.equal(existsSync(installed), false); assert.deepEqual(JSON.parse(readFileSync(join(f.root, "resources/installed.json"), "utf8")).items, []);
});
test("invalid install and symlink imports leave no published resource or leaked secret", async t => {
  const f = await fixture(t); const source = join(f.root, "source"); skill(source); symlinkSync(join(source, "SKILL.md"), join(source, "linked.md"));
  let state = await f.act("resources.install", { kind: "skill", source }); assert.ok(state.job?.error);
  assert.equal(state.items.some(i => i.managed && i.kind === "skill"), false);
  state = await f.act("resources.install", { kind: "mcp", name: "invalid", config: JSON.stringify({ url: "secret-invalid-url" }) });
  assert.ok(state.job?.error); assert.ok(!JSON.stringify(state).includes("secret-invalid-url")); assert.equal(existsSync(join(f.pi, "mcp.json")), false);
});
test("linked parent cannot authorize deletion of external package contents", async t => {
  const f = await fixture(t), external = join(f.root, "external/node_modules/fixture-package"), nested = join(external, "skills/nested"); skill(nested);
  mkdirSync(join(f.pi, "skills"), { recursive: true }); symlinkSync(external, join(f.pi, "skills/package-link"), process.platform === "win32" ? "junction" : "dir");
  const state = await f.resources.refresh(), item = state.items.find(row => row.source.includes("package-link") && row.kind === "skill")!;
  assert.ok(item); assert.equal(item.removable, false);
  await assert.rejects(f.resources.command({ op: "resources.remove", requestId: randomUUID(), params: { revision: state.revision, id: item.id, confirm: true } }), { code: "INVALID_INPUT" });
  assert.ok(existsSync(join(nested, "SKILL.md"))); assert.ok(existsSync(join(nested, "scripts/run.js")));
});
test("a symlinked SKILL.md owns only the link, preserving its siblings and target", async t => {
  const f = await fixture(t), source = join(f.root, "original"), linked = join(f.pi, "skills/linked"); skill(source);
  file(join(linked, "keep.txt"), "keep"); symlinkSync(join(source, "SKILL.md"), join(linked, "SKILL.md"));
  const item = (await f.resources.refresh()).items.find(row => row.source === join(linked, "SKILL.md"))!; assert.ok(item); assert.equal(item.removable, true);
  const result = await f.act("resources.remove", { id: item.id, confirm: true }); assert.equal(result.job?.error, undefined);
  assert.equal(existsSync(join(linked, "SKILL.md")), false); assert.ok(existsSync(join(linked, "keep.txt"))); assert.ok(existsSync(join(source, "SKILL.md")));
});
test("failed job admission performs no deletion; failed final persistence settles without rejection", async t => {
  let failFinal = false, jobPath = "";
  const f = await fixture(t, undefined, async () => { if (failFinal) { rmSync(jobPath, { force: true }); mkdirSync(jobPath); } });
  jobPath = join(f.root, "resources/job.json"); mkdirSync(jobPath, { recursive: true });
  const configPath = join(f.pi, "mcp.json"); file(configPath, JSON.stringify({ mcpServers: { fixture: { command: "unused" } } }));
  let state = await f.resources.refresh();
  await assert.rejects(f.resources.command({ op: "resources.remove", requestId: randomUUID(), params: { id: "mcp:fixture", revision: state.revision, confirm: true } }), { code: "RESOURCE_STATE_FAILED" });
  await delay(10); assert.equal(f.resources.busy, false); assert.ok(JSON.parse(readFileSync(configPath, "utf8")).mcpServers.fixture);
  rmSync(jobPath, { recursive: true }); failFinal = true;
  state = await f.act("resources.remove", { id: "mcp:fixture", confirm: true }); assert.match(state.job?.error ?? "", /结果未能保存/);
  assert.equal(JSON.parse(readFileSync(configPath, "utf8")).mcpServers.fixture, undefined);
  await f.resources.close();
});
function project(f: { root: string; store: Store }, name: string) {
  const path = join(f.root, name); mkdirSync(path, { recursive: true });
  f.store.db.prepare("INSERT INTO workspaces(id,path,pathKey,name,authorized) VALUES(?,?,?,?,1)").run(name, path, path, name);
  return path;
}
async function detail(resources: Resources, id: string) { return await resources.command({ op: "resources.detail", requestId: randomUUID(), params: { id } }) as ResourceDetail; }
test("same-name global and project MCP are independent; masked edits retain credentials and shared OAuth", async t => {
  const f = await fixture(t), a = project(f, "project-a"), b = project(f, "project-b"), url = "https://fixture.invalid/mcp";
  for (const path of [join(f.pi, "mcp.json"), join(a, ".pi/mcp.json"), join(b, ".pi/mcp.json")]) file(path, JSON.stringify({ mcpServers: { same: { url, headers: { Authorization: "scope-secret" } } } }));
  file(join(f.pi, "mcp-auth.json"), JSON.stringify({ [`mcp__same|${url}`]: { keep: true }, [url]: { keep: true } }));
  let state = await f.resources.refresh(); const items = state.items.filter(i => i.name === "same"); assert.equal(items.length, 3); assert.equal(new Set(items.map(i => i.id)).size, 3);
  const target = items.find(i => i.scopeId === "project-a")!, loaded = await detail(f.resources, target.id);
  assert.ok(loaded.config?.includes(url)); assert.ok(!JSON.stringify(loaded).includes("scope-secret"));
  const config = JSON.parse(loaded.config!); config.enabled = false;
  state = await f.act("resources.save", { id: target.id, config: JSON.stringify(config) }); assert.equal(state.job?.error, undefined);
  const updated = JSON.parse(readFileSync(join(a, ".pi/mcp.json"), "utf8")).mcpServers.same;
  assert.equal(updated.enabled, false); assert.equal(updated.headers.Authorization, "scope-secret");
  assert.equal(JSON.parse(readFileSync(join(f.pi, "mcp.json"), "utf8")).mcpServers.same.enabled, undefined);
  state = await f.act("resources.remove", { id: target.id, confirm: true }); assert.equal(state.job?.error, undefined);
  assert.equal(state.items.filter(i => i.name === "same").length, 2); assert.equal(JSON.parse(readFileSync(join(a, ".pi/mcp.json"), "utf8")).mcpServers.same, undefined);
  assert.ok(JSON.parse(readFileSync(join(b, ".pi/mcp.json"), "utf8")).mcpServers.same);
  assert.ok(JSON.parse(readFileSync(join(f.pi, "mcp-auth.json"), "utf8"))[`mcp__same|${url}`]);
});
test("project skill install, content save and removal only change its project; stale content cannot overwrite", async t => {
  const f = await fixture(t), a = project(f, "project-a"), source = join(f.root, "source"); skill(source);
  let state = await f.act("resources.install", { kind: "skill", scopeId: "project-a", source }); assert.equal(state.job?.error, undefined);
  const target = state.items.find(i => i.managed && i.kind === "skill")!; assert.equal(target.scopeId, "project-a");
  const loaded = await detail(f.resources, target.id), doc = loaded.documents[0]; assert.ok(doc.editable); assert.match(doc.content, /guide/);
  assert.equal(existsSync(join(f.root, "pi/settings.json")), false); assert.ok(JSON.parse(readFileSync(join(a, ".pi/settings.json"), "utf8")).skills.length);
  state = await f.act("resources.save", { id: target.id, path: doc.path, content: doc.content.replace("guide", "edited guide") }); assert.equal(state.job?.error, undefined);
  assert.match(readFileSync(doc.path, "utf8"), /edited guide/); assert.equal(readFileSync(join(source, "scripts/run.js"), "utf8"), "// attached script");
  await assert.rejects(f.resources.command({ op: "resources.save", requestId: randomUUID(), params: { id: target.id, revision: loaded.revision, path: doc.path, content: doc.content } }), { code: "REVISION_CONFLICT" });
  state = await f.act("resources.remove", { id: target.id, confirm: true }); assert.equal(state.job?.error, undefined);
  assert.deepEqual(JSON.parse(readFileSync(join(a, ".pi/settings.json"), "utf8")).skills, []); assert.ok(existsSync(source));
});
test("skill scope follows declarations; removing a shared project reference preserves other scopes and files", async t => {
  const f = await fixture(t), a = project(f, "project-a"), b = project(f, "project-b"), shared = join(f.root, "team-guide"); skill(shared);
  file(join(a, ".pi/settings.json"), JSON.stringify({ skills: [shared] })); file(join(b, ".pi/settings.json"), JSON.stringify({ skills: [shared] }));
  let state = await f.resources.refresh(); const items = state.items.filter(i => i.name === "fixture-owned-skill");
  assert.deepEqual(items.map(i => i.scopeId).sort(), ["project-a", "project-b"]);
  const target = items.find(i => i.scopeId === "project-a")!; assert.equal((await detail(f.resources, target.id)).documents[0].editable, false);
  state = await f.act("resources.remove", { id: target.id, confirm: true }); assert.equal(state.job?.error, undefined);
  assert.ok(existsSync(join(shared, "SKILL.md"))); assert.equal(state.items.some(i => i.scopeId === "project-a" && i.name === target.name), false); assert.ok(state.items.some(i => i.scopeId === "project-b" && i.name === target.name));
  // A global declaration remains global even when its source lives in a project.
  file(join(f.root, "pi/settings.json"), JSON.stringify({ skills: [shared] }));
  state = await f.resources.refresh(); assert.ok(state.items.some(i => i.scopeId === "global" && i.name === target.name));
});
test("config-only save never reinstalls managed npm; project install cannot silently become global", async t => {
  let calls = 0;
  const f = await fixture(t, async args => { calls++; const path = args[args.indexOf("--prefix") + 1]; file(join(path, "node_modules/fixture-mcp/package.json"), JSON.stringify({ name: "fixture-mcp", version: "1.0.0", bin: "index.js" })); file(join(path, "node_modules/fixture-mcp/index.js"), "// fixture"); return ""; });
  const a = project(f, "project-a"); let state = await f.act("resources.install", { kind: "mcp", scopeId: "project-a", name: "npm", source: "fixture-mcp", config: JSON.stringify({ command: "placeholder", args: ["--token", "secret-value"], env: { KEY: "env-secret" } }) }); assert.equal(state.job?.error, undefined);
  const target = state.items.find(i => i.name === "npm")!, loaded = await detail(f.resources, target.id); assert.equal(target.scopeId, "project-a"); assert.equal(existsSync(join(f.pi, "mcp.json")), false);
  assert.ok(!JSON.stringify(loaded).includes("secret-value")); assert.ok(!JSON.stringify(loaded).includes("env-secret"));
  const config = JSON.parse(loaded.config!); config.enabled = false;
  state = await f.act("resources.save", { id: target.id, config: JSON.stringify(config) }); assert.equal(state.job?.error, undefined); assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(readFileSync(join(a, ".pi/mcp.json"), "utf8")).mcpServers.npm.args.slice(1), ["--token", "secret-value"]);
  await assert.rejects(f.act("resources.install", { kind: "mcp", scopeId: "missing", name: "bad", config: '{"command":"never-run"}' }), { code: "RESOURCE_SCOPE_MISSING" });
});
test("managed skill referenced by another scope is protected until that reference is removed", async t => {
  const f = await fixture(t), a = project(f, "project-a"), b = project(f, "project-b"), source = join(f.root, "source"); skill(source);
  let state = await f.act("resources.install", { kind: "skill", scopeId: "project-a", source }); assert.equal(state.job?.error, undefined);
  const owner = state.items.find(i => i.managed && i.kind === "skill")!;
  const loaded = await detail(f.resources, owner.id), doc = loaded.documents[0];
  file(join(b, ".pi/settings.json"), JSON.stringify({ skills: [dirname(doc.path)] }));
  state = await f.resources.refresh(); const reference = state.items.find(i => i.scopeId === "project-b" && i.name === owner.name)!; assert.ok(reference);
  assert.equal(state.items.find(i => i.id === owner.id)!.removable, false);
  assert.equal((await detail(f.resources, owner.id)).documents[0].editable, false);
  for (const op of ["resources.save", "resources.update", "resources.remove"]) await assert.rejects(f.act(op, { id: owner.id, confirm: true, path: doc.path, content: doc.content + "\nchanged", source }), { code: "RESOURCE_SHARED" });
  assert.equal(readFileSync(doc.path, "utf8"), doc.content);
  state = await f.act("resources.remove", { id: reference.id, confirm: true }); assert.equal(state.job?.error, undefined); assert.ok(existsSync(doc.path));
  assert.ok(state.items.find(i => i.id === owner.id)!.removable); assert.ok((await detail(f.resources, owner.id)).documents[0].editable);
  state = await f.act("resources.remove", { id: owner.id, confirm: true }); assert.equal(state.job?.error, undefined); assert.equal(existsSync(doc.path), false);
  assert.deepEqual(JSON.parse(readFileSync(join(a, ".pi/settings.json"), "utf8")).skills, []);
});
test("project MCP partial overrides preserve inheritance and reject unsupported fields", async t => {
  const f = await fixture(t), a = project(f, "project-a");
  file(join(f.pi, "mcp.json"), JSON.stringify({ mcpServers: { same: { command: "never-run", args: ["secret-param"] } } }));
  file(join(a, ".pi/mcp.json"), JSON.stringify({ mcpServers: { same: { enabled: false } } }));
  let state = await f.resources.refresh(); const target = state.items.find(i => i.name === "same" && i.scopeId === "project-a")!;
  assert.deepEqual(JSON.parse((await detail(f.resources, target.id)).config!), { enabled: false });
  state = await f.act("resources.save", { id: target.id, config: '{"enabled":true}' }); assert.equal(state.job?.error, undefined);
  assert.deepEqual(JSON.parse(readFileSync(join(a, ".pi/mcp.json"), "utf8")).mcpServers.same, { enabled: true });
  assert.equal(JSON.parse(readFileSync(join(f.pi, "mcp.json"), "utf8")).mcpServers.same.command, "never-run");
  state = await f.act("resources.save", { id: target.id, config: '{"enabled":false,"env":{"KEY":"not-allowed"}}' }); assert.ok(state.job?.error);
  assert.deepEqual(JSON.parse(readFileSync(join(a, ".pi/mcp.json"), "utf8")).mcpServers.same, { enabled: true });
});
