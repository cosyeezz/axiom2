import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "./temporary.js";
import { join } from "node:path";
import { ReaService } from "../src/server/integrations/rea.js";
import { reaConfigPath, reaPackageRoot, reaSkillName, readReaConfig } from "../src/server/integrations/rea-runtime.js";
import { reaResources } from "../src/server/integrations/rea-resources.js";
import { discoverCapabilities } from "../src/server/capability-resources.js";
import { resourceIdentity, resourceIdentityAsync } from "../src/server/agents/resource-identity.js";
import { Capabilities } from "../src/server/capabilities.js";
import { Store } from "../src/server/storage.js";
import type { Session, Workspace } from "../src/shared/protocol.js";
import { reaFixture } from "./rea-fixture.js";

const call = (service: ReaService, op: string, params: Record<string, unknown> = {}) => service.command({ requestId: randomUUID(), op, params });
const change = (service: ReaService, op: string) => call(service, op, { revision: service.snapshot().revision });
async function settle(service: ReaService) {
  const deadline = Date.now() + 15_000;
  while (service.snapshot().job?.running) { assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.equal(service.snapshot().job?.error, undefined);
}
const temporary = () => mkdtempSync(join(tmpdir(), "axiom-rea-components-"));

test("REA components install and uninstall independently without changing external files or running npm", async () => {
  const root = temporary(), fixture = reaFixture(), service = new ReaService(root, () => {}, fixture.dependencies);
  try {
    await call(service, "rea.install", { version: "6.7.0" }); await settle(service);
    const external = join(root, ".pi", "skills", reaSkillName), other = join(root, ".pi", "skills", "other-guide");
    for (const [path, name] of [[external, reaSkillName], [other, "other-guide"]]) {
      mkdirSync(path, { recursive: true }); writeFileSync(join(path, "SKILL.md"), `---\nname: ${name}\ndescription: External guide\n---\n`);
    }
    const externalText = readFileSync(join(external, "SKILL.md"), "utf8"), calls = fixture.calls.length;
    const preference = (await discoverCapabilities(root, root)).skills.find(skill => skill.name === reaSkillName)!.preferenceKey;
    const before = resourceIdentity(root, join(root, "pi"));
    await change(service, "rea.uninstallSkill");
    assert.equal(service.snapshot().skillInstalled, false); assert.equal(service.snapshot().mcpInstalled, true);
    let catalog = await discoverCapabilities(root, root);
    assert.equal(catalog.skills.find(skill => skill.name === reaSkillName)!.source, join(external, "SKILL.md"));
    assert.equal(catalog.skills.find(skill => skill.name === reaSkillName)!.fallback, true); assert.ok(catalog.skills.some(skill => skill.name === "other-guide"));
    assert.ok(catalog.mcp.some(server => server.id === "rea")); assert.notEqual(resourceIdentity(root, join(root, "pi")), before);
    await call(service, "rea.doctor"); await settle(service); assert.equal(service.snapshot().diagnostic?.toolCount, 1);
    await change(service, "rea.uninstallMcp");
    catalog = await discoverCapabilities(root, root); assert.ok(!catalog.mcp.some(server => server.id === "rea"));
    assert.equal(catalog.skills.filter(skill => skill.name === reaSkillName).length, 1);
    assert.equal(catalog.skills.find(skill => skill.name === reaSkillName)!.fallback, true);
    await change(service, "rea.installSkill");
    catalog = await discoverCapabilities(root, root);
    assert.equal(catalog.skills.find(skill => skill.name === reaSkillName)!.preferenceKey, preference);
    assert.ok(!catalog.mcp.some(server => server.id === "rea"));
    await change(service, "rea.installMcp");
    catalog = await discoverCapabilities(root, root); assert.equal(catalog.skills.filter(skill => skill.name === reaSkillName).length, 1); assert.equal(catalog.mcp.filter(server => server.id === "rea").length, 1);
    assert.equal(fixture.calls.length, calls); assert.equal(readFileSync(join(external, "SKILL.md"), "utf8"), externalText);
    const manual = JSON.stringify({ mcpServers: { rea: { command: "external-rea" }, other: { command: "other-mcp" } } });
    writeFileSync(join(root, ".pi", "mcp.json"), manual);
    await change(service, "rea.uninstallMcp");
    catalog = await discoverCapabilities(root, root);
    assert.equal(catalog.config.servers.length, 2); assert.equal(catalog.config.servers.find(server => server.name === "rea")!.source, join(root, ".pi", "mcp.json"));
    assert.equal(readFileSync(join(root, ".pi", "mcp.json"), "utf8"), manual);
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("REA component choices survive default changes, restart, reinstall and upgrade; old configs keep both components", async () => {
  const root = temporary(), fixture = reaFixture(); let service = new ReaService(root, () => {}, fixture.dependencies);
  try {
    await call(service, "rea.install", { version: "6.7.0" }); await settle(service);
    assert.equal(readReaConfig(root).skillInstalled, undefined); assert.equal(readReaConfig(root).mcpInstalled, undefined);
    assert.equal(service.snapshot().skillInstalled, true); assert.equal(service.snapshot().mcpInstalled, true);
    await change(service, "rea.uninstallSkill"); await change(service, "rea.uninstallMcp");
    await call(service, "rea.save", { enabled: false, revision: service.snapshot().revision });
    await service.close(); service = new ReaService(root, () => {}, fixture.dependencies);
    assert.equal(service.snapshot().enabled, false); assert.equal(service.snapshot().skillInstalled, false); assert.equal(service.snapshot().mcpInstalled, false);
    for (const version of ["6.7.0", "6.7.1"]) {
      fixture.setLatest(version); await call(service, "rea.check"); await settle(service);
      await call(service, "rea.install", { version }); await settle(service);
      assert.equal(service.snapshot().skillInstalled, false); assert.equal(service.snapshot().mcpInstalled, false);
      const resources = reaResources(root, root); assert.equal(resources.managed, true); assert.deepEqual(resources.skills, []); assert.equal(resources.server, undefined);
    }
    await change(service, "rea.installSkill"); await change(service, "rea.installMcp");
    const catalog = await discoverCapabilities(root, root);
    assert.equal(catalog.skills.find(skill => skill.name === reaSkillName)!.defaultSelected, false);
    assert.equal(catalog.mcp.find(server => server.id === "rea")!.defaultSelected, false);
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("broken skill cannot block MCP, broken MCP cannot block skill, and failed component installation preserves config", async () => {
  const root = temporary(), fixture = reaFixture(), service = new ReaService(root, () => {}, fixture.dependencies);
  try {
    await call(service, "rea.install", { version: "6.7.0" }); await settle(service);
    const packageRoot = reaPackageRoot(root)!, guide = join(packageRoot, "skills", reaSkillName, "references", "guide.md");
    const original = readFileSync(guide, "utf8"); rmSync(guide);
    await call(service, "rea.refresh"); assert.ok(service.snapshot().skillError); assert.equal(service.snapshot().error, undefined);
    const broken = reaResources(root, root); assert.ok(broken.server); assert.equal(broken.skills.length, 0); assert.ok(broken.warning);
    assert.equal(await resourceIdentityAsync(root, join(root, "pi")), resourceIdentity(root, join(root, "pi")));
    await call(service, "rea.doctor"); await settle(service); assert.equal(service.snapshot().diagnostic?.toolCount, 1);
    await change(service, "rea.uninstallSkill");
    const config = readFileSync(reaConfigPath(root), "utf8");
    await assert.rejects(change(service, "rea.installSkill"), { code: "COMPONENT_INVALID" });
    assert.equal(readFileSync(reaConfigPath(root), "utf8"), config);
    writeFileSync(guide, original); await change(service, "rea.installSkill");
    rmSync(join(packageRoot, "scripts", "rea.mjs"));
    await call(service, "rea.refresh"); assert.ok(service.snapshot().mcpError); assert.equal(service.snapshot().skillError, undefined);
    const noProgram = reaResources(root, root); assert.equal(noProgram.skills.length, 1); assert.equal(noProgram.server, undefined);
    await change(service, "rea.uninstallMcp");
    assert.equal(service.snapshot().mcpError, undefined); assert.equal(service.snapshot().error, undefined);
    await call(service, "rea.refresh"); assert.equal(service.snapshot().mcpError, undefined);
    const withoutMcp = readFileSync(reaConfigPath(root), "utf8");
    await assert.rejects(change(service, "rea.installMcp"), { code: "COMPONENT_INVALID" });
    assert.equal(readFileSync(reaConfigPath(root), "utf8"), withoutMcp);
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("component commands reject missing packages, stale revisions, concurrent install and malformed configuration", async () => {
  const root = temporary(), fixture = reaFixture(), service = new ReaService(root, () => {}, fixture.dependencies);
  let release = () => {};
  const operations = ["rea.installSkill", "rea.uninstallSkill", "rea.installMcp", "rea.uninstallMcp"];
  try {
    for (const op of operations) await assert.rejects(change(service, op), { code: "NOT_INSTALLED" });
    await call(service, "rea.install", { version: "6.7.0" }); await settle(service);
    for (const op of operations) await assert.rejects(call(service, op, { revision: "stale" }), { code: "CONFIGURATION_CONFLICT" });
    fixture.hold(new Promise<void>(resolve => { release = resolve; }));
    const pending = await call(service, "rea.install", { version: "6.7.0" });
    for (const op of operations) await assert.rejects(change(service, op), { code: "BUSY" });
    await call(service, "rea.cancel", { jobId: pending.job!.id }); release();
    const original = readFileSync(reaConfigPath(root), "utf8");
    for (const field of ["skillInstalled", "mcpInstalled"]) {
      writeFileSync(reaConfigPath(root), JSON.stringify({ ...JSON.parse(original), [field]: "false" }));
      assert.throws(() => readReaConfig(root));
      for (const op of operations) await assert.rejects(change(service, op));
    }
  } finally { release(); await service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("locked sessions report removed REA components unavailable and can reuse selections after reinstall", async () => {
  const root = temporary(), fixture = reaFixture(), service = new ReaService(root, () => {}, fixture.dependencies), store = new Store(root);
  const capabilities = new Capabilities(store, () => {});
  try {
    await call(service, "rea.install", { version: "6.7.0" }); await settle(service);
    const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: root, authorized: true } }) as Workspace;
    const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id }, catalog = await capabilities.get(scope);
    const skill = catalog.skills.find(item => item.name === reaSkillName)!;
    await capabilities.command({ requestId: randomUUID(), op: "capabilities.save", ...scope, params: { revision: catalog.state.revision, catalogRevision: catalog.revision, skills: [skill.id], mcp: ["rea"] } });
    capabilities.lock(scope, await capabilities.prepare(scope));
    for (const component of ["Skill", "Mcp"]) {
      await change(service, `rea.uninstall${component}`);
      await assert.rejects(capabilities.prepare(scope), { code: "CAPABILITY_UNAVAILABLE" });
      await change(service, `rea.install${component}`);
      const plan = await capabilities.prepare(scope);
      assert.deepEqual(plan.runtime.selection, { skills: [skill.id], mcp: ["rea"] });
    }
    const external = join(root, ".pi", "skills", reaSkillName);
    mkdirSync(external, { recursive: true });
    writeFileSync(join(external, "SKILL.md"), `---\nname: ${reaSkillName}\ndescription: Fallback skill\n---\n`);
    writeFileSync(join(root, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { rea: { command: "fallback-rea" } } }));
    await change(service, "rea.uninstallSkill"); await change(service, "rea.uninstallMcp");
    const fallback = await capabilities.get(scope), plan = await capabilities.prepare(scope);
    assert.equal(fallback.skills.find(item => item.name === reaSkillName)!.fallback, true);
    assert.equal(fallback.mcp.find(item => item.name === "rea")!.fallback, true);
    assert.deepEqual(plan.runtime.selection, { skills: [skill.id], mcp: ["rea"] });
  } finally { await service.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});
