import { running, type AgentInfo } from "../../shared/agent.js";

/** Completed executions plus the active execution; older servers expose only the latest run. */
export function sessionDuration(info: AgentInfo, now: number): number | null {
  if (!info.run) return null;
  if (info.completedRunDurationMs == null) {
    const end = info.run.endedAt ?? (running(info.run) ? now : null);
    return end == null ? null : Math.max(0, end - info.run.startedAt) / 1000;
  }
  const activeMs = running(info.run) && info.run.endedAt == null
    ? Math.max(0, now - info.run.startedAt)
    : 0;
  return (info.completedRunDurationMs + activeMs) / 1000;
}

/** Keep the displayed metric's scope explicit during a frontend/backend upgrade. */
export function durationTooltip(info: AgentInfo): string {
  if (info.run && info.completedRunDurationMs == null)
    return "最近一次运行时间；累计计时需在任务结束后重启后台服务";
  return `${info.task ? "子会话" : "主会话"}累计运行时间（不含停止后的空闲时间）`;
}

/** Format elapsed time from the largest reached unit down to seconds, capped at days. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const elapsed = Math.floor(Math.max(0, seconds));
  const days = Math.floor(elapsed / 86400);
  const hours = Math.floor((elapsed % 86400) / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const remainder = elapsed % 60;
  let result = "";
  if (days > 0) result += `${days}d`;
  if (elapsed >= 3600) result += `${hours}h`;
  if (elapsed >= 60) result += `${minutes}m`;
  return `${result}${remainder}s`;
}
