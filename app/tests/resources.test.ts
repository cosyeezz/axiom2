import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { setTimeout as delay } from "node:timers/promises";
import { Store } from "../src/server/storage.js";
import { Capabilities } from "../src/server/capabilities.js";
import { Resources } from "../src/server/resources.js";
import { skillId, discoverCapabilities } from "../src/server/capability-resources.js";
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
  const item = state.items.find(i => i.managed && i.kind === "skill")!; assert.ok(item); assert.equal(item.name, "source");
  assert.equal(parseFrontmatter(readFileSync(join(source, "SKILL.md"), "utf8")).frontmatter.name, "fixture-owned-skill");
  let settings = JSON.parse(readFileSync(join(f.root, "pi/settings.json"), "utf8"));
  const oldPath = settings.skills[0]; assert.ok(existsSync(join(oldPath, "scripts/run.js"))); assert.equal(basename(oldPath), "source");
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
test("single Markdown import creates its own named SKILL directory, preserving body, metadata and source", async t => {
  const f = await fixture(t), a = project(f, "project-a"), source = join(f.root, "standalone-guide.md");
  const content = '\uFEFF---\r\nname: original\r\ndescription: a standalone guide\r\ndisable-model-invocation: true\r\nmetadata:\r\n  labels: [one, two]\r\n---\r\n\r\n# Body\r\n  Keep indentation\r\n\r\n';
  file(source, content); file(join(f.root, "unrelated.txt"), "must not be copied");
  const state = await f.act("resources.install", { kind: "skill", scopeId: "project-a", source });
  assert.equal(state.job?.error, undefined);
  const item = state.items.find(i => i.managed)!; assert.equal(item.name, "standalone-guide");
  const doc = (await detail(f.resources, item.id)).documents[0];
  assert.equal(basename(doc.path), "SKILL.md"); assert.equal(basename(dirname(doc.path)), "standalone-guide");
  assert.equal(existsSync(join(dirname(doc.path), "unrelated.txt")), false);
  const copied = readFileSync(doc.path, "utf8"), before = parseFrontmatter(content), after = parseFrontmatter(copied);
  assert.deepEqual(after.frontmatter, { ...before.frontmatter, name: "standalone-guide" });
  assert.ok(copied.startsWith('\uFEFF---\r\n')); assert.ok(copied.endsWith('\r\n\r\n# Body\r\n  Keep indentation\r\n\r\n'));
  assert.equal(readFileSync(source, "utf8"), content);
  assert.deepEqual(JSON.parse(readFileSync(join(a, ".pi/settings.json"), "utf8")).skills, [dirname(doc.path)]);
  assert.equal(existsSync(join(f.root, "pi/settings.json")), false);
});
test("custom import names survive updates and same-scope collisions leave both sources untouched", async t => {
  const f = await fixture(t), source = join(f.root, "original-folder"), next = join(f.root, "next.md"); skill(source);
  let state = await f.act("resources.install", { kind: "skill", source, name: "renamed-skill" }); assert.equal(state.job?.error, undefined);
  const item = state.items.find(i => i.managed)!; assert.equal(item.name, "renamed-skill");
  file(next, "---\nname: upstream-name\ndescription: updated\n---\nNew body\n");
  state = await f.act("resources.update", { id: item.id, source: next }); assert.equal(state.job?.error, undefined);
  assert.equal(state.items.find(i => i.id === item.id)?.name, "renamed-skill");
  const doc = (await detail(f.resources, item.id)).documents[0]; assert.equal(basename(dirname(doc.path)), "renamed-skill"); assert.match(doc.content, /New body/);
  const settingsPath = join(f.root, "pi/settings.json"), recordsPath = join(f.root, "resources/installed.json");
  const before = [settingsPath, recordsPath].map(path => readFileSync(path, "utf8"));
  state = await f.act("resources.install", { kind: "skill", source, name: "renamed-skill" }); assert.match(state.job?.error ?? "", /同名技能/);
  assert.deepEqual([settingsPath, recordsPath].map(path => readFileSync(path, "utf8")), before);
  assert.equal(readFileSync(doc.path, "utf8"), doc.content); assert.ok(existsSync(join(source, "scripts/run.js"))); assert.match(readFileSync(next, "utf8"), /upstream-name/);
});
test("unsafe names and invalid single-file imports never publish installation paths", async t => {
  const f = await fixture(t), source = join(f.root, "valid.md"); file(source, "---\nname: original\ndescription: valid\n---\nBody");
  for (const name of ["../escape", "..", "CON", "lpt1.txt", "has space", "trailing.", "a/b", "a\\b", "x".repeat(201)]) {
    const state = await f.act("resources.install", { kind: "skill", source, name }); assert.ok(state.job?.error, name);
    assert.equal(state.items.some(i => i.managed), false); assert.equal(existsSync(join(f.root, "pi/settings.json")), false);
  }
  for (const [name, content] of [["missing.md", "# no frontmatter"], ["duplicate.md", "---\nname: a\nname: b\ndescription: valid\n---\nbody"], ["alias.md", "---\nname: &name old\ndescription: valid\nmetadata:\n  label: *name\n---\nbody"], ["not-markdown.txt", "---\nname: a\ndescription: valid\n---\nbody"]]) {
    const path = join(f.root, name); file(path, content);
    const state = await f.act("resources.install", { kind: "skill", source: path }); assert.ok(state.job?.error, name); assert.equal(existsSync(join(f.root, "pi/settings.json")), false);
    assert.equal(readFileSync(path, "utf8"), content);
  }
  const linked = join(f.root, "linked.md"); symlinkSync(source, linked);
  assert.ok((await f.act("resources.install", { kind: "skill", source: linked })).job?.error);
  const valid = await f.act("resources.install", { kind: "skill", source, name: "中文技能" }); assert.equal(valid.job?.error, undefined); assert.equal(valid.items.find(i => i.managed)?.name, "中文技能");
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
test("managed skills move both ways without reinstalling, losing attachments or changing preferences", async t => {
  const f = await fixture(t), a = project(f, "project-a"), b = project(f, "project-b"), source = join(f.root, "source"); skill(source);
  let state = await f.act("resources.install", { kind: "skill", source });
  const item = state.items.find(i => i.managed && i.kind === "skill")!, doc = (await detail(f.resources, item.id)).documents[0];
  const key = skillId(doc.path);
  f.store.db.prepare("INSERT OR REPLACE INTO capability_preferences(id,revision,body) VALUES(1,1,?)").run(JSON.stringify({ skills: { [key]: false }, mcp: {} }));
  for (const scopeId of ["project-a", "global"]) {
    state = await f.act("resources.move", { id: item.id, destinationScopeId: scopeId });
    assert.equal(state.job?.error, undefined); assert.equal(state.job?.resourceId, item.id);
    assert.equal(state.items.find(i => i.id === item.id)?.scopeId, scopeId);
    assert.equal((await detail(f.resources, item.id)).documents[0].path, doc.path);
    assert.equal(readFileSync(join(dirname(doc.path), "scripts/run.js"), "utf8"), "// attached script");
    assert.equal((await discoverCapabilities(f.root, a, f.pi)).skills.some(s => s.name === item.name), true);
    assert.equal((await discoverCapabilities(f.root, b, f.pi)).skills.some(s => s.name === item.name), scopeId === "global");
    assert.equal(JSON.parse(String(f.store.db.prepare("SELECT body FROM capability_preferences WHERE id=1").get()!.body)).skills[key], false);
  }
  assert.deepEqual(JSON.parse(readFileSync(join(a, ".pi/settings.json"), "utf8")).skills, []);
  assert.ok(existsSync(join(source, "SKILL.md")));
});
test("local skill directory moves both ways with relative references and default selection", async t => {
  const f = await fixture(t), a = project(f, "project-a"), b = project(f, "project-b"), original = join(a, ".pi/skills/local"); skill(original);
  file(join(a, ".pi/settings.json"), JSON.stringify({ skills: ["./skills/local"], keep: "project" }));
  file(join(f.root, "pi/settings.json"), JSON.stringify({ skills: [], keep: "global" }));
  let item = (await f.resources.refresh()).items.find(i => i.scopeId === "project-a" && i.kind === "skill")!;
  f.store.db.prepare("INSERT OR REPLACE INTO capability_preferences(id,revision,body) VALUES(1,1,?)").run(JSON.stringify({ skills: { [skillId(join(original, "SKILL.md"))]: false }, mcp: {} }));
  for (const scopeId of ["global", "project-a"]) {
    const before = item.source;
    const state = await f.act("resources.move", { id: item.id, destinationScopeId: scopeId });
    assert.equal(state.job?.error, undefined);
    item = state.items.find(i => i.id === state.job?.resourceId)!; assert.ok(item); assert.equal(item.scopeId, scopeId);
    assert.equal(existsSync(before), false); assert.ok(existsSync(join(dirname(item.source), "scripts/run.js")));
    assert.equal((await discoverCapabilities(f.root, b, f.pi)).skills.some(s => s.name === item.name), scopeId === "global");
    const preferences = JSON.parse(String(f.store.db.prepare("SELECT body FROM capability_preferences WHERE id=1").get()!.body));
    assert.equal(preferences.skills[skillId(item.source)], false); assert.equal(preferences.skills[skillId(before)], undefined);
  }
  assert.ok(existsSync(join(original, "SKILL.md")));
  assert.equal(JSON.parse(readFileSync(join(a, ".pi/settings.json"), "utf8")).keep, "project");
  assert.equal(JSON.parse(readFileSync(join(f.root, "pi/settings.json"), "utf8")).keep, "global");
});
test("move rejects name and path collisions without overwriting either skill", async t => {
  const f = await fixture(t), a = project(f, "project-a"), source = join(f.pi, "skills/source"), other = join(a, ".pi/skills/other"); skill(source); skill(other, "project version");
  const item = (await f.resources.refresh()).items.find(i => i.scopeId === "global" && i.kind === "skill" && i.source === join(source, "SKILL.md")); assert.ok(item);
  let state = await f.act("resources.move", { id: item.id, destinationScopeId: "project-a" });
  assert.match(state.job?.error ?? "", /同名技能/);
  assert.match(readFileSync(join(other, "SKILL.md"), "utf8"), /project version/); assert.ok(existsSync(source));
  rmSync(other, { recursive: true });
  mkdirSync(dirname(other), { recursive: true }); symlinkSync(join(f.root, "missing"), join(a, ".pi/skills/source"));
  state = await f.act("resources.move", { id: item.id, destinationScopeId: "project-a" });
  assert.match(state.job?.error ?? "", /同名文件或目录/); assert.ok(existsSync(join(source, "scripts/run.js")));
});
test("target exclusions roll back local directory and both settings byte for byte", async t => {
  const f = await fixture(t), a = project(f, "project-a"), original = join(f.pi, "skills/local"); skill(original);
  const targetSettings = join(a, ".pi/settings.json"), contents = '{ "skills": ["!**/local/**"], "keep": true }\n';
  file(targetSettings, contents);
  const item = (await f.resources.refresh()).items.find(i => i.kind === "skill" && i.source === join(original, "SKILL.md")); assert.ok(item);
  const state = await f.act("resources.move", { id: item.id, destinationScopeId: "project-a" });
  assert.match(state.job?.error ?? "", /排除规则/);
  assert.equal(readFileSync(targetSettings, "utf8"), contents);
  assert.equal(existsSync(join(f.root, "pi/settings.json")), false);
  assert.ok(existsSync(join(original, "scripts/run.js"))); assert.equal(existsSync(join(a, ".pi/skills/local")), false);
  assert.equal(state.items.find(i => i.id === item.id)?.scopeId, "global");
});
test("managed move rolls back installation records when target cannot load the skill", async t => {
  const f = await fixture(t), a = project(f, "project-a"), source = join(f.root, "source"); skill(source);
  let state = await f.act("resources.install", { kind: "skill", source });
  const item = state.items.find(i => i.managed && i.kind === "skill")!, doc = (await detail(f.resources, item.id)).documents[0];
  const paths = [join(f.root, "resources/installed.json"), join(f.root, "pi/settings.json"), join(a, ".pi/settings.json")];
  file(paths[2], JSON.stringify({ skills: [`-${doc.path}`] }));
  const before = paths.map(path => readFileSync(path, "utf8"));
  state = await f.act("resources.move", { id: item.id, destinationScopeId: "project-a" });
  assert.match(state.job?.error ?? "", /排除规则/);
  assert.deepEqual(paths.map(path => readFileSync(path, "utf8")), before);
  assert.equal(state.items.find(i => i.id === item.id)?.scopeId, "global");
  assert.ok(existsSync(doc.path));
});
test("managed move cannot leave a parent-directory declaration active in its original scope", async t => {
  const f = await fixture(t); project(f, "project-a"); const source = join(f.root, "source"); skill(source);
  let state = await f.act("resources.install", { kind: "skill", source });
  const item = state.items.find(i => i.managed && i.kind === "skill")!, loaded = await detail(f.resources, item.id);
  const path = join(f.root, "pi/settings.json"), config = JSON.parse(readFileSync(path, "utf8"));
  config.skills.push(loaded.location); file(path, JSON.stringify(config));
  state = await f.act("resources.move", { id: item.id, destinationScopeId: "project-a" });
  assert.match(state.job?.error ?? "", /原范围仍/);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), config);
  assert.equal(state.items.find(i => i.id === item.id)?.scopeId, "global");
  assert.ok(existsSync(loaded.documents[0].path));
});
test("skill collection roots cannot be moved as a single skill", async t => {
  const f = await fixture(t), a = project(f, "project-a"), root = join(a, ".pi/skills"); skill(root);
  const state = await f.resources.refresh(), item = state.items.find(i => i.source === join(root, "SKILL.md"))!;
  assert.ok(item); assert.equal(item.movable, false);
  await assert.rejects(f.act("resources.move", { id: item.id, destinationScopeId: "global" }), { code: "INVALID_INPUT" });
  assert.ok(existsSync(join(root, "SKILL.md")));
});
test("move validates scope, stale revision and shared or linked ownership", async t => {
  const f = await fixture(t), a = project(f, "project-a"), source = join(f.root, "source"); skill(source);
  let state = await f.act("resources.install", { kind: "skill", source });
  const item = state.items.find(i => i.managed && i.kind === "skill")!, doc = (await detail(f.resources, item.id)).documents[0];
  await assert.rejects(f.act("resources.move", { id: item.id, destinationScopeId: "missing" }), { code: "RESOURCE_SCOPE_MISSING" });
  await assert.rejects(f.act("resources.move", { id: item.id, destinationScopeId: "global" }), { code: "INVALID_INPUT" });
  state = await f.resources.refresh(); file(join(a, ".pi/settings.json"), JSON.stringify({ skills: [dirname(doc.path)] }));
  await assert.rejects(f.resources.command({ op: "resources.move", requestId: randomUUID(), params: { id: item.id, destinationScopeId: "project-a", revision: state.revision } }), { code: "REVISION_CONFLICT" });
  await assert.rejects(f.act("resources.move", { id: item.id, destinationScopeId: "project-a" }), { code: "RESOURCE_SHARED" });
  file(join(source, "SKILL.md"), "---\nname: linked-fixture\ndescription: linked resource\n---\nguide");
  mkdirSync(join(f.pi, "skills"), { recursive: true }); symlinkSync(source, join(f.pi, "skills/linked"));
  state = await f.resources.refresh(); const linked = state.items.find(i => i.source.includes("skills/linked"))!;
  assert.ok(linked); assert.equal(linked.movable, false);
  await assert.rejects(f.act("resources.move", { id: linked.id, destinationScopeId: "project-a" }), { code: "INVALID_INPUT" });
  assert.ok(existsSync(doc.path)); assert.ok(existsSync(join(source, "SKILL.md")));
});
test("MCP moves both ways with raw credentials, OAuth, preferences and session isolation intact", async t => {
  const f = await fixture(t), a = project(f, "project-a"), b = project(f, "project-b");
  const globalPath = join(f.pi, "mcp.json"), projectPath = join(a, ".pi/mcp.json");
  const raw = { url: "https://move.fixture.invalid/mcp", headers: { Authorization: "move-secret" }, oauth: { clientId: "fixture", clientSecret: "oauth-secret" }, enabled: false, exposure: "deferred", toolExposure: { read: "direct" }, description: "movable" };
  file(globalPath, JSON.stringify({ autoEnableCodemode: false, keep: "global", mcpServers: { moving: raw, other: { command: "never-run" } } }));
  file(projectPath, JSON.stringify({ keep: "project", mcpServers: { local: { command: "never-run" } } }));
  const authPath = join(f.pi, "mcp-auth.json"), auth = JSON.stringify({ [`mcp__moving|${raw.url}`]: { tokens: { access_token: "token-secret" } } }); file(authPath, auth);
  const initial = (await discoverCapabilities(f.root, a, f.pi)).mcp.find(i => i.name === "moving")!;
  f.store.db.prepare("INSERT OR REPLACE INTO capability_preferences(id,revision,body) VALUES(1,1,?)").run(JSON.stringify({ skills: { keep: true }, mcp: { [initial.preferenceKey!]: false, keep: true } }));
  for (const [id, lockedAt] of [["unlocked", null], ["locked", 123]] as const) {
    f.store.db.prepare("INSERT INTO sessions(id,workspaceId,title,updatedAt) VALUES(?,'project-b',?,1)").run(id, id);
    f.store.db.prepare("INSERT INTO session_capabilities(sessionId,selection,catalog,lockedAt) VALUES(?,?,?,?)").run(id, '{"mcp":["moving"]}', "saved-catalog", lockedAt);
  }
  let id = "mcp:moving", previousKey = initial.preferenceKey!;
  for (const scopeId of ["project-a", "global"]) {
    assert.equal((await f.resources.refresh()).items.find(i => i.id === id)?.movable, true);
    const state = await f.act("resources.move", { id, destinationScopeId: scopeId }); assert.equal(state.job?.error, undefined);
    id = state.job!.resourceId!; assert.equal(state.items.find(i => i.id === id)?.scopeId, scopeId);
    const destination = scopeId === "global" ? globalPath : projectPath, source = scopeId === "global" ? projectPath : globalPath;
    assert.deepEqual(JSON.parse(readFileSync(destination, "utf8")).mcpServers.moving, raw);
    assert.equal(JSON.parse(readFileSync(source, "utf8")).mcpServers.moving, undefined);
    const current = (await discoverCapabilities(f.root, a, f.pi)).mcp.find(i => i.name === "moving")!;
    assert.ok(current); assert.equal(current.source, destination);
    assert.equal((await discoverCapabilities(f.root, b, f.pi)).mcp.some(i => i.name === "moving"), scopeId === "global");
    const prefs = JSON.parse(String(f.store.db.prepare("SELECT body FROM capability_preferences WHERE id=1").get()!.body));
    assert.equal(prefs.mcp[current.preferenceKey!], false); assert.equal(prefs.mcp[previousKey], undefined); assert.equal(prefs.mcp.keep, true); assert.equal(prefs.skills.keep, true); previousKey = current.preferenceKey!;
    assert.equal(f.store.db.prepare("SELECT selection FROM session_capabilities WHERE sessionId='unlocked'").get()!.selection, null);
    assert.deepEqual({ ...f.store.db.prepare("SELECT selection,catalog,revision,lockedAt FROM session_capabilities WHERE sessionId='locked'").get() }, { selection: '{"mcp":["moving"]}', catalog: "saved-catalog", revision: 0, lockedAt: 123 });
    assert.equal(readFileSync(authPath, "utf8"), auth);
    const loaded = await detail(f.resources, id); assert.equal(loaded.masked, true);
    assert.ok(!JSON.stringify([state, loaded]).includes("move-secret")); assert.ok(!JSON.stringify([state, loaded]).includes("oauth-secret"));
  }
  assert.equal(id, "mcp:moving");
  assert.deepEqual(JSON.parse(readFileSync(projectPath, "utf8")), { keep: "project", mcpServers: { local: { command: "never-run" } } });
  assert.deepEqual(JSON.parse(readFileSync(globalPath, "utf8")), { autoEnableCodemode: false, keep: "global", mcpServers: { other: { command: "never-run" }, moving: raw } });
});
test("managed MCP moves without reinstalling and remains updatable and removable in its destination", async t => {
  let calls = 0;
  const f = await fixture(t, async args => { calls++; const path = args[args.indexOf("--prefix") + 1]; file(join(path, "node_modules/fixture-mcp/package.json"), JSON.stringify({ name: "fixture-mcp", version: "1.0.0", bin: "index.js" })); file(join(path, "node_modules/fixture-mcp/index.js"), "// fixture"); return ""; });
  const a = project(f, "project-a");
  let state = await f.act("resources.install", { kind: "mcp", name: "managed", scopeId: "project-a", source: "fixture-mcp", config: JSON.stringify({ args: ["--token", "secret-param"], env: { KEY: "env-secret" }, cwd: "./tools" }) }); assert.equal(state.job?.error, undefined);
  const original = JSON.parse(readFileSync(join(a, ".pi/mcp.json"), "utf8")).mcpServers.managed;
  let id = state.items.find(i => i.name === "managed")!.id;
  for (const destinationScopeId of ["global", "project-a"]) {
    state = await f.act("resources.move", { id, destinationScopeId }); assert.equal(state.job?.error, undefined); id = state.job!.resourceId!;
    assert.equal(calls, 1); assert.ok(state.items.find(i => i.id === id)?.managed);
    const record = JSON.parse(readFileSync(join(f.root, "resources/installed.json"), "utf8")).items[0]; assert.equal(record.scopeId, destinationScopeId); assert.ok(existsSync(record.directory));
    const raw = JSON.parse(readFileSync(destinationScopeId === "global" ? join(f.pi, "mcp.json") : join(a, ".pi/mcp.json"), "utf8")).mcpServers.managed;
    assert.deepEqual(raw, original); assert.ok(existsSync(raw.args[0]));
  }
  state = await f.act("resources.update", { id }); assert.equal(state.job?.error, undefined); assert.equal(calls, 2); assert.equal(existsSync(original.args[0]), false);
  const updated = JSON.parse(readFileSync(join(a, ".pi/mcp.json"), "utf8")).mcpServers.managed; assert.deepEqual(updated.args.slice(1), ["--token", "secret-param"]);
  state = await f.act("resources.remove", { id, confirm: true }); assert.equal(state.job?.error, undefined); assert.equal(existsSync(updated.args[0]), false);
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, "resources/installed.json"), "utf8")).items, []);
});
test("MCP moves reject same-name and namespace conflicts without overwriting configurations", async t => {
  const f = await fixture(t), a = project(f, "project-a"), b = project(f, "project-b"), globalPath = join(f.pi, "mcp.json"), projectPath = join(a, ".pi/mcp.json");
  for (const name of ["same-name", "same_name"]) {
    file(globalPath, JSON.stringify({ mcpServers: { "same-name": { command: "global-command" } } }));
    file(projectPath, JSON.stringify({ mcpServers: { [name]: { command: "project-command" } } }));
    const before = [globalPath, projectPath].map(path => readFileSync(path, "utf8"));
    const state = await f.act("resources.move", { id: "mcp:same-name", destinationScopeId: "project-a" }); assert.match(state.job?.error ?? "", /同名 MCP|名称空间/);
    assert.deepEqual([globalPath, projectPath].map(path => readFileSync(path, "utf8")), before);
  }
  // Promoting one project must not make a different project's namespace invalid.
  file(globalPath, '{"mcpServers":{}}'); file(join(b, ".pi/mcp.json"), '{"mcpServers":{"same-name":{"command":"project-b"}}}');
  const item = (await f.resources.refresh()).items.find(i => i.scopeId === "project-a")!;
  const state = await f.act("resources.move", { id: item.id, destinationScopeId: "global" }); assert.match(state.job?.error ?? "", /名称空间/); assert.equal(readFileSync(globalPath, "utf8"), '{"mcpServers":{}}');
});
test("MCP move blocks inherited overrides and global-only auth, and validates malformed connections", async t => {
  const f = await fixture(t), a = project(f, "project-a"); project(f, "project-b");
  const globalPath = join(f.pi, "mcp.json"), projectPath = join(a, ".pi/mcp.json");
  file(globalPath, '{"mcpServers":{"inherited":{"command":"never-run"},"auth":{"url":"https://fixture.invalid/mcp","auth":{"provider":"fixture"}},"invalid":{"command":42}}}');
  file(projectPath, '{"mcpServers":{"inherited":{"enabled":false}}}');
  const before = [globalPath, projectPath].map(path => readFileSync(path, "utf8"));
  const state = await f.resources.refresh();
  for (const item of state.items.filter(i => ["inherited", "auth"].includes(i.name))) {
    assert.equal(item.movable, false); assert.ok(item.moveBlockedReason);
    await assert.rejects(f.act("resources.move", { id: item.id, destinationScopeId: item.scopeId === "global" ? "project-b" : "global" }), { code: "INVALID_INPUT" });
  }
  const failed = await f.act("resources.move", { id: "mcp:invalid", destinationScopeId: "project-a" }); assert.match(failed.job?.error ?? "", /配置无效/);
  assert.deepEqual([globalPath, projectPath].map(path => readFileSync(path, "utf8")), before);
});
test("MCP move validates revisions, authorization and scope boundaries before mutation", async t => {
  const f = await fixture(t), a = project(f, "project-a"); project(f, "project-b");
  file(join(f.pi, "mcp.json"), '{"mcpServers":{"moving":{"command":"never-run"}}}');
  await assert.rejects(f.act("resources.move", { id: "mcp:moving", destinationScopeId: "missing" }), { code: "RESOURCE_SCOPE_MISSING" });
  await assert.rejects(f.act("resources.move", { id: "mcp:moving", destinationScopeId: "global" }), { code: "INVALID_INPUT" });
  f.store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id='project-b'").run();
  await assert.rejects(f.act("resources.move", { id: "mcp:moving", destinationScopeId: "project-b" }), { code: "RESOURCE_SCOPE_MISSING" });
  let state = await f.resources.refresh(); file(join(a, ".pi/mcp.json"), '{"mcpServers":{}}');
  await assert.rejects(f.resources.command({ op: "resources.move", requestId: randomUUID(), params: { id: "mcp:moving", destinationScopeId: "project-a", revision: state.revision } }), { code: "REVISION_CONFLICT" });
  state = await f.act("resources.move", { id: "mcp:moving", destinationScopeId: "project-a" }); assert.equal(state.job?.error, undefined);
  f.store.db.prepare("UPDATE workspaces SET authorized=1 WHERE id='project-b'").run();
  await assert.rejects(f.act("resources.move", { id: state.job!.resourceId, destinationScopeId: "project-b" }), { code: "INVALID_INPUT" });
});
test("MCP move rolls back both configs, managed records and preferences when persistence fails", async t => {
  const f = await fixture(t, async args => { const path = args[args.indexOf("--prefix") + 1]; file(join(path, "node_modules/fixture-mcp/package.json"), JSON.stringify({ name: "fixture-mcp", version: "1.0.0", bin: "index.js" })); file(join(path, "node_modules/fixture-mcp/index.js"), "// fixture"); return ""; });
  const a = project(f, "project-a"), projectPath = join(a, ".pi/mcp.json");
  let state = await f.act("resources.install", { kind: "mcp", name: "rollback", source: "fixture-mcp" }); assert.equal(state.job?.error, undefined);
  const paths = [join(f.pi, "mcp.json"), join(f.root, "resources/installed.json")], before = paths.map(path => readFileSync(path, "utf8"));
  f.store.db.prepare("INSERT OR REPLACE INTO capability_preferences(id,revision,body) VALUES(1,1,?)").run('{"skills":{},"mcp":{"keep":false}}');
  for (const rollback of ["ABORT", "ROLLBACK"]) for (const existing of [false, true]) {
    f.store.db.exec(`DROP TRIGGER IF EXISTS fail_move; CREATE TRIGGER fail_move BEFORE UPDATE ON capability_preferences BEGIN SELECT RAISE(${rollback}, 'fixture persistence failure'); END;`);
    if (existing) file(projectPath, '{ "keep": true, "mcpServers": {} }\n');
    else rmSync(projectPath, { force: true });
    const projectBefore = existsSync(projectPath) ? readFileSync(projectPath, "utf8") : undefined;
    state = await f.act("resources.move", { id: "mcp:rollback", destinationScopeId: "project-a" }); assert.match(state.job?.error ?? "", /已恢复原配置/); assert.equal(state.job?.resourceId, undefined);
    assert.deepEqual(paths.map(path => readFileSync(path, "utf8")), before);
    assert.equal(existsSync(projectPath) ? readFileSync(projectPath, "utf8") : undefined, projectBefore);
    assert.equal(f.store.db.prepare("SELECT revision FROM capability_preferences WHERE id=1").get()!.revision, 1);
    assert.equal(state.items.find(i => i.id === "mcp:rollback")?.scopeId, "global");
    assert.ok(existsSync(JSON.parse(before[0]).mcpServers.rollback.args[0]));
  }
});
test("MCP move rejects configuration files shared through a linked project directory", async t => {
  const f = await fixture(t), a = project(f, "project-a"), b = project(f, "project-b");
  file(join(a, ".pi/mcp.json"), '{"mcpServers":{"shared":{"command":"never-run"}}}');
  symlinkSync(join(a, ".pi"), join(b, ".pi"), process.platform === "win32" ? "junction" : "dir");
  const item = (await f.resources.refresh()).items.find(i => i.scopeId === "project-a")!;
  const state = await f.act("resources.move", { id: item.id, destinationScopeId: "global" }); assert.match(state.job?.error ?? "", /链接共享/);
  assert.equal(existsSync(join(f.pi, "mcp.json")), false); assert.ok(JSON.parse(readFileSync(join(b, ".pi/mcp.json"), "utf8")).mcpServers.shared);
});
test("MCP move rejects hard-linked source and destination configs without changing either scope", async t => {
  const f = await fixture(t), a = project(f, "project-a");
  const sourcePath = join(f.pi, "mcp.json"), destinationPath = join(a, ".pi/mcp.json"), linkedPath = join(f.root, "shared-config.json");
  const source = '{"mcpServers":{"shared":{"command":"never-run"}}}', destination = '{"mcpServers":{},"keep":true}';
  file(sourcePath, source); file(destinationPath, destination);
  for (const path of [sourcePath, destinationPath]) {
    linkSync(path, linkedPath);
    const state = await f.act("resources.move", { id: "mcp:shared", destinationScopeId: "project-a" }); assert.match(state.job?.error ?? "", /链接共享/);
    assert.equal(readFileSync(sourcePath, "utf8"), source); assert.equal(readFileSync(destinationPath, "utf8"), destination);
    assert.equal(readFileSync(linkedPath, "utf8"), path === sourcePath ? source : destination);
    rmSync(linkedPath);
  }
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
