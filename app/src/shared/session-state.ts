import { activeStatus, runLabels, type RetryInfo, type Run, type RunPhase } from "./agent.js";

export const canContinue = (run: Run | null | undefined) =>
  !!run && ["failed", "cancelled", "interrupted"].includes(run.status);

const phaseLabels: Record<RunPhase, string> = {
  initializing: "正在初始化", requesting: "正在请求模型", generating: "正在生成回复",
  executing_tools: "正在执行工具", retry_wait: "等待重试", retrying: "正在重试",
  compacting: "正在压缩上下文", settling: "正在结算",
};
/** Sidebar state; unread never hides activity. */
export function sessionState(value: {
  runStatus?: Run["status"]; phase?: RunPhase | null; retry?: RetryInfo | null;
  reasonCode?: string | null; activeTasks?: boolean; activeTaskCount?: number; unread?: boolean;
}) {
  const active = activeStatus(value.runStatus) || !!value.activeTasks || !!value.activeTaskCount;
  const label = value.runStatus === "stopping" ? runLabels.stopping
    : value.runStatus === "starting" ? runLabels.starting
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
