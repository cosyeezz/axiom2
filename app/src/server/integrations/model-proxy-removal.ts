import { assertToolProcessesStopped } from "./rtk-process.js";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ProxyKernel } from "../../shared/model-proxy.js";
import { managedChildren, managedDirectory, removeManagedDirectory } from "./managed-removal.js";
import { proxyImporterDirectoryPattern, proxyVersionDirectoryPattern, readProxyConfig, type ProxyConfig } from "./model-proxy-config.js";
import { installedKernelPids, pidAlive, readKernelRecord, terminateInstalledKernels, terminatePid } from "./model-proxy-kernel.js";
import { componentChildren, forceRemoveComponentPaths } from "./component-maintenance.js";

export function assertProxyStopped(root: string, kernel: ProxyKernel, paths = proxyRemovalPlan(root, kernel, readProxyConfig(root)).paths) {
  // Check only this component's importer/core processes, not unrelated runtime
  // tools registered at the application root. Session work is never drained.
  // Importer workers use the maintenance process registry; cores use native PID enumeration.
  const corePaths = paths.filter(path => !proxyImporterDirectoryPattern.test(basename(path)));
  for (const path of paths) if (proxyImporterDirectoryPattern.test(basename(path))) assertToolProcessesStopped(path);
  const alive = corePaths.length ? installedKernelPids(corePaths.map(path => join(path, kernel + (process.platform === "win32" ? ".exe" : ""))), true) : [];
  if (alive.length) throw Error(`尚有代理进程未确认退出（PID ${alive.join(", ")}），未删除程序文件；请停止线路后重试。`);
}
/** 启动前清理上一轮遗留的内核：先按记录的 PID 结束，再扫描安装目录兜底。
 * 线路由后台直接托管（只有 PID 记录），不再要求守护进程握手。
 * except 用于保护同一服务内仍存活的线路：它们的 PID 不应被其他线路的启动或停止误杀。 */
export async function assertProxyCanStart(root: string, kernel: ProxyKernel, except: number[] = []) {
  const parents = ["integrations", "model-proxy"], pattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  for (const run of managedChildren(root, parents, "runs", pattern)) {
    const directory = join(root, ...parents, "runs", run);
    const record = readKernelRecord(directory);
    if (record && pidAlive(record.pid) && !except.includes(record.pid)) await terminatePid(record.pid).catch(() => {});
  }
  const installation = readInstallation(root, kernel);
  if (installation) for (const pid of installedKernelPids(installation)) { if (!except.includes(pid)) await terminatePid(pid).catch(() => {}); }
}
function readInstallation(root: string, kernel: ProxyKernel) {
  try {
    const config = JSON.parse(readFileSync(join(root, "integrations", "model-proxy", "config.json"), "utf8"));
    const install = config?.installations?.[kernel];
    if (typeof install?.directory !== "string" || !proxyVersionDirectoryPattern.test(install.directory)) return undefined;
    return join(root, "integrations", "model-proxy", "versions", install.directory, kernel + (process.platform === "win32" ? ".exe" : ""));
  } catch { return undefined; }
}

export function proxyRemovalPlan(root: string, kernel: ProxyKernel, config: ProxyConfig) {
  const parents = ["integrations", "model-proxy"];
  const versions = managedChildren(root, parents, "versions", new RegExp(proxyVersionDirectoryPattern.source.replace("(xray|mihomo)", kernel)));
  const importers = kernel === "xray" ? managedChildren(root, parents, "importer", proxyImporterDirectoryPattern) : [];
  const names = [...new Set([...versions, ...importers, ...(config.installations[kernel] ? [config.installations[kernel]!.directory] : []), ...(config.removalPending ?? []).filter(name => kernel === "xray" && proxyImporterDirectoryPattern.test(name) || proxyVersionDirectoryPattern.test(name) && name.startsWith(`${kernel}-`))])];
  const target = (name: string) => proxyImporterDirectoryPattern.test(name)
    ? { parents: [...parents, "importer"], pattern: proxyImporterDirectoryPattern }
    : { parents: [...parents, "versions"], pattern: proxyVersionDirectoryPattern };
  for (const name of names) { const at = target(name); managedDirectory(root, at.parents, name, at.pattern); }
  return { names, paths: names.map(name => join(root, ...target(name).parents, name)), remove() { for (const name of names) { const at = target(name); removeManagedDirectory(root, at.parents, name, at.pattern); } } };
}
/**
 * Component standard: forced kernel uninstall. Running cores from any managed
 * version of this kernel are terminated (importer workers stop with the aborted
 * operation), then every managed directory of the kernel is deleted.
 */
export async function forceRemoveProxyKernel(root: string, kernel: ProxyKernel) {
  const base = join(root, "integrations", "model-proxy");
  const versions = componentChildren(join(base, "versions"), new RegExp(proxyVersionDirectoryPattern.source.replace("(xray|mihomo)", kernel)));
  const importers = kernel === "xray" ? componentChildren(join(base, "importer"), proxyImporterDirectoryPattern) : [];
  const binary = kernel + (process.platform === "win32" ? ".exe" : "");
  for (const directory of versions) {
    const executable = join(directory, binary);
    // Any process started from a directory about to be deleted is stopped,
    // whatever its arguments. An unavailable process list never blocks removal.
    let pids: number[];
    try { pids = installedKernelPids(executable, true); } catch { pids = []; }
    for (const pid of pids) { try { await terminatePid(pid); } catch { /* Deletion proceeds; leftovers can be retried. */ } }
    await terminateInstalledKernels(executable);
  }
  forceRemoveComponentPaths(join(base, "versions"), versions);
  forceRemoveComponentPaths(join(base, "importer"), importers);
}
