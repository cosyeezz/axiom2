import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agents } from "../src/server/agents.js";
import { ModelService } from "../src/server/model-service.js";
import { Store } from "../src/server/storage.js";
import { Capabilities } from "../src/server/capabilities.js";
import { capabilityFileDigest, discoverCapabilities } from "../src/server/capability-resources.js";
import type { CapabilityCatalog, CapabilityState } from "../src/shared/capabilities.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";

test("capabilities: private discovery, revisions, atomic startup lock, persistence and historical compatibility", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-capabilities-")), cwd = join(root, "project");
  mkdirSync(join(root, "pi"), { recursive: true });
  mkdirSync(join(cwd, ".pi", "skills", "selected"), { recursive: true });
  const skill = join(cwd, ".pi", "skills", "selected", "SKILL.md");
  writeFileSync(skill, "---\nname: selected\ndescription: selected fixture\n---\nFixture instructions");
  writeFileSync(join(root, "pi", "mcp.json"), JSON.stringify({ mcpServers: {
    fixture: { command: "does-not-exist-must-not-launch", args: ["secret-argument"], env: { TOKEN: "secret-env" }, exposure: "direct" },
    remote: { url: "https://example.invalid/mcp?token=secret-query", headers: { Authorization: "secret-header" }, enabled: false },
  } }));
  mkdirSync(join(cwd, ".pi", "extensions"));
  writeFileSync(join(cwd, ".pi", "extensions", "do-not-load.ts"), "throw Error('catalog executed extension');");
  let store = new Store(root);
  const events: string[] = [];
  let service = new Capabilities(store, key => events.push(key));
  const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: cwd, authorized: true } }) as Workspace;
  const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope: Scope = { workspaceId: workspace.id, sessionId: session.id };
  const save = (catalog: CapabilityCatalog, skills: string[], mcp: string[], revision = catalog.state.revision) => service.command({
    requestId: randomUUID(), op: "capabilities.save", ...scope, params: { revision, catalogRevision: catalog.revision, skills, mcp },
  }) as Promise<CapabilityState>;
  try {
    const catalog = await service.get(scope);
    assert.equal(catalog.state.locked, false);
    assert.equal(catalog.state.legacy, false);
    const selected = catalog.skills.find(item => item.name === "selected")!;
    assert.ok(selected);
    for (const secret of ["secret-env", "secret-header", "secret-argument", "secret-query", "does-not-exist-must-not-launch"])
      assert.ok(!JSON.stringify(catalog).includes(secret));
    assert.equal(catalog.mcp.find(item => item.name === "remote")?.defaultSelected, false);
    const outcomes = await Promise.allSettled([save(catalog, [selected.id], ["fixture"]), save(catalog, [], [])]);
    assert.equal(outcomes.filter(item => item.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter(item => item.status === "rejected" && item.reason.code === "REVISION_CONFLICT").length, 1);
    const firstPlan = await service.prepare(scope);
    await save(await service.get(scope), [], []);
    assert.throws(() => service.lock(scope, firstPlan), { code: "REVISION_CONFLICT" });
    assert.equal(service.state(scope).locked, false, "preparation does not lock");
    const emptyPlan = await service.prepare(scope);
    assert.deepEqual(emptyPlan.runtime.skillPaths, []);
    assert.deepEqual(emptyPlan.runtime.mcp.servers, []);
    store.db.exec("BEGIN IMMEDIATE");
    service.lock(scope, emptyPlan);
    store.db.exec("ROLLBACK");
    assert.equal(service.state(scope).locked, false, "lock rolls back with failed run insertion");
    store.db.exec("BEGIN IMMEDIATE");
    service.lock(scope, emptyPlan);
    store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'failed','{}',?)").run(randomUUID(), scope.sessionId, Date.now());
    store.db.exec("COMMIT");
    service.changed(scope);
    assert.equal(service.state(scope).locked, true);
    await assert.rejects(save(await service.get(scope), [selected.id], ["fixture"]), { code: "CAPABILITIES_LOCKED" });
    assert.ok(events.every(key => key === `capabilities:${scope.workspaceId}:${scope.sessionId}`));
    store.close(); store = new Store(root); service = new Capabilities(store, () => {});
    assert.equal(service.state(scope).locked, true);
    assert.deepEqual(service.state(scope).selection, { skills: [], mcp: [] });
    assert.throws(() => service.state({ workspaceId: "wrong", sessionId: scope.sessionId }));
    store.db.prepare("DELETE FROM session_capabilities WHERE sessionId=?").run(scope.sessionId);
    assert.equal(service.state(scope).legacy, true);
    assert.equal(service.state(scope).locked, true);
    const legacy = await service.prepare(scope);
    assert.equal(legacy.runtime.skillPaths, null);
    assert.deepEqual(legacy.runtime.mcp.servers, [], "upgrading old sessions never enables MCP");
    assert.deepEqual((await service.get(scope)).sessionSkills, [], "current discovery is not passed off as historic loading");
    const before = capabilityFileDigest(skill);
    writeFileSync(skill, "---\nname: selected\ndescription: changed\n---\nChanged");
    assert.notEqual(capabilityFileDigest(skill), before);
    writeFileSync(join(root, "pi", "mcp.json"), '{"mcpServers": "secret-invalid-json');
    const broken = await discoverCapabilities(root, cwd);
    assert.ok(broken.warnings.length);
    assert.ok(!JSON.stringify({ warnings: broken.warnings, mcp: broken.mcp }).includes("secret-invalid-json"));
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("capability changes during preparation reject the send without renaming or locking the session", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-capability-title-")), cwd = join(root, "project"), pi = join(root, "pi");
  mkdirSync(cwd); mkdirSync(pi);
  const previousPiDir = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = pi;
  writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: { fixture: {
    api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", models: [{ id: "fixture", name: "Fixture" }],
  } } }));
  writeFileSync(join(pi, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "fixture" } }));
  const store = new Store(root), agents = new Agents(store, new ModelService(root), () => {});
  try {
    const w = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: cwd, authorized: true } }) as Workspace;
    const s = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: w.id }) as Session;
    const scope = { workspaceId: w.id, sessionId: s.id };
    await agents.command({ requestId: randomUUID(), op: "agent.model", ...scope, params: { selection: { provider: "fixture", id: "fixture", thinking: "off" } } });
    const prepare = agents.profiles.prepareAsync.bind(agents.profiles);
    agents.profiles.prepareAsync = async (...args) => {
      const environment = await prepare(...args), catalog = await agents.capabilities.get(scope);
      await agents.capabilities.command({ requestId: randomUUID(), op: "capabilities.save", ...scope,
        params: { revision: catalog.state.revision, catalogRevision: catalog.revision, skills: [], mcp: [] } });
      return environment;
    };
    let launches = 0;
    (agents as any).runs.launch = async () => { launches++; throw Error("Unexpected launch"); };
    await assert.rejects(agents.command({ requestId: randomUUID(), op: "prompt", ...scope,
      params: { text: "Rejected prompt should not rename" } }), { code: "REVISION_CONFLICT" });
    assert.equal(store.session(w.id, s.id).title, s.title);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM runs").get()!.n, 0);
    assert.equal(launches, 0);
    assert.equal(agents.capabilities.state(scope).locked, false);
  } finally {
    await agents.close(); store.close(); rmSync(root, { recursive: true, force: true });
    if (previousPiDir === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPiDir;
  }
});

test("capabilities: removed selections remain visible and stale resource catalogs cannot save", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-capability-drift-"));
  mkdirSync(join(root, ".pi", "skills", "drift"), { recursive: true });
  const file = join(root, ".pi", "skills", "drift", "SKILL.md");
  writeFileSync(file, "---\nname: drift\ndescription: fixture\n---\n");
  const store = new Store(root), service = new Capabilities(store, () => {});
  try {
    const w = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: root, authorized: true } }) as Workspace;
    const s = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: w.id }) as Session;
    const scope = { workspaceId: w.id, sessionId: s.id }, catalog = await service.get(scope);
    const id = catalog.skills.find(item => item.name === "drift")!.id;
    const params = { revision: 0, catalogRevision: catalog.revision, skills: [id], mcp: [] };
    await service.command({ requestId: randomUUID(), op: "capabilities.save", ...scope, params });
    rmSync(file);
    const unavailable = await service.get(scope);
    assert.equal(unavailable.skills.find(item => item.id === id)?.available, false);
    await assert.rejects(service.prepare(scope), { code: "CAPABILITY_UNAVAILABLE" });
    await assert.rejects(service.command({ requestId: randomUUID(), op: "capabilities.save", ...scope, params: { ...params, revision: 1, skills: [] } }), { code: "REVISION_CONFLICT" });
    await service.command({ requestId: randomUUID(), op: "capabilities.save", ...scope, params: { revision: 1, catalogRevision: unavailable.revision, skills: [], mcp: [] } });
    assert.deepEqual((await service.prepare(scope)).runtime.skillPaths, []);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
