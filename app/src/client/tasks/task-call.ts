import type { ChatMessage } from "../../shared/agent.js";
import type { TaskResult, TaskTool } from "../../shared/tasks.js";
import type { ToolStatus } from "../chat/tool-summary.js";

export function callObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

export function taskCallStatus(result: ChatMessage | null, message: ChatMessage): ToolStatus {
  if (result?.error) return "failed";
  if (result?.status) return result.status;
  if (message.status === "cancelled") return "cancelled";
  // A finished assistant tool-call message does not prove the tool ran successfully.
  return message.streaming ? "running" : "unknown";
}

export function taskCallLabel(name: TaskTool, status: ToolStatus, output: Record<string, unknown> | null): string {
  if (status === "failed") return name === "delegate" ? "委派失败" : name === "read_result" ? "读取失败" : name === "append" ? "追加失败" : "停止失败";
  if (status === "cancelled") return "调用已停止";
  if (status === "unknown") return "未确认完成";
  if (status === "running") return name === "delegate" ? "正在创建" : name === "read_result" ? "读取中" : "提交中";
  if (name === "delegate") return "已创建";
  if (name === "read_result") return "已读取";
  if (name === "append") return "已受理";
  // A cancellation receipt may only acknowledge a stop request, not termination.
  return output?.status === "cancelled" ? "已停止" : output?.status === "completed" || output?.status === "failed" || output?.status === "interrupted" ? "任务已结束" : "停止已受理";
}

export function readTaskReport(text: string, input: Record<string, unknown> | null): TaskResult | null {
  const value = callObject(text);
  if (!value || value.id !== input?.resultId || value.taskId !== input?.taskId ||
    typeof value.report !== "string" || typeof value.runId !== "string" ||
    !["completed", "failed", "cancelled", "interrupted"].includes(String(value.status)) ||
    !Array.isArray(value.unfinished) || !value.unfinished.every((item) => typeof item === "string") ||
    typeof value.sideEffects !== "string" || (value.reason !== null && typeof value.reason !== "string")) return null;
  return value as unknown as TaskResult;
}
