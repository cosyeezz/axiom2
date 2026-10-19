import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { ModelService } from "../src/server/model-service.js";
import { capabilityRuntime, discoverCapabilities } from "../src/server/capability-resources.js";

test("shared Pi directory uses native home and path resolution, including tilde and environment overrides", () => {
  const previous = process.env.AXIOM_PI_DIR, previousPi = process.env.PI_CODING_AGENT_DIR;
  try {
    delete process.env.PI_CODING_AGENT_DIR;
    assert.equal(getAgentDir(), join(homedir(), ".pi", "agent"));
    process.env.AXIOM_PI_DIR = getAgentDir(); // Same default as the server entry point.
    assert.equal(new ModelService("unused").dir, join(homedir(), ".pi", "agent"));
    process.env.PI_CODING_AGENT_DIR = "~/共享 Pi/agent";
    process.env.AXIOM_PI_DIR = getAgentDir();
    assert.equal(new ModelService("unused").dir, join(homedir(), "共享 Pi", "agent"));
    for (const value of ["~/共享 Pi/agent", ...(process.platform === "win32" ? ["~\\共享 Pi\\agent"] : [])]) {
      process.env.AXIOM_PI_DIR = value;
      assert.equal(new ModelService("unused").dir, join(homedir(), "共享 Pi", "agent"));
    }
    process.env.AXIOM_PI_DIR = "~";
    assert.equal(new ModelService("unused").dir, homedir());
    process.env.AXIOM_PI_DIR = join("relative Pi", "agent");
    assert.equal(new ModelService("unused").dir, resolve("relative Pi", "agent"));
  } finally {
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    if (previousPi === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousPi;
  }
});

test("shared skills supplement existing sources, deduplicate and bind selection without importing terminal settings", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-shared-skills-"));
  const cwd = join(root, "项目 workspace"), shared = join(root, "共享 Pi agent");
  const skill = (base: string, folder: string, name: string, description: string) => {
    const dir = join(base, folder);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "SKILL.md");
    writeFileSync(file, `---\nname: ${name}\ndescription: ${description}\n---\nInstructions`);
    return file;
  };
  try {
    const projectFile = skill(join(cwd, ".pi", "skills"), "collision", "collision", "project wins");
    const appFile = skill(join(root, "pi", "skills"), "app-source", "app-source", "app retained");
    const sharedFile = skill(join(shared, "skills", "nested"), "shared-source", "shared-source", "shared source");
    const absoluteExcluded = skill(join(shared, "skills"), "absolute-excluded", "absolute-excluded", "excluded");
    const relativeExcluded = skill(join(shared, "skills"), "relative-excluded", "relative-excluded", "excluded");
    const projectExcluded = skill(join(shared, "skills"), "project-excluded", "project-excluded", "excluded");
    skill(join(shared, "skills"), "linked-excluded", "linked-excluded", "excluded through a link");
    const alias = join(root, "pi", "shared-alias");
    symlinkSync(join(shared, "skills", "linked-excluded"), alias, process.platform === "win32" ? "junction" : "dir");
    const aliasFile = join(alias, "SKILL.md");
    const appLocal = skill(join(root, "pi", "custom"), "app-local", "app-local", "global relative path");
    const projectLocal = skill(join(cwd, ".pi", "custom"), "project-local", "project-local", "project relative path");
    writeFileSync(join(root, "pi", "settings.json"), JSON.stringify({ skills: ["./custom", aliasFile, `-${aliasFile}`, `-${absoluteExcluded}`, `-${relative(join(root, "pi"), relativeExcluded)}`] }));
    writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ skills: ["./custom", projectExcluded, `-${projectExcluded}`] }));
    skill(join(shared, "skills"), "collision", "collision", "shared duplicate");
    writeFileSync(join(shared, "settings.json"), JSON.stringify({ packages: ["npm:must-not-install-capabilities-fixture"], extensions: ["./do-not-load.ts"] }));
    writeFileSync(join(shared, "do-not-load.ts"), "throw Error('shared extension must not run');");
    const catalog = await discoverCapabilities(root, cwd, shared);
    assert.equal(catalog.skills.find(item => item.name === "collision")?.source, projectFile);
    assert.equal(catalog.skills.filter(item => item.name === "collision").length, 1);
    assert.equal(catalog.skills.find(item => item.name === "app-source")?.source, appFile);
    assert.equal(catalog.skills.find(item => item.name === "app-local")?.source, appLocal);
    assert.equal(catalog.skills.find(item => item.name === "project-local")?.source, projectLocal);
    for (const name of ["absolute-excluded", "relative-excluded", "project-excluded", "linked-excluded"]) {
      assert.ok(!catalog.skills.some(item => item.name === name), `${name} must stay excluded by its scoped settings`);
    }
    const selected = catalog.skills.find(item => item.name === "shared-source")!;
    assert.equal(selected.source, sharedFile);
    assert.deepEqual(capabilityRuntime(catalog, { skills: [selected.id], mcp: [] }).skillPaths, [sharedFile]);
    assert.deepEqual(capabilityRuntime(catalog, { skills: [], mcp: [] }).skillPaths, []);
    assert.ok(catalog.files.some(item => item.path === sharedFile));
    const sameDir = await discoverCapabilities(root, cwd, join(root, "pi"));
    assert.equal(sameDir.skills.filter(item => item.name === "app-source").length, 1);
    const missing = await discoverCapabilities(root, cwd, join(root, "missing"));
    assert.ok(!missing.skills.some(item => item.name === "shared-source"));
    assert.ok(missing.skills.some(item => item.name === "app-source"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
