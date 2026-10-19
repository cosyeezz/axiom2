import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capabilityRuntime, discoverCapabilities } from "../src/server/capability-resources.js";
import { ExecutionProfiles } from "../src/server/execution-profile.js";

test("capability selection and MCP/Skill contents bind worker identity through every admission gate", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-capability-profile-")), cwd = join(root, "project"), modelDir = join(root, "pi");
  const mcpDir = join(root, "shared-pi");
  mkdirSync(join(mcpDir, "skills", "fixture"), { recursive: true }); mkdirSync(cwd); mkdirSync(modelDir);
  const skill = join(mcpDir, "skills", "fixture", "SKILL.md"), mcp = join(mcpDir, "mcp.json"), raw = '{"providers":{}}';
  writeFileSync(skill, "---\nname: fixture\ndescription: content version one\n---\n");
  writeFileSync(mcp, JSON.stringify({ mcpServers: { fixture: { command: "no-start", exposure: "direct" } } }));
  writeFileSync(join(modelDir, "models.json"), raw);
  const profiles = new ExecutionProfiles(root), environments: ReturnType<ExecutionProfiles["prepare"]>[] = [];
  try {
    const catalog = await discoverCapabilities(root, cwd, mcpDir), id = catalog.skills.find(item => item.name === "fixture")!.id;
    const base = { entry: "agent" as const, cwd, modelDir, modelsRaw: raw, mode: "managed" as const };
    const selected = profiles.prepare({ ...base, capabilities: capabilityRuntime(catalog, { skills: [id], mcp: ["fixture"] }) }); environments.push(selected);
    const empty = profiles.prepare({ ...base, capabilities: capabilityRuntime(catalog, { skills: [], mcp: [] }) }); environments.push(empty);
    assert.notEqual(selected.profileHash, empty.profileHash);
    assert.equal(selected.current(false), true);
    writeFileSync(mcp, JSON.stringify({ mcpServers: { fixture: { command: "different-no-start", exposure: "direct" } } }));
    assert.equal(selected.current(false), false, "MCP changes are checked even when full resource traversal is skipped");
    assert.equal(await selected.currentAsync!(), false);
    const fresh = await discoverCapabilities(root, cwd, mcpDir);
    const changed = profiles.prepare({ ...base, capabilities: capabilityRuntime(fresh, { skills: [id], mcp: ["fixture"] }) }); environments.push(changed);
    assert.notEqual(changed.profileHash, selected.profileHash);
    assert.equal(changed.current(false), true);
    writeFileSync(skill, "---\nname: fixture\ndescription: content version two\n---\n");
    assert.equal(changed.current(false), false);
    assert.equal(await changed.currentAsync!(), false);
  } finally { for (const environment of environments) environment.release(); rmSync(root, { recursive: true, force: true }); }
});
