import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import type { OpenCliSettings } from "../../shared/builtin-tools.js";

export const openCliSkillNames = ["opencli-usage", "opencli-browser"];
export type OpenCliConfig = OpenCliSettings & {
  format: 1;
  revision: string;
  packageRoot: string;
  binDirectory: string;
};
export const openCliConfigPath = (root: string) => join(root, "integrations", "opencli.json");
export function readOpenCliConfig(root: string): OpenCliConfig | undefined {
  try {
    const value = JSON.parse(readFileSync(openCliConfigPath(root), "utf8"));
    if (value.format !== 1 || typeof value.revision !== "string" || !value.revision ||
      typeof value.packageRoot !== "string" || !isAbsolute(value.packageRoot) ||
      typeof value.binDirectory !== "string" || !isAbsolute(value.binDirectory) ||
      typeof value.enabled !== "boolean" || typeof value.profile !== "string" || value.profile.length > 128 ||
      /[\x00-\x1f\x7f]/.test(value.profile) || !["foreground", "background"].includes(value.window)) throw Error();
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw Error("OpenCLI 配置无法读取，请检查 integrations/opencli.json；未覆盖原文件。");
  }
}
export function openCliEnvironment(config: OpenCliConfig, source = process.env): NodeJS.ProcessEnv {
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
  if (!config.enabled) return [];
  const paths = openCliSkillNames.map((name) => join(config.packageRoot, "skills", name));
  if (paths.some((path) => !existsSync(join(path, "SKILL.md"))))
    throw Error("OpenCLI 常用技能缺失，请到配置 → 内置工具重新检查或安装。");
  return paths;
}
