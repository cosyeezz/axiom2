import { createHash, randomUUID } from "node:crypto";
import semver from "semver";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { compareEngineVersions, isReaEngineId, type ReaEngineDownload, type ReaEngineId, type ReaEnginePaths } from "../../shared/rea-engines.js";
import { validEnginePaths, discoverEnginePaths, engineEnvironment } from "./rea-engines.js";
import { discoverReaDependencies, reaDependencyEnvironment } from "./rea-auto-environment.js";
import { reaAutoBudget, reaBudgetEnvironment } from "./rea-budget.js";
import { inspectNodeRuntime, validNodeBinding, type NodeRuntimeBinding } from "./managed-node.js";
import { componentEnvironment } from "./component-environment.js";

export const reaSkillName = "reverse-engineer-anything";
export const reaDirectory = (root: string) => join(root, "integrations", "rea");
export const reaConfigPath = (root: string) => join(reaDirectory(root), "config.json");
export const validReaVersion = (value: unknown): value is string => typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value);
export function reaSupportedNode(version = process.versions.node, engines = "^22.19.0 || ^24.11.0 || >=26.0.0") {
  return !!semver.valid(version) && semver.satisfies(version, engines);
}
export const reaProgramDirectoryPattern = /^v\d+\.\d+\.\d+-[a-f0-9-]{36}$/;
export const reaEngineDirectoryPattern = /^(java|ghidra|jadx|wabt)-[a-f0-9-]{36}$/;
export const reaDownloadDirectoryPattern = /^(ghidra|hopper)-[a-f0-9-]{36}$/;
export type ManagedReaEngine = { directory: string; path: string; version?: string };
export type ReaConfig = { format: 1; revision: string; enabled: boolean; skillInstalled?: boolean; mcpInstalled?: boolean; engines?: ReaEnginePaths; downloads?: Partial<Record<ReaEngineId, ReaEngineDownload>>; managedEngines?: Partial<Record<ReaEngineId, ManagedReaEngine[]>>; downloadRemovalPending?: string[]; removalPending?: string[]; installation?: { directory: string; version: string; runtime?: NodeRuntimeBinding } };
// Component confirmations survive commits by other components. Program changes
// still invalidate every confirmation because they change the REA contract.
export function reaEngineRevision(config: ReaConfig, id: ReaEngineId) {
  return createHash("sha256").update(JSON.stringify([
    config.installation?.directory ?? null, config.installation?.version ?? null,
    config.engines?.[id] ?? null,
    (config.managedEngines?.[id] ?? []).map(item => [item.directory, item.path, item.version ?? null]),
    config.downloads?.[id] ? [config.downloads[id]!.directory, config.downloads[id]!.filename, config.downloads[id]!.version] : null,
    (config.removalPending ?? []).filter(name => name.startsWith(`${id}-`)).sort(),
    (config.downloadRemovalPending ?? []).filter(name => name.startsWith(`${id}-`)).sort(),
  ])).digest("hex");
}
function validManagedEngines(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.entries(value).every(([id, records]) =>
    isReaEngineId(id) && id !== "hopper" && Array.isArray(records) && records.every(record => record && typeof record.directory === "string" &&
      reaEngineDirectoryPattern.test(record.directory) && record.directory.startsWith(`${id}-`) && validEnginePaths({ [id]: record.path }) && !!record.path &&
      (record.version === undefined || typeof record.version === "string" && record.version.length <= 80 && compareEngineVersions(record.version, record.version) === 0)));
}
function validDownloads(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.entries(value).every(([id, record]) =>
    ["ghidra", "hopper"].includes(id) && record && typeof record.directory === "string" && reaDownloadDirectoryPattern.test(record.directory) && record.directory.startsWith(`${id}-`) && validReaVersion(record.version) && record.filename === (id === "ghidra" ? "package.zip" : "package.dmg"));
}
export function readReaConfig(root: string): ReaConfig {
  try {
    const value = JSON.parse(readFileSync(reaConfigPath(root), "utf8"));
    if (value.format !== 1 || typeof value.revision !== "string" || !value.revision || typeof value.enabled !== "boolean" ||
        value.skillInstalled !== undefined && typeof value.skillInstalled !== "boolean" ||
        value.mcpInstalled !== undefined && typeof value.mcpInstalled !== "boolean" ||
        value.engines !== undefined && !validEnginePaths(value.engines) ||
        value.downloads !== undefined && !validDownloads(value.downloads) ||
        value.managedEngines !== undefined && !validManagedEngines(value.managedEngines) ||
        value.downloadRemovalPending !== undefined && (!Array.isArray(value.downloadRemovalPending) || value.downloadRemovalPending.some((name: unknown) => typeof name !== "string" || !reaDownloadDirectoryPattern.test(name))) ||
        value.removalPending !== undefined && (!Array.isArray(value.removalPending) || value.removalPending.some((name: unknown) => typeof name !== "string" || !reaProgramDirectoryPattern.test(name) && !reaEngineDirectoryPattern.test(name))) ||
        value.installation && (!validReaVersion(value.installation.version) || typeof value.installation.directory !== "string" ||
          !reaProgramDirectoryPattern.test(value.installation.directory) || value.installation.runtime !== undefined && !validNodeBinding(value.installation.runtime))) throw Error();
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { format: 1, revision: "", enabled: true };
    throw Error("REA 配置无法读取，请检查 integrations/rea/config.json；未覆盖原文件。");
  }
}
export function atomicReaJson(path: string, value: unknown, onPublished?: () => void) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temporary, "wx", 0o600);
    try { writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, path);
    // Keep published candidates even if syncing the containing directory fails.
    onPublished?.();
    if (process.platform !== "win32") {
      const directory = openSync(dirname(path), "r");
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
  }
  finally { rmSync(temporary, { force: true }); }
}
export function reaPackageRoot(root: string, config = readReaConfig(root)) {
  return config.installation ? join(reaDirectory(root), "versions", config.installation.directory, "node_modules", "rea-agents") : undefined;
}
export function reaNode(root: string, config = readReaConfig(root)) {
  const installation = config.installation;
  return installation?.runtime ? inspectNodeRuntime(join(reaDirectory(root), "versions", installation.directory), installation.runtime).node : process.execPath;
}
export function reaProcessEnvironment(root: string, config = readReaConfig(root), source = process.env) {
  const prefix = config.installation ? join(reaDirectory(root), "versions", config.installation.directory) : reaDirectory(root);
  const env = componentEnvironment(join(prefix, "environment"), source, dirname(reaNode(root, config)));
  const budget = reaAutoBudget();
  // Preserve explicit operator choices within the host budget; never register
  // these variables in the backend/system environment.
  const automatic = reaBudgetEnvironment(budget);
  for (const key of Object.keys(automatic)) {
    const value = Number(env[key]);
    if (Number.isSafeInteger(value) && value > 0) automatic[key] = String(Math.max(1, Math.min(value, key === "REA_JADX_HEAP_MIB" ? Math.min(4096, budget.heapMaximumMiB) : budget.cpus)));
  }
  return { ...env, ...reaDependencyEnvironment(discoverReaDependencies(source)), ...engineEnvironment(discoverEnginePaths(config.engines, source)), ...automatic };
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
