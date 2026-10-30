/** Presentation contract for integrated components. Execution remains with the installer.
 * Core maintenance is preemptive: old checks, revisions and running jobs are not gates.
 * Download caches, external installers and parent-owned runtimes stay separate capabilities.
 */
export type ComponentActionId = "check-install" | "check-environment" | "check-versions" | "install" | "update" | "reinstall" | "switch-version" | "repair" | "uninstall" | "download-package" | "install-cached" | "open-installer" | "cleanup-package";
export type ComponentInstallation = "unknown" | "missing" | "installed" | "incomplete";
export type ComponentActionCapability = {
  id: ComponentActionId;
  label: string;
  support?: "supported" | "unsupported" | "unknown";
  /** False means no useful operation, not temporarily busy. */
  applicable?: boolean;
  /** A real adapter prerequisite; never put old revision/check or history gates here. */
  blockedReason?: string;
  conflictsWithTask?: boolean;
  primary?: boolean;
  danger?: boolean;
};
export type ComponentActionContext = { connected: boolean; sending?: boolean; taskRunning?: boolean };
export type ComponentActionState = ComponentActionCapability & { icon: string; available: boolean; reason?: string };
export const componentActionIcons: Readonly<Record<ComponentActionId, string>> = {
  "check-install": "scan-search", "check-environment": "scan-search", "check-versions": "refresh-cw",
  install: "download", update: "arrow-up-to-line", reinstall: "rotate-cw", "switch-version": "switch-version", repair: "repair",
  uninstall: "trash-2", "download-package": "download-package", "install-cached": "install-cached", "open-installer": "open-installer", "cleanup-package": "cleanup-package",
};
const preemptive = new Set<ComponentActionId>(["install", "update", "reinstall", "switch-version", "repair", "uninstall"]);
export function resolveComponentActions(capabilities: readonly ComponentActionCapability[], context: ComponentActionContext): ComponentActionState[] {
  return capabilities.filter(item => (item.support ?? "supported") === "supported" && item.applicable !== false).map(item => {
    const reason = !context.connected ? "连接已断开，操作未发送；请重连后重试。" : context.sending ? "正在提交请求，请稍后重试。" : item.blockedReason
      ?? (!preemptive.has(item.id) && item.conflictsWithTask && context.taskRunning ? "组件正在执行操作，完成或取消后可重试。" : undefined);
    return { ...item, icon: componentActionIcons[item.id], available: !reason, reason };
  });
}

/** Missing versions are not missing installations; unknown comparisons are never called updates.
 * A repair-by-reinstall adapter must actually force a fresh install and disclose that strategy.
 */
export function componentInstallAction(options: { label: string; installation: ComponentInstallation; version?: string; target?: string; targetLabel?: "推荐" | "最新"; compare?: (a: string, b: string) => number | undefined; repairByReinstall?: boolean }): ComponentActionCapability {
  const { label, installation, version, target, targetLabel = "最新", repairByReinstall } = options;
  if (installation === "missing" || installation === "unknown") return { id: "install", label: `安装 ${label}`, primary: true };
  if (installation === "incomplete" && repairByReinstall) return { id: "repair", label: `修复 ${label}（重新安装）`, primary: true };
  const comparison = version && target ? (options.compare ?? compareComponentVersions)(target, version) : undefined;
  if (comparison === 0) return { id: "reinstall", label: `重新安装 ${label}`, primary: true };
  if (comparison !== undefined && comparison > 0) return { id: "update", label: `更新 ${label}`, primary: true };
  if (comparison !== undefined && comparison < 0) return { id: "switch-version", label: `切换 ${label} 至${targetLabel}版`, primary: true };
  return { id: "reinstall", label: `重新安装 ${label}`, primary: true };
}

/** Stable numeric versions only. Adapters own special build/prerelease comparisons. */
export function compareComponentVersions(a: string, b: string): number | undefined {
  if (!/^v?\d+(?:\.\d+){0,3}$/.test(a) || !/^v?\d+(?:\.\d+){0,3}$/.test(b)) return;
  const left = a.replace(/^v/, "").split(".").map(Number), right = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) > (right[i] ?? 0) ? 1 : -1;
  return 0;
}
