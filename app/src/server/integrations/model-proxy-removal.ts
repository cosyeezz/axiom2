import { assertToolProcessesStopped } from "./rtk-process.js";
import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
import { recoverProcessOwner } from "../process-owner-record.js";
import { activeProxyOwner } from "./model-proxy-guardian.js";
import { join } from "node:path";
import type { ProxyKernel } from "../../shared/model-proxy.js";
import { managedChildren, managedDirectory, removeManagedDirectory } from "./managed-removal.js";
import { proxyImporterDirectoryPattern, proxyVersionDirectoryPattern, type ProxyConfig } from "./model-proxy-config.js";

export function assertProxyStopped(root: string, kernel: ProxyKernel) {
  assertToolProcessesStopped(root);
  assertOwners(root, kernel, false);
}
export function assertProxyCanStart(root: string, kernel: ProxyKernel) {
  assertOwners(root, kernel, true);
}
function assertOwners(root: string, kernel: ProxyKernel, allowActive: boolean) {
  const parents = ["integrations", "model-proxy"], pattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  for (const run of managedChildren(root, parents, "runs", pattern)) {
    const path = join(root, ...parents, "runs", run, "owner.json"), journal = join(root, ...parents, "runs", run, "process-owner.json");
    if (allowActive && activeProxyOwner(path)) continue;
    let owner: { kernel?: string } | undefined;
    try {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error("代理归属路径无效。");
      owner = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw Error("无法核实历史代理进程状态，未修改程序文件。");
      if (!existsSync(journal)) continue;
    }
    if (recoverProcessOwner(journal)) { rmSync(path, { force: true }); continue; }
    if (!owner || !["xray", "mihomo"].includes(owner.kernel ?? "") || owner.kernel === kernel) throw Error("尚有代理进程未确认退出，未启动新内核或删除程序文件；请检查后台进程后重试。");
  }
}

export function proxyImporterRemovalPlan(root: string, config: ProxyConfig, verifyStopped = true) {
  const parents = ["integrations", "model-proxy", "importer"];
  const names = [...new Set([...managedChildren(root, parents.slice(0, -1), "importer", proxyImporterDirectoryPattern), ...(config.removalPending ?? []).filter(name => proxyImporterDirectoryPattern.test(name))])];
  for (const name of names) {
    const directory = managedDirectory(root, parents, name, proxyImporterDirectoryPattern);
    if (directory && verifyStopped) assertToolProcessesStopped(directory);
  }
  return { names, remove() { for (const name of names) removeManagedDirectory(root, parents, name, proxyImporterDirectoryPattern); } };
}

export function proxyRemovalPlan(root: string, kernel: ProxyKernel, config: ProxyConfig) {
  const parents = ["integrations", "model-proxy"];
  const versions = managedChildren(root, parents, "versions", new RegExp(proxyVersionDirectoryPattern.source.replace("(xray|mihomo)", kernel)));
  const names = [...new Set([...versions, ...(config.installations[kernel] ? [config.installations[kernel]!.directory] : []), ...(config.removalPending ?? []).filter(name => proxyVersionDirectoryPattern.test(name) && name.startsWith(`${kernel}-`))])];
  const target = (name: string) => proxyImporterDirectoryPattern.test(name)
    ? { parents: [...parents, "importer"], pattern: proxyImporterDirectoryPattern }
    : { parents: [...parents, "versions"], pattern: proxyVersionDirectoryPattern };
  for (const name of names) { const at = target(name); managedDirectory(root, at.parents, name, at.pattern); }
  return { names, remove() { for (const name of names) { const at = target(name); removeManagedDirectory(root, at.parents, name, at.pattern); } } };
}
