import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultRtkSettings, rtkLevels, type RtkSettings } from "../../shared/rtk.js";

export type RtkConfig = RtkSettings & { format: 1; revision: string; installation?: { directory: string; version: string } };
export const rtkDirectory = (root: string) => join(root, "integrations", "rtk");
export const rtkConfigPath = (root: string) => join(rtkDirectory(root), "config.json");
export const rtkVersionPattern = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;
export function atomicRtkJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  try { writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 }); renameSync(temp, path); }
  finally { rmSync(temp, { force: true }); }
}
export function validRtkSettings(value: unknown): value is RtkSettings {
  const p = value as RtkSettings | undefined;
  return !!p && typeof p.enabled === "boolean" && typeof p.subagents === "boolean" && rtkLevels.includes(p.level);
}
export function readRtkConfig(root: string): RtkConfig {
  let value: RtkConfig;
  try { value = JSON.parse(readFileSync(rtkConfigPath(root), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { format: 1, revision: "", ...defaultRtkSettings }; throw Error("RTK 配置无法读取，请检查 integrations/rtk/config.json；未覆盖原配置。"); }
  if (value?.format !== 1 || typeof value.revision !== "string" || !validRtkSettings(value) || (value.installation &&
      (!rtkVersionPattern.test(value.installation.version) || !/^v[\d.]+-[a-f0-9-]{36}$/.test(value.installation.directory))))
    throw Error("RTK 配置无效；未覆盖原配置。");
  return value;
}
export function rtkExecutable(root: string, config: RtkConfig) {
  return config.installation ? join(rtkDirectory(root), "versions", config.installation.directory, process.platform === "win32" ? "rtk.exe" : "rtk") : undefined;
}
export function newerRtk(a: string, b: string) {
  if (!rtkVersionPattern.test(a) || !rtkVersionPattern.test(b)) return false;
  const aa = a.split(".").map(Number), bb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] > bb[i];
  return false;
}
