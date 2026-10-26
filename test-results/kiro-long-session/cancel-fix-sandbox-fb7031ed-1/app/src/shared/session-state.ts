import { activeStatus, runLabels, type RetryInfo, type Run, type RunPhase } from "./agent.js";

export const canContinue = (run: Run | null | undefined) =>
  !!run && ["failed", "cancelled", "interrupted"].includes(run.status);

const phaseLabels: Record<RunPhase, string> = {
  initializing: "初始化", requesting: "请求中", generating: "生成中",
  executing_tools: "执行工具", retry_wait: "等待重试", retrying: "重试中",
  compacting: "压缩中", settling: "收尾中",
};
/** Sidebar state; unread never hides activity. */
export function sessionState(value: {
  runStatus?: Run["status"]; phase?: RunPhase | null; retry?: RetryInfo | null;
  reasonCode?: string | null; activeTasks?: boolean; activeTaskCount?: number; unread?: boolean;
}) {
  const active = activeStatus(value.runStatus) || !!value.activeTasks || !!value.activeTaskCount;
  const label = value.runStatus === "stopping" ? runLabels.stopping
    : value.runStatus === "starting" ? phaseLabels.initializing
    : value.runStatus === "running"
      ? value.phase ? phaseLabels[value.phase] : runLabels.running
      : value.activeTasks || value.activeTaskCount
        ? `子任务活动中${value.activeTaskCount ? `（${value.activeTaskCount}）` : ""}`
        : value.reasonCode === "OUTPUT_TRUNCATED" ? "输出截断，可继续处理"
        : value.runStatus ? runLabels[value.runStatus] : "尚未运行";
  const retry = value.retry;
  return {
    active,
    indicator: active ? "running" : value.unread ? "unread" : null,
    indicatorLabel: active ? "运行中" : value.unread ? "未读" : "",
    label: label + (active && retry && ["waiting", "retrying"].includes(retry.state)
      ? `（${retry.attempt}/${retry.maxAttempts}）` : ""),
  };
}
