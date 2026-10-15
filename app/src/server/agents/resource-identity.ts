import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { openCliConfigPath, openCliSkillNames, readOpenCliConfig } from "../integrations/opencli-runtime.js";

// Only resource locations, never the project's source tree or dependencies.
// Package/external resources are additionally bounded by the worker's absolute lifetime.
export function resourceIdentity(cwd: string, agentDir: string) {
  const hash = createHash("sha256");
  let remaining = 5000;
  const visit = (path: string) => {
    hash.update(path);
    if (--remaining < 0) throw Error("Resource identity exceeds inspection budget");
    let stat;
    try { stat = lstatSync(path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") { hash.update("missing"); return; }
      throw error;
    }
    hash.update(`${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) {
        if (!["node_modules", ".git"].includes(name)) visit(join(path, name));
      }
    } else if (stat.isFile() && stat.size <= 1024 * 1024) hash.update(readFileSync(path));
  };
  const root = dirname(agentDir);
  visit(openCliConfigPath(root));
  const opencli = readOpenCliConfig(root);
  if (opencli) {
    // Global npm updates change link targets in place. Hash their real contents too.
    visit(join(opencli.packageRoot, "package.json"));
    for (const name of openCliSkillNames) visit(join(opencli.packageRoot, "skills", name, "SKILL.md"));
  }
  for (const name of ["AGENTS.md", "SYSTEM.md", "APPEND_SYSTEM.md", "extensions", "skills", "prompts"])
    visit(join(agentDir, name));
  for (let dir = cwd; ; dir = dirname(dir)) {
    visit(join(dir, "AGENTS.md"));
    for (const name of ["AGENTS.md", "SYSTEM.md", "APPEND_SYSTEM.md", "extensions", "skills", "prompts"])
      visit(join(dir, ".pi", name));
    if (dirname(dir) === dir) break;
  }
  return hash.digest("hex");
}
