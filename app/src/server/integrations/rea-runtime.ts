import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ReaEnginePaths } from "../../shared/rea-engines.js";
import { validEnginePaths } from "./rea-engines.js";

export const reaSkillName = "reverse-engineer-anything";
export const reaDirectory = (root: string) => join(root, "integrations", "rea");
export const reaConfigPath = (root: string) => join(reaDirectory(root), "config.json");
export const validReaVersion = (value: unknown): value is string => typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value);
export function reaSupportedNode(version = process.versions.node) {
  const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
  return major === 22 && minor >= 19 || major === 24 && minor >= 11 || major >= 26;
}
export type ReaConfig = { format: 1; revision: string; enabled: boolean; skillInstalled?: boolean; mcpInstalled?: boolean; engines?: ReaEnginePaths; installation?: { directory: string; version: string } };
export function readReaConfig(root: string): ReaConfig {
  try {
    const value = JSON.parse(readFileSync(reaConfigPath(root), "utf8"));
    if (value.format !== 1 || typeof value.revision !== "string" || !value.revision || typeof value.enabled !== "boolean" ||
        value.skillInstalled !== undefined && typeof value.skillInstalled !== "boolean" ||
        value.mcpInstalled !== undefined && typeof value.mcpInstalled !== "boolean" ||
        value.engines !== undefined && !validEnginePaths(value.engines) ||
        value.installation && (!validReaVersion(value.installation.version) || typeof value.installation.directory !== "string" ||
          !/^v\d+\.\d+\.\d+-[a-f0-9-]{36}$/.test(value.installation.directory))) throw Error();
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { format: 1, revision: "", enabled: true };
    throw Error("REA 配置无法读取，请检查 integrations/rea/config.json；未覆盖原文件。");
  }
}
export function atomicReaJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 }); renameSync(temporary, path); }
  finally { rmSync(temporary, { force: true }); }
}
export function reaPackageRoot(root: string, config = readReaConfig(root)) {
  return config.installation ? join(reaDirectory(root), "versions", config.installation.directory, "node_modules", "rea-agents") : undefined;
}
export function inspectReaProgram(packageRoot: string, version: string) {
  const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  if (pkg.name !== "rea-agents" || pkg.version !== version || pkg.bin?.rea !== "scripts/rea.mjs") throw Error("REA 安装版本或入口不匹配，请重新安装。");
  const entry = join(packageRoot, "scripts", "rea.mjs");
  const files = [join(packageRoot, "package.json"), entry, join(packageRoot, "dist", "mcp", "main.js")];
  if (files.some(path => !statSync(path).isFile())) throw Error("REA 程序不完整，请重新安装。");
  return { entry, files };
}
export function inspectReaSkill(packageRoot: string) {
  const skillPath = join(packageRoot, "skills", reaSkillName);
  const files = [join(skillPath, "SKILL.md")];
  // The skill's references travel with the package; validating the bundle also
  // detects a partially deleted installation before switching active versions.
  const skill = readFileSync(join(skillPath, "SKILL.md"), "utf8");
  for (const match of skill.matchAll(/\]\((references\/[a-zA-Z0-9_./-]+\.md)(?:#[^)]*)?\)/g)) {
    if (match[1].split("/").includes("..")) throw Error("REA 技能引用路径无效。");
    files.push(join(skillPath, match[1]));
  }
  if (files.some(path => !statSync(path).isFile())) throw Error("REA 技能文件不完整，请重新安装 REA 恢复官方文件。");
  return { skillPath, files: [...new Set(files)] };
}
export function inspectReaPackage(packageRoot: string, version: string) {
  const program = inspectReaProgram(packageRoot, version), skill = inspectReaSkill(packageRoot);
  return { ...program, skillPath: skill.skillPath, files: [...program.files, ...skill.files] };
}
