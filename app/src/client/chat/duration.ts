import { running, type AgentInfo } from "../../shared/agent.js";

/** Completed executions plus only the active execution, never the idle gaps. */
export function sessionDuration(info: AgentInfo, now: number): number | null {
  if (!info.run || info.completedRunDurationMs == null) return null;
  const activeMs = running(info.run) && info.run.endedAt == null
    ? Math.max(0, now - info.run.startedAt)
    : 0;
  return (info.completedRunDurationMs + activeMs) / 1000;
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
