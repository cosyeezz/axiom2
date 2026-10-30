import { builtinDirectoryRecorded, assertBuiltinDirectoryOwned, assertBuiltinFilesSafe, builtinRemovalDirectories, markBuiltinRemovals, forgetBuiltinDirectory } from "./builtin-operation.js";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/protocol.js";
import type { ReaEngineId } from "../../shared/rea-engines.js";
import { maintenancePhase } from "../maintenance.js";
import { managedChildren, managedDirectory, removeManagedDirectory } from "./managed-removal.js";
import { cleanupScope, assertCleanupScope } from "./cleanup-scope.js";
import { componentChildren, forceRemoveComponentPaths } from "./component-maintenance.js";
import { atomicReaJson, readReaConfig, reaConfigPath, reaDirectory, reaEngineDirectoryPattern, reaProgramDirectoryPattern, type ReaConfig } from "./rea-runtime.js";

export function insideReaDirectory(directory: string, path: string) {
  const suffix = relative(directory, path);
  return !isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`);
}
export function reaRemovalPlan(root: string, fresh: ReaConfig, previousRemovals: string[], engine?: ReaEngineId) {
  const pattern = engine ? reaEngineDirectoryPattern : reaProgramDirectoryPattern;
  const parents = ["integrations", "rea", engine ? "engines" : "versions"];
  const records = engine ? fresh.managedEngines?.[engine] ?? [] : [];
  const pending = [...new Set([...fresh.removalPending ?? [], ...previousRemovals.filter(path => dirname(path) === join(root, ...parents)).map(path => basename(path))])].filter(name => engine ? name.startsWith(`${engine}-`) : reaProgramDirectoryPattern.test(name));
  const children = engine ? [] : managedChildren(root, parents.slice(0, -1), "versions", pattern);
  const owned = children.filter(name => builtinDirectoryRecorded(root, "rea", join(root, ...parents, name)));
  const names = [...new Set([...pending, ...(engine ? records.map(record => record.directory) : [
    ...owned, ...(fresh.installation ? [fresh.installation.directory] : []),
  ])])].sort();
  const unverified = children.filter(name => !names.includes(name)).map(name => join(root, ...parents, name));
  for (const name of names) managedDirectory(root, parents, name, pattern);
  for (const record of records) if (!insideReaDirectory(join(reaDirectory(root), "engines", record.directory), record.path))
    throw Error("组件托管记录与路径不一致，未删除文件。");
  return { names, parents, pattern, pending, records, unverified, paths: names.map(name => join(root, ...parents, name)) };
}
/** Remove only confirmed component-owned files; active sessions are not drained. */
export function removeRea(root: string, revision: string, engine?: ReaEngineId, scopeRevision?: unknown) {
  const fresh = readReaConfig(root);
  if (fresh.revision !== revision) throw new AppError("CONFIGURATION_CONFLICT", "REA 配置已变化，请重新确认卸载。");
  const plan = reaRemovalPlan(root, fresh, builtinRemovalDirectories(), engine), { names, parents, pattern, pending, records } = plan;
  if (engine && !records.length && !pending.length) throw new AppError("EXTERNAL_INSTALLATION", "此组件没有 Axiom 托管记录，请通过原安装方式卸载；仅清空路径不会删除文件。");
  assertCleanupScope(scopeRevision, cleanupScope(plan.paths));
  for (const name of names) {
    const directory = managedDirectory(root, parents, name, pattern);
    if (directory) assertBuiltinDirectoryOwned(directory, pending.includes(name) || (engine ? records.some(record => record.directory === name) : fresh.installation?.directory === name));
  }
  markBuiltinRemovals(plan.paths);
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
/** Reads the configuration, falling back to an empty one so forced maintenance never stalls. */
export function readReaConfigLenient(root: string): ReaConfig {
  try { return readReaConfig(root); } catch { return { format: 1, revision: randomUUID(), enabled: true }; }
}
/**
 * Component standard: forced uninstall. No revision, scope or ownership checks.
 * Program removal deletes every managed version; engine removal deletes the
 * engine's managed directories and clears its path and records.
 */
export function forceRemoveRea(root: string, engine?: ReaEngineId) {
  const base = reaDirectory(root), fresh = readReaConfigLenient(root);
  const container = join(base, engine ? "engines" : "versions");
  const paths = componentChildren(container, engine ? reaEngineDirectoryPattern : reaProgramDirectoryPattern).filter(path => !engine || basename(path).startsWith(`${engine}-`));
  const next: ReaConfig = { ...fresh, revision: randomUUID() };
  if (engine) {
    if (next.managedEngines) { next.managedEngines = { ...next.managedEngines }; delete next.managedEngines[engine]; }
    if (next.engines?.[engine]) { next.engines = { ...next.engines }; delete next.engines[engine]; }
    const pending = next.removalPending?.filter(name => !name.startsWith(`${engine}-`));
    next.removalPending = pending?.length ? pending : undefined;
  } else {
    delete next.installation;
    const pending = next.removalPending?.filter(name => !reaProgramDirectoryPattern.test(name));
    next.removalPending = pending?.length ? pending : undefined;
  }
  maintenancePhase("removing");
  atomicReaJson(reaConfigPath(root), next);
  for (const path of paths) forgetBuiltinDirectory(path);
  forceRemoveComponentPaths(container, paths);
  maintenancePhase("validating");
}
