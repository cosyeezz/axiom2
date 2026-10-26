import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import type { CleanupScope } from "../../shared/cleanup-scope.js";

/** Paths must first come from the tool's fixed-root, validated removal plan. */
export function cleanupScope(candidates: string[]): CleanupScope {
  const paths = [...new Set(candidates)].sort();
  if (paths.length > 1024) throw Error("卸载对象超过核实上限，未执行清理。");
  const identities = paths.map(path => {
    try {
      const stat = lstatSync(path, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("卸载目录身份无效，请重新核实。");
      return [path, String(stat.dev), String(stat.ino), String(stat.mtimeNs)];
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return [path, "missing"]; throw error; }
  });
  return { paths, revision: createHash("sha256").update(JSON.stringify(identities)).digest("hex") };
}
export function assertCleanupScope(expected: unknown, actual: CleanupScope) {
  // Existing tool-management clients confirm the entire managed installation.
  // Desktop path previews additionally bind the exact candidate identities.
  if (expected !== undefined && (typeof expected !== "string" || expected !== actual.revision)) throw Error("卸载范围已变化，请重新查看路径并确认。");
}
