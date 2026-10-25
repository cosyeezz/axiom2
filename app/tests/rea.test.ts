import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "./temporary.js";
import { join, resolve } from "node:path";
import { diagnoseRea, ReaService } from "../src/server/integrations/rea.js";
import { reaConfigPath, reaDirectory, reaPackageRoot, reaSkillName, reaSupportedNode, reaNode, readReaConfig } from "../src/server/integrations/rea-runtime.js";
import { reaResources } from "../src/server/integrations/rea-resources.js";
import { capabilityRuntime, discoverCapabilities, skillId } from "../src/server/capability-resources.js";
import { resourceIdentity, resourceIdentityAsync } from "../src/server/agents/resource-identity.js";
import { Capabilities } from "../src/server/capabilities.js";
import type { Session, Workspace } from "../src/shared/protocol.js";
import { Store } from "../src/server/storage.js";
import { Resources } from "../src/server/resources.js";
import { reaFixture, writeReaPackage } from "./rea-fixture.js";

const call = (service: ReaService, op: string, params = {}) => service.command({ requestId: randomUUID(), op, params });
async function settle(service: ReaService) {
  const until = Date.now() + 15_000;
  while (service.snapshot().job?.running) {
    assert.ok(Date.now() < until, "operation did not finish");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return service.snapshot();
}
const temporary = () => mkdtempSync(join(tmpdir(), "axiom-rea-test-"));

test("REA installs privately, checks an actual MCP session, discovers bundled skills, preserves external configuration", async () => {
  const root = temporary(), f = reaFixture(), service = new ReaService(root, () => {}, f.dependencies);
  try {
    const before = resourceIdentity(root, join(root, "pi"));
    const receipt = await call(service, "rea.install", { version: "6.7.0" });
    assert.equal(receipt.job?.running, true);
    const state = await settle(service);
    assert.equal(state.job?.error, undefined); assert.equal(state.version, "6.7.0"); assert.equal(state.diagnostic?.toolCount, 1);
    const args = f.calls.find(args => args[1] === "install")!;
    assert.ok(args.includes("--prefix")); assert.ok(args.includes("--engine-strict")); assert.ok(!args.includes("--global")); assert.ok(!args.includes("--ignore-scripts"));
    const catalog = await discoverCapabilities(root, root);
    const skill = catalog.skills.find(s => s.name === reaSkillName)!;
    assert.ok(skill.source.startsWith(reaDirectory(root))); assert.equal(catalog.skills.filter(s => s.name === reaSkillName).length, 1);
    const builtinConfig = catalog.config.servers.find(s => s.name === "rea")!.config;
    assert.ok("command" in builtinConfig); assert.equal(builtinConfig.command, reaNode(root)); assert.notEqual(builtinConfig.command, process.execPath);
    assert.ok(catalog.files.some(f => f.path.endsWith(join("references", "guide.md"))));
    assert.equal(capabilityRuntime(catalog, { skills: [skill.id], mcp: ["rea"] }).mcp.servers.length, 1);
    const identity = resourceIdentity(root, join(root, "pi"));
    assert.notEqual(identity, before); assert.equal(await resourceIdentityAsync(root, join(root, "pi")), identity);
    writeFileSync(join(reaPackageRoot(root)!, "skills", reaSkillName, "references", "guide.md"), "Changed guide");
    assert.notEqual(resourceIdentity(root, join(root, "pi")), identity);
    mkdirSync(join(root, "pi"), { recursive: true });
    const external = JSON.stringify({ mcpServers: { rea: { command: "external-rea", args: ["mcp"], enabled: false }, other: { command: "other" } } });
    writeFileSync(join(root, "pi", "mcp.json"), external);
    const overridden = await discoverCapabilities(root, root);
    const externalConfig = overridden.config.servers.find(s => s.name === "rea")!.config;
    assert.ok("command" in externalConfig); assert.equal(externalConfig.command, reaNode(root));
    assert.equal(overridden.mcp.find(s => s.id === "rea")!.defaultSelected, true);
    assert.equal(overridden.mcp.find(s => s.id === "rea")!.builtin, "rea"); assert.equal(overridden.mcp.length, 2);
    assert.equal(readFileSync(join(root, "pi", "mcp.json"), "utf8"), external);
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("REA built-in MCP takes precedence over complete and partial project definitions", async () => {
  const root = temporary(), f = reaFixture(), service = new ReaService(root, () => {}, f.dependencies);
  try {
    await call(service, "rea.install", { version: "6.7.0" }); assert.equal((await settle(service)).job?.error, undefined);
    mkdirSync(join(root, ".pi"));
    writeFileSync(join(root, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { rea: { enabled: false, exposure: "deferred" } } }));
    const catalog = await discoverCapabilities(root, root);
    assert.deepEqual(catalog.config.errors, []); assert.equal(catalog.mcp.find(s => s.id === "rea")!.defaultSelected, true);
    assert.equal(catalog.config.servers.find(s => s.name === "rea")!.config.exposure, "codemode");
    writeFileSync(join(root, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { rea: { enabled: "invalid" } } }));
    const invalid = await discoverCapabilities(root, root);
    assert.deepEqual(invalid.config.errors, []); assert.ok(invalid.config.servers.some(s => s.name === "rea"));
    writeFileSync(join(root, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { rea: { command: "project-rea" } } }));
    const complete = await discoverCapabilities(root, root);
    assert.equal((complete.config.servers.find(s => s.name === "rea")!.config as { command: string }).command, reaNode(root));
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("REA failed update and failed MCP verification keep current version and clean unused prefixes", async () => {
  for (const failure of ["fail", "mismatch", "invalidSkill"] as const) {
    const root = temporary(), f = reaFixture(), service = new ReaService(root, () => {}, f.dependencies);
    try {
      await call(service, "rea.install", { version: "6.7.0" }); assert.equal((await settle(service)).job?.error, undefined);
      const original = readFileSync(reaConfigPath(root), "utf8");
      f.setLatest("6.8.0"); await call(service, "rea.check"); await settle(service); f[failure]();
      await call(service, "rea.install", { version: "6.8.0" }); const failed = await settle(service);
      assert.ok(failed.job?.error); assert.ok(!failed.job.error.includes("secret-value"));
      assert.equal(failed.version, "6.7.0"); assert.equal(readFileSync(reaConfigPath(root), "utf8"), original);
      assert.equal(readdirSync(join(reaDirectory(root), "versions")).length, 1);
    } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
  }
});

test("REA cancellation, revision conflict, restart and broken configuration never switch or replay installations", async () => {
  const root = temporary(), f = reaFixture();
  let service = new ReaService(root, () => {}, f.dependencies);
  try {
    await call(service, "rea.install", { version: "6.7.0" }); await settle(service);
    const original = readFileSync(reaConfigPath(root), "utf8");
    let release!: () => void; f.hold(new Promise<void>(resolve => { release = resolve; }));
    const running = await call(service, "rea.install", { version: "6.7.0" });
    await assert.rejects(call(service, "rea.install", { version: "6.7.0" }), { code: "BUSY" });
    await new Promise(resolve => setImmediate(resolve));
    await call(service, "rea.cancel", { jobId: running.job!.id });
    assert.equal(readFileSync(reaConfigPath(root), "utf8"), original);
    release();
    await call(service, "rea.install", { version: "6.7.0" });
    writeFileSync(reaConfigPath(root), JSON.stringify({ ...JSON.parse(original), revision: "external-change" }));
    assert.match((await settle(service)).job!.error!, /配置已变化/);
    assert.equal(readReaConfig(root).revision, "external-change");
    await assert.rejects(call(service, "rea.save", { enabled: false, revision: "old" }), { code: "CONFIGURATION_CONFLICT" });
    await service.close();
    writeFileSync(join(reaDirectory(root), "job.json"), JSON.stringify({ id: "interrupted", kind: "install", running: true, message: "installing" }));
    const count = f.calls.length; service = new ReaService(root, () => {}, f.dependencies);
    assert.equal(service.snapshot().job?.running, false); assert.match(service.snapshot().job!.message, /中断/); assert.equal(f.calls.length, count);
    writeFileSync(reaConfigPath(root), "broken");
    await assert.rejects(call(service, "rea.install", { version: "6.7.0" }));
    assert.equal(readFileSync(reaConfigPath(root), "utf8"), "broken");
    assert.ok(reaResources(root, root).warning);
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("REA managed skill survives deletion of the external copy; resource manager cannot edit/remove/move it", async () => {
  const root = temporary(), f = reaFixture(), service = new ReaService(root, () => {}, f.dependencies), store = new Store(root);
  const resources = new Resources(store, join(root, "pi"), () => {}, async () => {});
  try {
    const legacy = join(root, "pi", "skills", reaSkillName); mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "SKILL.md"), `---\nname: ${reaSkillName}\ndescription: External copy\n---\n`);
    await call(service, "rea.install", { version: "6.7.0" }); await settle(service);
    const catalog = await discoverCapabilities(root, root), id = catalog.skills.find(s => s.name === reaSkillName)!.id;
    rmSync(legacy, { recursive: true });
    assert.equal((await discoverCapabilities(root, root)).skills.find(s => s.name === reaSkillName)!.id, id);
    const listing = await resources.refresh();
    const skill = listing.items.find(i => i.kind === "skill" && i.name === reaSkillName)!, mcp = listing.items.find(i => i.id === "builtin:rea:mcp")!;
    assert.equal(skill.removable, false); assert.equal(skill.movable, false); assert.equal(mcp.removable, false);
    assert.equal(mcp.movable, false); assert.match(mcp.moveBlockedReason ?? "", /内置工具管理.*全局/);
    assert.doesNotMatch(mcp.moveBlockedReason ?? "", /配置已不存在/);
    for (const item of [skill, mcp]) for (const op of ["resources.remove", "resources.update", "resources.save", "resources.move"]) {
      await assert.rejects(resources.command({ requestId: randomUUID(), op, params: { id: item.id, revision: resources.snapshot().revision, confirm: true } }), { code: "BUILTIN_RESOURCE" });
    }
    await call(service, "rea.save", { enabled: false, revision: service.snapshot().revision });
    const disabled = await discoverCapabilities(root, root);
    assert.equal(disabled.skills.find(s => s.name === reaSkillName)!.defaultSelected, false); assert.equal(disabled.mcp.find(m => m.id === "rea")!.defaultSelected, false);
    const previousPreference = disabled.skills.find(s => s.name === reaSkillName)!.preferenceKey;
    await call(service, "rea.install", { version: "6.7.0" }); await settle(service);
    assert.equal((await discoverCapabilities(root, root)).skills.find(s => s.name === reaSkillName)!.preferenceKey, previousPreference);
  } finally { await resources.close(); await service.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("locked sessions keep the same managed REA selection across reinstall and upgrade", async () => {
  const root = temporary(), f = reaFixture(), service = new ReaService(root, () => {}, f.dependencies), store = new Store(root);
  const capabilities = new Capabilities(store, () => {});
  try {
    await call(service, "rea.install", { version: "6.7.0" });
    assert.equal((await settle(service)).job?.error, undefined);
    const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: root, authorized: true } }) as Workspace;
    const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    const catalog = await capabilities.get(scope), initial = catalog.skills.find(item => item.name === reaSkillName)!;
    await capabilities.command({ requestId: randomUUID(), op: "capabilities.save", ...scope,
      params: { revision: catalog.state.revision, catalogRevision: catalog.revision, skills: [initial.id], mcp: [] } });
    capabilities.lock(scope, await capabilities.prepare(scope));
    // Changed global defaults must not override this session's existing explicit selection.
    await call(service, "rea.save", { enabled: false, revision: service.snapshot().revision });
    for (const version of ["6.7.0", "6.8.0"]) {
      f.setLatest(version); await call(service, "rea.check"); await settle(service);
      await call(service, "rea.install", { version });
      assert.equal((await settle(service)).job?.error, undefined);
      const current = await capabilities.get(scope), skill = current.skills.find(item => item.name === reaSkillName)!;
      assert.equal(skill.id, reaSkillName);
      assert.notEqual(skill.source, initial.source);
      assert.equal(skill.preferenceKey, initial.preferenceKey);
      assert.equal(current.skills.filter(item => item.name === reaSkillName).length, 1, "no stale unavailable duplicate");
      assert.equal(current.state.locked, true);
      assert.deepEqual(current.state.selection, { skills: [skill.id], mcp: [] });
      const plan = await capabilities.prepare(scope);
      assert.deepEqual(plan.runtime.selection, current.state.selection);
      assert.ok(plan.runtime.skillPaths?.includes(skill.source));
      assert.equal(plan.runtime.mcp.servers.length, 0, "migration cannot enable new MCP connections");
      assert.deepEqual(capabilities.state(scope).selection, plan.runtime.selection, "name selection is stable across installation paths");
      const revision = capabilities.state(scope).revision;
      store.db.exec("BEGIN IMMEDIATE");
      capabilities.lock(scope, plan);
      store.db.exec("COMMIT");
      assert.deepEqual(capabilities.state(scope).selection, plan.runtime.selection);
      assert.equal(capabilities.state(scope).revision, revision);
      capabilities.lock(scope, plan);
    }
  } finally { await service.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("historical path selections resolve by saved name and built-ins fall back to general resources", async () => {
  const root = temporary(), f = reaFixture(), service = new ReaService(root, () => {}, f.dependencies), store = new Store(root);
  const capabilities = new Capabilities(store, () => {});
  const external = join(root, ".pi", "skills", reaSkillName);
  try {
    mkdirSync(external, { recursive: true });
    writeFileSync(join(external, "SKILL.md"), `---\nname: ${reaSkillName}\ndescription: External copy\n---\n`);
    const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: root, authorized: true } }) as Workspace;
    const scopes = [];
    for (const selected of [true, false]) {
      const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
      const scope = { workspaceId: workspace.id, sessionId: session.id }, catalog = await capabilities.get(scope);
      const skill = catalog.skills.find(item => item.name === reaSkillName)!;
      assert.equal(realpathSync.native(skill.source), realpathSync.native(join(external, "SKILL.md")));
      await capabilities.command({ requestId: randomUUID(), op: "capabilities.save", ...scope,
        params: { revision: catalog.state.revision, catalogRevision: catalog.revision, skills: selected ? [skill.id] : [], mcp: [] } });
      capabilities.lock(scope, await capabilities.prepare(scope));
      const oldId = skillId(skill.source);
      store.db.prepare("UPDATE session_capabilities SET selection=?,catalog=? WHERE sessionId=?")
        .run(JSON.stringify({ skills: selected ? [oldId] : [], mcp: [] }), JSON.stringify({ skills: [{ ...skill, id: oldId }], mcp: [] }), session.id);
      scopes.push({ scope, selected, initial: capabilities.state(scope), oldId });
    }
    await call(service, "rea.install", { version: "6.7.0" });
    assert.equal((await settle(service)).job?.error, undefined);
    // An explicit session selection survives even when the managed default is off.
    await call(service, "rea.save", { enabled: false, revision: service.snapshot().revision });
    // Broken built-in configuration falls back by name without changing selection.
    const validConfig = readFileSync(reaConfigPath(root), "utf8");
    writeFileSync(reaConfigPath(root), "broken");
    const fallback = await capabilities.get(scopes[0].scope), fallbackSkill = fallback.skills.find(s => s.name === reaSkillName)!;
    assert.equal(realpathSync.native(fallbackSkill.source), realpathSync.native(join(external, "SKILL.md"))); assert.equal(fallbackSkill.builtin, "rea"); assert.equal(fallbackSkill.fallback, true);
    assert.deepEqual((await capabilities.prepare(scopes[0].scope)).runtime.selection, { skills: [reaSkillName], mcp: [] });
    writeFileSync(reaConfigPath(root), validConfig);
    for (const removeExternal of [false, true]) {
      if (removeExternal) rmSync(external, { recursive: true });
      for (const { scope, selected, initial, oldId } of scopes) {
        const catalog = await capabilities.get(scope), skills = catalog.skills.filter(item => item.name === reaSkillName);
        assert.equal(skills.length, 1, "replaced historical entry is not appended as unavailable");
        const skill = skills[0];
        assert.equal(skill.available, true); assert.equal(skill.defaultSelected, false); assert.notEqual(skill.id, oldId);
        assert.deepEqual(catalog.state.selection, { skills: selected ? [skill.id] : [], mcp: [] });
        const plan = await capabilities.prepare(scope);
        assert.deepEqual(plan.runtime.selection, catalog.state.selection);
        assert.ok(plan.runtime.skillPaths?.includes(skill.source));
        assert.equal(plan.runtime.mcp.servers.length, 0);
        assert.deepEqual(capabilities.state(scope), initial, "listing and preparation do not commit runtime state");
      }
    }
    const { scope } = scopes[0];
    const config = readFileSync(reaConfigPath(root), "utf8");
    writeFileSync(reaConfigPath(root), "broken");
    const broken = await capabilities.get(scope);
    assert.equal(broken.skills.find(item => item.name === reaSkillName)?.available, false);
    await assert.rejects(capabilities.prepare(scope), { code: "CAPABILITY_UNAVAILABLE" });
    writeFileSync(reaConfigPath(root), config);
    const plan = await capabilities.prepare(scope);
    capabilities.lock(scope, plan);
    assert.deepEqual(capabilities.state(scope).selection, plan.runtime.selection);
    assert.equal(capabilities.state(scope).revision, scopes[0].initial.revision + 1);
  } finally { await service.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("built-in name preferences preserve historical defaults and remain separated by capability type", async () => {
  const root = temporary(), f = reaFixture(), service = new ReaService(root, () => {}, f.dependencies), store = new Store(root);
  const capabilities = new Capabilities(store, () => {});
  try {
    const general = join(root, ".pi", "skills", reaSkillName, "SKILL.md"), mcpPath = join(root, ".pi", "mcp.json");
    mkdirSync(join(root, ".pi", "skills", reaSkillName), { recursive: true });
    writeFileSync(general, `---\nname: ${reaSkillName}\ndescription: General\n---\n`);
    writeFileSync(mcpPath, JSON.stringify({ mcpServers: { rea: { command: "general-rea" } } }));
    const generalCatalog = await discoverCapabilities(root, root);
    const generalServer = generalCatalog.config.servers.find(server => server.name === "rea")!;
    // Reproduce the old writers: MCP used resolve(source), skills used realpathSync.
    const oldMcpKey = createHash("sha256").update(JSON.stringify([resolve(generalServer.source), "rea"])).digest("hex");
    store.db.prepare("INSERT INTO capability_preferences(id,revision,body) VALUES(1,1,?)")
      .run(JSON.stringify({ skills: { [skillId(realpathSync(general))]: false, rea: true }, mcp: { [oldMcpKey]: false, [reaSkillName]: true } }));
    await call(service, "rea.install", { version: "6.7.0" }); assert.equal((await settle(service)).job?.error, undefined);
    const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: root, authorized: true } }) as Workspace;
    const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id }, catalog = await capabilities.get(scope);
    assert.equal(catalog.skills.find(skill => skill.name === reaSkillName)!.defaultSelected, false);
    assert.equal(catalog.mcp.find(server => server.name === "rea")!.defaultSelected, false);
    assert.deepEqual((await capabilities.prepare(scope)).runtime.selection.mcp, []);
  } finally { await service.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("built-in Skill and MCP fall back independently, with one effective entry per name", async () => {
  const root = temporary(), f = reaFixture(), service = new ReaService(root, () => {}, f.dependencies);
  try {
    const general = join(root, "pi", "skills", reaSkillName, "SKILL.md");
    mkdirSync(join(root, "pi", "skills", reaSkillName), { recursive: true });
    writeFileSync(general, `---\nname: ${reaSkillName}\ndescription: General fallback\n---\nGENERAL`);
    writeFileSync(join(root, "pi", "mcp.json"), JSON.stringify({ mcpServers: { rea: { command: "general-rea", enabled: false } } }));
    await call(service, "rea.install", { version: "6.7.0" }); assert.equal((await settle(service)).job?.error, undefined);
    await call(service, "rea.save", { enabled: false, revision: service.snapshot().revision });
    let catalog = await discoverCapabilities(root, root);
    assert.equal(catalog.skills.find(s => s.name === reaSkillName)!.fallback, false);
    assert.equal(catalog.skills.find(s => s.name === reaSkillName)!.defaultSelected, false);
    assert.equal(catalog.mcp.find(s => s.name === "rea")!.fallback, false, "disabled is a valid built-in, not a load failure");
    const builtinSkill = catalog.skills.find(s => s.name === reaSkillName)!;
    rmSync(builtinSkill.source);
    catalog = await discoverCapabilities(root, root);
    assert.equal(catalog.skills.filter(s => s.name === reaSkillName).length, 1);
    assert.equal(catalog.skills.find(s => s.name === reaSkillName)!.source, general);
    assert.equal(catalog.skills.find(s => s.name === reaSkillName)!.fallback, true);
    assert.equal(catalog.mcp.find(s => s.name === "rea")!.fallback, false);
    rmSync(join(reaPackageRoot(root)!, "scripts", "rea.mjs"));
    catalog = await discoverCapabilities(root, root);
    assert.equal(catalog.mcp.filter(s => s.name === "rea").length, 1);
    assert.equal(catalog.mcp.find(s => s.name === "rea")!.fallback, true);
    assert.equal((catalog.config.servers.find(s => s.name === "rea")!.config as { command: string }).command, "general-rea");
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("REA cancelling initialization waits for the MCP process to exit", async () => {
  const root = temporary(), packageRoot = join(root, "package"), pidFile = join(root, "pid");
  const controller = new AbortController(); let pid: number | undefined;
  try {
    writeReaPackage(packageRoot, "6.7.0");
    writeFileSync(join(packageRoot, "scripts", "rea.mjs"), `import { writeFileSync } from 'node:fs';
      writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
      process.on('SIGTERM', () => {}); process.stdin.resume(); setInterval(() => {}, 1000);`);
    const pending = diagnoseRea(root, packageRoot, "6.7.0", controller.signal);
    const outcome = assert.rejects(pending);
    const deadline = Date.now() + 5000;
    while (!existsSync(pidFile)) { assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 10)); }
    pid = Number(readFileSync(pidFile, "utf8")); controller.abort();
    await outcome;
    assert.throws(() => process.kill(pid!, 0), "cancel must wait for the process, not only mark the client closed");
    pid = undefined;
  } finally { controller.abort(); if (pid) try { process.kill(pid, "SIGKILL"); } catch {} rmSync(root, { recursive: true, force: true }); }
});

test("REA respects supported Node release lines", () => {
  for (const version of ["22.19.0", "22.23.2", "24.11.0", "26.0.0"]) assert.equal(reaSupportedNode(version), true);
  for (const version of ["22.18.0", "23.1.0", "24.10.0", "25.1.0", "20.19.0"]) assert.equal(reaSupportedNode(version), false);
});
