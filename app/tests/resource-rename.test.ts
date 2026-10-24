import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "./temporary.js";
import { Store } from "../src/server/storage.js";
import { Resources } from "../src/server/resources.js";
import { Capabilities } from "../src/server/capabilities.js";
import { skillId } from "../src/server/capability-resources.js";
import type { ResourceDetail } from "../src/shared/resources.js";
function file(path: string, value: string) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); }
function json(path: string) { return JSON.parse(readFileSync(path, "utf8")); }
function skill(path: string, name: string) {
  file(join(path, "SKILL.md"), `---\nname: ${name}\ndescription: fixture description\nmetadata:\n  keep: true\n---\n# Body\nDo not change ${name} in examples.\n`);
  file(join(path, "scripts/run.js"), "// attachment\n");
}
async function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "axiom-resource-rename-")), pi = join(root, "shared"), project = join(root, "project");
  mkdirSync(project); const previous = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = pi;
  const store = new Store(root); new Capabilities(store, () => {}, pi);
  store.db.prepare("INSERT INTO workspaces(id,path,pathKey,name,authorized) VALUES('project',?,?, 'Project',1)").run(project, project);
  const resources = new Resources(store, pi, () => {}, async () => {});
  t.after(async () => { await resources.close(); store.close(); if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; rmSync(root, { recursive: true, force: true }); });
  const act = async (op: string, params: Record<string, unknown>) => {
    const state = await resources.refresh();
    await resources.command({ op, requestId: randomUUID(), params: { revision: state.revision, ...params } });
    for (let i = 0; resources.busy && i < 1000; i++) await delay(10);
    assert.equal(resources.busy, false); return resources.snapshot();
  };
  const detail = (id: string) => resources.command({ op: "resources.detail", requestId: randomUUID(), params: { id } }) as Promise<ResourceDetail>;
  const remember = (kind: "skills" | "mcp", name: string, source: string, key: string) => {
    store.db.prepare("INSERT OR REPLACE INTO capability_preferences(id,revision,body) VALUES(1,1,?)").run(JSON.stringify({ skills: {}, mcp: {}, [kind]: { [key]: false } }));
    store.db.prepare("INSERT INTO sessions(id,workspaceId,title,updatedAt) VALUES('session','project','Session',1)").run();
    store.db.prepare("INSERT INTO session_capabilities(sessionId,selection,catalog,lockedAt) VALUES('session',?,?,1)")
      .run(JSON.stringify({ skills: [], mcp: [], [kind]: [name] }), JSON.stringify({ skills: [], mcp: [], [kind]: [{ id: name, name, source, preferenceKey: key }] }));
  };
  const saved = () => JSON.parse(String(store.db.prepare("SELECT selection FROM session_capabilities WHERE sessionId='session'").get()!.selection));
  return { root, pi, project, store, resources, act, detail, remember, saved };
}
test("managed skill rename moves complete directory, metadata and saved references; deletion removes entire installation", async t => {
  const f = await fixture(t), source = join(f.root, "original"); skill(source, "upstream");
  let state = await f.act("resources.install", { kind: "skill", source, name: "old-name" }); assert.equal(state.job?.error, undefined);
  const item = state.items.find(item => item.name === "old-name")!;
  const before = (await f.detail(item.id)).documents[0], oldDir = dirname(before.path);
  f.remember("skills", item.name, before.path, skillId(before.path));
  state = await f.act("resources.rename", { id: item.id, name: "new-name" }); assert.equal(state.job?.error, undefined);
  const next = (await f.detail(item.id)).documents[0], nextDir = dirname(next.path);
  assert.equal(basename(nextDir), "new-name"); assert.equal(existsSync(oldDir), false);
  assert.match(next.content, /name: new-name/); assert.match(next.content, /keep: true/); assert.match(next.content, /# Body/);
  assert.equal(readFileSync(join(nextDir, "scripts/run.js"), "utf8"), "// attachment\n");
  assert.deepEqual(json(join(f.root, "pi/settings.json")).skills, [nextDir]);
  assert.equal(json(join(f.root, "resources/installed.json")).items[0].name, "new-name");
  assert.deepEqual(f.saved().skills, ["new-name"]);
  const prefs = JSON.parse(String(f.store.db.prepare("SELECT body FROM capability_preferences WHERE id=1").get()!.body));
  assert.equal(prefs.skills[skillId(next.path)], false); assert.equal(prefs.skills[skillId(before.path)], undefined);
  state = await f.act("resources.update", { id: item.id }); assert.equal(state.job?.error, undefined);
  const updated = (await f.detail(item.id)).documents[0]; assert.equal(basename(dirname(updated.path)), "new-name"); assert.match(updated.content, /name: new-name/);
  // Track the current file identity after an independent upstream reinstall.
  f.store.db.prepare("UPDATE session_capabilities SET catalog=? WHERE sessionId='session'").run(JSON.stringify({ skills: [{ id: "new-name", name: "new-name", source: updated.path }], mcp: [] }));
  const installation = json(join(f.root, "resources/installed.json")).items[0].directory;
  state = await f.act("resources.remove", { id: item.id, confirm: true, force: true }); assert.equal(state.job?.error, undefined);
  assert.equal(existsSync(installation), false); assert.deepEqual(json(join(f.root, "pi/settings.json")).skills, []);
  assert.deepEqual(json(join(f.root, "resources/installed.json")).items, []); assert.deepEqual(f.saved().skills, []);
  assert.ok(existsSync(join(source, "SKILL.md")));
});
test("external skill rename rebases explicit include/exclude paths and returns the new list identity", async t => {
  const f = await fixture(t), old = join(f.root, "pi/skills/old"); skill(old, "old");
  file(join(f.root, "pi/settings.json"), JSON.stringify({ skills: [old, `-${join(old, "ignored.md")}`], keep: 12 }));
  const item = (await f.resources.refresh()).items.find(item => item.name === "old")!;
  const result = await f.act("resources.rename", { id: item.id, name: "new" }); assert.equal(result.job?.error, undefined);
  assert.notEqual(result.job?.resourceId, item.id); assert.equal(result.items.find(item => item.id === result.job?.resourceId)?.name, "new");
  assert.deepEqual(json(join(f.root, "pi/settings.json")), { skills: [join(dirname(old), "new"), `-${join(dirname(old), "new/ignored.md")}`], keep: 12 });
  assert.equal(existsSync(old), false);
});
test("MCP rename migrates global key, partial project overrides, OAuth namespace and selections", async t => {
  const f = await fixture(t), path = join(f.pi, "mcp.json"), url = "https://fixture.invalid/mcp";
  file(path, JSON.stringify({ autoEnableCodemode: false, mcpServers: { "old-name": { url, headers: { Authorization: "secret" } }, keep: { command: "unused" } } }));
  file(join(f.project, ".pi/mcp.json"), JSON.stringify({ mcpServers: { "old-name": { enabled: false } } }));
  file(join(f.pi, "mcp-auth.json"), JSON.stringify({ [`mcp__old_name|${url}`]: { token: "secret" }, keep: { token: "other" } }));
  f.remember("mcp", "old-name", path, createHash("sha256").update(JSON.stringify([path, "old-name"])).digest("hex"));
  const result = await f.act("resources.rename", { id: "mcp:old-name", name: "new-name" }); assert.equal(result.job?.error, undefined);
  assert.equal(result.job?.resourceId, "mcp:new-name");
  assert.deepEqual(Object.keys(json(path).mcpServers).sort(), ["keep", "new-name"]); assert.equal(json(path).mcpServers["new-name"].headers.Authorization, "secret");
  assert.deepEqual(json(join(f.project, ".pi/mcp.json")).mcpServers, { "new-name": { enabled: false } });
  assert.deepEqual(json(join(f.pi, "mcp-auth.json")), { [`mcp__new_name|${url}`]: { token: "secret" }, keep: { token: "other" } });
  assert.deepEqual(f.saved().mcp, ["new-name"]); assert.ok(!JSON.stringify(result).includes("secret"));
  const deleted = await f.act("resources.remove", { id: "mcp:new-name", confirm: true, clearCredentials: true }); assert.equal(deleted.job?.error, undefined);
  assert.deepEqual(f.saved().mcp, []); assert.ok(json(path).mcpServers.keep);
});
test("rename refuses invalid names and collisions without changing files, and rolls back credential conflicts", async t => {
  const f = await fixture(t), old = join(f.root, "pi/skills/old"); skill(old, "old"); skill(join(dirname(old), "taken"), "taken");
  const item = (await f.resources.refresh()).items.find(item => item.name === "old")!, before = readFileSync(join(old, "SKILL.md"), "utf8");
  for (const name of ["../outside", "taken"]) {
    const result = await f.act("resources.rename", { id: item.id, name }); assert.ok(result.job?.error);
    assert.equal(readFileSync(join(old, "SKILL.md"), "utf8"), before);
  }
  const path = join(f.pi, "mcp.json"), auth = join(f.pi, "mcp-auth.json"), url = "https://fixture.invalid";
  file(path, JSON.stringify({ mcpServers: { old: { url } } }));
  file(auth, JSON.stringify({ [`mcp__old|${url}`]: { one: true }, [`mcp__new|${url}`]: { two: true } }));
  const bytes = readFileSync(path, "utf8"), credentials = readFileSync(auth, "utf8");
  const result = await f.act("resources.rename", { id: "mcp:old", name: "new" }); assert.match(result.job?.error ?? "", /登录凭据/);
  assert.equal(readFileSync(path, "utf8"), bytes); assert.equal(readFileSync(auth, "utf8"), credentials);
});
for (const operation of ["rename", "remove"] as const) test(`shared managed skill ${operation} from a referencing project updates the owning installation`, async t => {
  const f = await fixture(t), source = join(f.root, "original"), referencing = join(f.root, "referencing"); skill(source, "upstream");
  mkdirSync(referencing);
  f.store.db.prepare("INSERT INTO workspaces(id,path,pathKey,name,authorized) VALUES('referencing',?,?, 'Referencing',1)").run(referencing, referencing);
  let state = await f.act("resources.install", { kind: "skill", scopeId: "project", source, name: "shared" }); assert.equal(state.job?.error, undefined);
  const owner = state.items.find(item => item.name === "shared" && item.scopeId === "project")!;
  const guide = (await f.detail(owner.id)).documents[0].path;
  const installation = json(join(f.root, "resources/installed.json")).items[0].directory;
  const settings = join(referencing, ".pi/settings.json"); file(settings, JSON.stringify({ skills: [dirname(guide)] }));
  const ref = (await f.resources.refresh()).items.find(item => item.name === "shared" && item.scopeId === "referencing")!;
  const physicalFiles = (f.resources as any).physicalFiles.bind(f.resources);
  let locked: string[] | undefined;
  t.mock.method(f.resources as any, "physicalFiles", (target: any) => {
    const paths = physicalFiles(target);
    if (target?.item.id === ref.id) locked = paths;
    return paths;
  });
  state = await f.act(`resources.${operation}`, { id: ref.id, name: "renamed", force: true, confirm: true }); assert.equal(state.job?.error, undefined);
  assert.deepEqual(locked, [installation], "a reference must use the owner root lock, never an SQLite lock inside the installation being removed");
  const records = json(join(f.root, "resources/installed.json")).items;
  assert.equal(state.items.some(item => item.name === "shared"), false);
  if (operation === "rename") {
    assert.equal(records.length, 1); assert.equal(records[0].name, "renamed");
    const next = (await f.detail(owner.id)).documents[0].path;
    assert.equal(basename(dirname(next)), "renamed"); assert.equal(existsSync(guide), false);
    assert.deepEqual(records[0].paths, [dirname(next)]);
    assert.deepEqual(json(settings).skills, [dirname(next)]);
    assert.deepEqual(json(join(f.project, ".pi/settings.json")).skills, [dirname(next)]);
    assert.equal(state.items.filter(item => item.name === "renamed").length, 2);
    assert.equal(state.items.find(item => item.id === state.job?.resourceId)?.scopeId, "referencing");
  } else {
    assert.deepEqual(records, []); assert.equal(existsSync(installation), false);
    assert.deepEqual(json(settings).skills, []); assert.deepEqual(json(join(f.project, ".pi/settings.json")).skills, []);
  }
});
test("skill rename can match its existing directory or Markdown filename", async t => {
  const f = await fixture(t), directory = join(f.root, "pi/skills/folder"), markdown = join(f.root, "pi/skills/loose.md");
  skill(directory, "different"); file(markdown, "---\nname: another\ndescription: fixture\n---\nBody\n");
  for (const [before, after, path] of [["different", "folder", join(directory, "SKILL.md")], ["another", "loose", markdown]]) {
    const item = (await f.resources.refresh()).items.find(item => item.name === before)!;
    const state = await f.act("resources.rename", { id: item.id, name: after }); assert.equal(state.job?.error, undefined);
    assert.equal(state.job?.resourceId, item.id); assert.match(readFileSync(path, "utf8"), new RegExp(`name: ${after}`));
  }
  assert.ok(existsSync(join(directory, "scripts/run.js")));
});
test("MCP rename only migrates OAuth credentials for the changed connection URL", async t => {
  const f = await fixture(t), global = join(f.pi, "mcp.json"), project = join(f.project, ".pi/mcp.json"), auth = join(f.pi, "mcp-auth.json");
  const a = "https://global.invalid/mcp", b = "https://project.invalid/mcp";
  file(global, JSON.stringify({ mcpServers: { old: { url: a } } }));
  file(project, JSON.stringify({ mcpServers: { old: { url: b } } }));
  file(auth, JSON.stringify({ [`mcp__old|${a}`]: { token: "global" }, [`mcp__old|${b}`]: { token: "project" }, [`mcp__renamed|${b}`]: { token: "unrelated" } }));
  const state = await f.act("resources.rename", { id: "mcp:old", name: "renamed" }); assert.equal(state.job?.error, undefined);
  assert.deepEqual(json(project).mcpServers, { old: { url: b } });
  assert.deepEqual(json(auth), { [`mcp__renamed|${a}`]: { token: "global" }, [`mcp__old|${b}`]: { token: "project" }, [`mcp__renamed|${b}`]: { token: "unrelated" } });
});
test("MCP rename permits identical names across scopes but rejects tool namespace aliases", async t => {
  const f = await fixture(t), global = join(f.pi, "mcp.json"), project = join(f.project, ".pi/mcp.json");
  file(global, JSON.stringify({ mcpServers: { old: { command: "unused-global" } } }));
  file(project, JSON.stringify({ mcpServers: { next_name: { command: "unused-project" } } }));
  let state = await f.act("resources.rename", { id: "mcp:old", name: "next-name" }); assert.match(state.job?.error ?? "", /冲突/);
  state = await f.act("resources.rename", { id: "mcp:old", name: "next_name" }); assert.equal(state.job?.error, undefined);
  assert.deepEqual(json(global).mcpServers, { next_name: { command: "unused-global" } });
  assert.deepEqual(json(project).mcpServers, { next_name: { command: "unused-project" } });
});
test("forced shared skill deletion removes source directory and references in every authorized scope", async t => {
  const f = await fixture(t), path = join(f.root, "external-shared"); skill(path, "shared");
  for (const settings of [join(f.root, "pi/settings.json"), join(f.project, ".pi/settings.json")]) file(settings, JSON.stringify({ skills: [path] }));
  const state = await f.resources.refresh(), item = state.items.find(item => item.name === "shared" && item.scopeId === "project")!;
  assert.ok(item?.deletable); assert.match(item.deleteCleanup?.join(" ") ?? "", /永久删除/);
  const result = await f.act("resources.remove", { id: item.id, force: true, confirm: true }); assert.equal(result.job?.error, undefined);
  assert.equal(existsSync(path), false); assert.equal(result.items.some(item => item.name === "shared"), false);
  for (const settings of [join(f.root, "pi/settings.json"), join(f.project, ".pi/settings.json")]) assert.deepEqual(json(settings).skills, []);
});
