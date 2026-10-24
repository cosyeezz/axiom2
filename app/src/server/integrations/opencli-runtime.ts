import { accessSync, constants, existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { managedDirectory } from "./managed-removal.js";
import type { OpenCliSettings } from "../../shared/builtin-tools.js";

export const openCliSkillNames = ["opencli-usage", "opencli-browser"];
export type OpenCliConfig = OpenCliSettings & {
  format: 1;
  revision: string;
  packageRoot: string;
  binDirectory: string;
  directory?: string;
  detached?: boolean;
  removalPending?: string[];
  migration?: { packageRoot: string; version?: string; at: number; externalFilesRetained: true };
};
export const openCliVersionPattern = /^v\d+\.\d+\.\d+-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const openCliVersionPaths = (root: string, directory: string) => {
  if (!openCliVersionPattern.test(directory)) throw Error("OpenCLI 托管目录记录无效。");
  const prefix = join(root, "integrations", "opencli", "versions", directory);
  return { prefix, packageRoot: join(prefix, "node_modules", "@jackwener", "opencli"), binDirectory: join(prefix, "node_modules", ".bin") };
};
export const openCliConfigPath = (root: string) => join(root, "integrations", "opencli.json");
export function readOpenCliConfig(root: string): OpenCliConfig | undefined {
  try {
    const value = JSON.parse(readFileSync(openCliConfigPath(root), "utf8"));
    if (value.format !== 1 || typeof value.revision !== "string" || !value.revision ||
      typeof value.packageRoot !== "string" || (value.detached ? value.packageRoot !== "" : !isAbsolute(value.packageRoot)) ||
      typeof value.binDirectory !== "string" || (value.detached ? value.binDirectory !== "" : !isAbsolute(value.binDirectory)) ||
      (value.detached !== undefined && typeof value.detached !== "boolean") ||
      typeof value.enabled !== "boolean" || typeof value.profile !== "string" || value.profile.length > 128 ||
      /[\x00-\x1f\x7f]/.test(value.profile) || !["foreground", "background"].includes(value.window)) throw Error();
    if (value.directory !== undefined) {
      const paths = openCliVersionPaths(root, value.directory);
      if (value.detached || resolve(value.packageRoot) !== resolve(paths.packageRoot) || resolve(value.binDirectory) !== resolve(paths.binDirectory)) throw Error();
      managedDirectory(root, ["integrations", "opencli", "versions"], value.directory, openCliVersionPattern);
    }
    if (value.removalPending !== undefined && (!Array.isArray(value.removalPending) || value.removalPending.some((name: unknown) => typeof name !== "string" || !openCliVersionPattern.test(name)))) throw Error();
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw Error("OpenCLI 配置无法读取，请检查 integrations/opencli.json；未覆盖原文件。");
  }
}
export function openCliEnvironment(config: OpenCliConfig, source = process.env): NodeJS.ProcessEnv {
  if (config.detached) return { ...source };
  const env = { ...source };
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  const previous = env[pathKey] ?? "";
  for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") delete env[key];
  env.PATH = [config.binDirectory, dirname(process.execPath), previous].filter(Boolean).join(delimiter);
  // Empty profile follows OpenCLI's own saved default; don't inherit a stale override.
  delete env.OPENCLI_PROFILE;
  if (config.profile) env.OPENCLI_PROFILE = config.profile;
  env.OPENCLI_WINDOW = config.window;
  return env;
}
export function openCliSkillPaths(config: OpenCliConfig): string[] {
  if (!config.enabled || config.detached) return [];
  const paths = openCliSkillNames.map((name) => join(config.packageRoot, "skills", name));
  if (paths.some((path) => !existsSync(join(path, "SKILL.md"))))
    throw Error("OpenCLI 常用技能缺失，请到配置 → 内置工具重新检查或安装。");
  return paths;
}
/** Apply only managed environment keys; reload must not accumulate old version paths. */
export function applyOpenCliEnvironment(target: NodeJS.ProcessEnv, source: NodeJS.ProcessEnv) {
  const managed = (key: string) => key.toUpperCase() === "PATH" || key === "OPENCLI_PROFILE" || key === "OPENCLI_WINDOW";
  for (const key of Object.keys(target)) if (managed(key)) delete target[key];
  for (const [key, value] of Object.entries(source)) if (managed(key)) target[key] = value;
}
export function validateOpenCliPackage(config: OpenCliConfig, expected?: string) {
  if (config.directory) {
    const prefix = resolve(config.packageRoot, "../../..");
    managedDirectory(prefix, ["node_modules", "@jackwener"], "opencli", /^opencli$/);
    managedDirectory(prefix, ["node_modules"], ".bin", /^\.bin$/);
  }
  const packageRoot = realpathSync(config.packageRoot);
  const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  if (pkg.name !== "@jackwener/opencli" || typeof pkg.version !== "string" || !/^\d+\.\d+\.\d+$/.test(pkg.version) || (expected && pkg.version !== expected) || typeof pkg.bin?.opencli !== "string") throw Error("OpenCLI 安装信息或版本无效，请重新安装。");
  const entry = realpathSync(resolve(packageRoot, pkg.bin.opencli));
  if (!entry.startsWith(packageRoot + sep)) throw Error("OpenCLI 程序入口超出安装目录。");
  for (const path of openCliSkillPaths({ ...config, enabled: true })) {
    if (!realpathSync(join(path, "SKILL.md")).startsWith(packageRoot + sep)) throw Error("OpenCLI 技能超出安装目录。");
  }
  const shim = join(config.binDirectory, process.platform === "win32" ? "opencli.cmd" : "opencli");
  accessSync(shim, process.platform === "win32" ? constants.R_OK : constants.X_OK);
  if (config.directory) {
    if (process.platform === "win32") {
      for (const suffix of [".cmd", ".ps1"]) if (lstatSync(join(config.binDirectory, `opencli${suffix}`)).isSymbolicLink()) throw Error("OpenCLI 命令入口指向外部文件。");
    } else if (realpathSync(shim) !== entry) throw Error("OpenCLI 命令入口与托管程序不一致。");
  }
  return { entry, version: pkg.version as string };
}
