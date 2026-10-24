import { assertBuiltinDirectoryOwned, assertBuiltinFilesSafe, builtinRemovalDirectories, markBuiltinRemovals, forgetBuiltinDirectory } from "./builtin-operation.js";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/protocol.js";
import type { ReaEngineId } from "../../shared/rea-engines.js";
import { maintenancePhase } from "../maintenance.js";
import { managedChildren, managedDirectory, removeManagedDirectory } from "./managed-removal.js";
import { atomicReaJson, readReaConfig, reaConfigPath, reaDirectory, reaEngineDirectoryPattern, reaProgramDirectoryPattern } from "./rea-runtime.js";

export function insideReaDirectory(directory: string, path: string) {
  const suffix = relative(directory, path);
  return !isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`);
}
/** Called only while the application's worker maintenance barrier is held. */
export function removeRea(root: string, revision: string, engine?: ReaEngineId) {
  const fresh = readReaConfig(root);
  if (fresh.revision !== revision) throw new AppError("CONFIGURATION_CONFLICT", "REA 配置已变化，请重新确认卸载。");
  const pattern = engine ? reaEngineDirectoryPattern : reaProgramDirectoryPattern;
  const parents = ["integrations", "rea", engine ? "engines" : "versions"];
  const records = engine ? fresh.managedEngines?.[engine] ?? [] : [];
  const pending = [...new Set([...fresh.removalPending ?? [], ...builtinRemovalDirectories().map(path => basename(path))])].filter(name => engine ? name.startsWith(`${engine}-`) : reaProgramDirectoryPattern.test(name));
  if (engine && !records.length && !pending.length) throw new AppError("EXTERNAL_INSTALLATION", "此组件没有 Axiom 托管记录，请通过原安装方式卸载；仅清空路径不会删除文件。");
  const names = [...new Set([...pending, ...(engine ? records.map(record => record.directory) : [
    ...managedChildren(root, parents.slice(0, -1), "versions", pattern), ...(fresh.installation ? [fresh.installation.directory] : []),
  ])])];
  for (const name of names) {
    const directory = managedDirectory(root, parents, name, pattern);
    if (directory) assertBuiltinDirectoryOwned(directory, pending.includes(name) || (engine ? records.some(record => record.directory === name) : fresh.installation?.directory === name));
  }
  for (const record of records) if (!insideReaDirectory(join(reaDirectory(root), "engines", record.directory), record.path))
    throw Error("组件托管记录与路径不一致，未删除文件。");
  markBuiltinRemovals(names.map(name => join(root, ...parents, name)));
  const next = { ...fresh, revision: randomUUID(), removalPending: [...new Set([...(fresh.removalPending ?? []), ...names])] };
  if (engine) {
    next.managedEngines = { ...fresh.managedEngines }; delete next.managedEngines[engine];
    const path = fresh.engines?.[engine];
    if (path && names.some(name => insideReaDirectory(join(reaDirectory(root), "engines", name), path))) {
      next.engines = { ...fresh.engines }; delete next.engines[engine];
    }
  } else { delete next.installation; }
  maintenancePhase("removing");
  atomicReaJson(reaConfigPath(root), next);
  try { for (const name of names) {
    assertBuiltinFilesSafe(); removeManagedDirectory(root, parents, name, pattern);
    // Keep the deleted inode while removalPending can still authorize a retry.
  } }
  catch { throw Error("安装引用已移除，部分程序文件未能删除；解除占用后可重试清理。设置和外部组件未删除。"); }
  maintenancePhase("validating");
  const remaining = next.removalPending.filter(name => !names.includes(name));
  atomicReaJson(reaConfigPath(root), { ...next, removalPending: remaining.length ? remaining : undefined });
  for (const name of names) forgetBuiltinDirectory(join(root, ...parents, name));
}
