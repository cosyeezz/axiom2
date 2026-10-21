import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "./temporary.js";
import { join } from "node:path";
import { Store } from "../src/server/storage.js";
import { Capabilities } from "../src/server/capabilities.js";
import { SkillFiles } from "../src/server/skill-files.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

test("global per-resource preferences synchronize, preserve locked snapshots, persist and isolate project MCP identities", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-global-capabilities-")), cwd = join(root, "a"), cwd2 = join(root, "b");
  for (const dir of [cwd, cwd2]) {
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(join(dir, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { local: { command: "not-launched", enabled: false } } }));
  }
  const file = join(root, "pi", "skills", "shared", "SKILL.md");
  mkdirSync(join(root, "pi", "skills", "shared"), { recursive: true });
  writeFileSync(file, "---\nname: shared\ndescription: Shared method\n---\nGuide");
  let store = new Store(root); const events: string[] = [];
  let caps = new Capabilities(store, scope => events.push(scope));
  const scopeFor = (path: string) => {
    const w = store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path, authorized: true } }) as Workspace;
    const s = store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: w.id }) as Session;
    return { workspaceId: w.id, sessionId: s.id };
  };
  const scope = scopeFor(cwd), other = scopeFor(cwd2);
  try {
    const catalog = await caps.get(scope), skill = catalog.skills.find(item => item.name === "shared")!;
    caps.lock(scope, await caps.prepare(scope)); const frozen = caps.state(scope);
    const save = (revision: number, kind: string, id: string, checked: boolean) => caps.command({ op: "capabilities.defaults.save", requestId: randomUUID(), ...scope,
      params: { revision, catalogRevision: catalog.revision, kind, id, checked } });
    const outcomes = await Promise.allSettled([save(0, "skills", skill.id, false), save(0, "skills", skill.id, false)]);
    assert.equal(outcomes.filter(item => item.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter(item => item.status === "rejected" && item.reason.code === "REVISION_CONFLICT").length, 1);
    assert.deepEqual(caps.state(scope), frozen);
    assert.equal((await caps.get(other)).skills.find(item => item.name === "shared")?.defaultSelected, false);
    assert.ok(!(await caps.prepare(other)).runtime.skillPaths?.includes(file));
    await save(1, "mcp", "local", true);
    assert.equal((await caps.get(scope)).mcp.find(item => item.id === "local")?.defaultSelected, true);
    assert.equal((await caps.get(other)).mcp.find(item => item.id === "local")?.defaultSelected, false);
    assert.ok(events.every(event => event === "capability-preferences"));
    store.close(); store = new Store(root); caps = new Capabilities(store, () => {});
    assert.equal(caps.preferences().revision, 2);
    assert.equal((await caps.get(other)).skills.find(item => item.name === "shared")?.defaultSelected, false);
    assert.deepEqual(caps.state(scope), frozen);
    const reloadPlan = await caps.prepare(scope, true);
    assert.deepEqual(caps.state(scope), frozen, "preparing reload does not publish members");
    await save(2, "skills", skill.id, true);
    caps.appliedReload(scope, reloadPlan);
    assert.ok(!caps.state(scope).selection?.skills?.includes(skill.id), "success publishes the captured reload target");
    assert.equal((await caps.get(scope)).skills.find(item => item.id === skill.id)?.defaultSelected, true, "a later checkbox change remains pending");
    assert.ok((await caps.prepare(scope, true)).runtime.selection.skills?.includes(skill.id));
    // A malformed, unselected MCP resource must not prevent pure skill execution.
    rmSync(join(cwd2, ".pi", "mcp.json")); mkdirSync(join(cwd2, ".pi", "mcp.json"));
    const broken = await caps.get(other);
    assert.ok(broken.warnings.length);
    assert.deepEqual((await caps.prepare(other)).runtime.mcp.servers, []);
    const opened: string[] = [], revealed: string[] = [];
    const files = new SkillFiles(caps, async directory => { revealed.push(directory); }, async path => { opened.push(path); });
    const call = (op: string, id: string, workspaceId = scope.workspaceId) => files.command({ op, requestId: randomUUID(), ...scope, workspaceId, params: { id } }, new AbortController().signal);
    await call("capabilities.skill.open", skill.id); await call("capabilities.skill.reveal", skill.id);
    assert.deepEqual(opened, [realpathSync.native(file)]); assert.deepEqual(revealed, [realpathSync.native(join(root, "pi", "skills", "shared"))]);
    await assert.rejects(call("capabilities.skill.open", "/etc/passwd"), { code: "CAPABILITY_UNAVAILABLE" });
    await assert.rejects(call("capabilities.skill.open", skill.id, "foreign"));
    rmSync(file);
    await assert.rejects(call("capabilities.skill.open", skill.id), { code: "CAPABILITY_UNAVAILABLE" });
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
