import type { Selection } from "./agent.js";
import type { Scope } from "./protocol.js";

export const taskToolNames = [
  "delegate",
  "append",
  "cancel_task",
  "read_result",
] as const;
export type TaskTool = (typeof taskToolNames)[number];
/** Normalize pi's optional namespace for presentation, without changing execution names. */
export function taskToolName(name: string): TaskTool | null {
  const normalized = name.replace(/^functions\./, "");
  return taskToolNames.find((tool) => tool === normalized) ?? null;
}
export interface TaskBudgets {
  concurrency: number;
  workMs: number;
}
export const defaultBudgets: TaskBudgets = {
  concurrency: 4,
  workMs: 600_000,
};
export interface TaskPreferences {
  budgets: TaskBudgets;
  selection: Selection | null;
}
export const taskPreferencesScope = "task-preferences";
export type TaskStatus =
  | "queued"
  | "starting"
  | "running"
  | "stopping"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";
export type TaskInputState = "queued" | "unknown" | "accepted" | "delivered" | "failed" | "cancelled";
export type StopSource = "user" | "agent" | "budget" | "parent" | "shutdown" | "provider";
export interface TaskInputReceipt {
  inputId: string;
  runId: string | null;
  state: TaskInputState;
  error: string | null;
}
export interface TaskStop { source: StopSource; reason: string; requestedAt: number }
export interface Task {
  id: string;
  workspaceId: string;
  parentSessionId: string;
  sessionId: string;
  anchor: string;
  title?: string | null;
  description: string;
  status: TaskStatus;
  runId: string | null;
  createdAt: number;
  budgets: TaskBudgets;
  results: { id: string; runId: string; status: TaskStatus }[];
  inputs?: TaskInputReceipt[];
  elapsedMs?: number;
  workStartedAt?: number | null;
  workDeadlineAt?: number | null;
  summaryDeadlineAt?: number | null;
  budgetRevision?: number;
  error: string | null;
}
export interface TaskResult {
  id: string;
  taskId: string;
  runId: string;
  status: TaskStatus;
  report: string;
  reason: string | null;
  startedAt: number;
  endedAt: number;
  unfinished: string[];
  sideEffects: string;
  reportKind?: "final" | "partial" | "system";
  budgetSummary?: boolean;
  stop?: TaskStop;
  elapsedMs?: number;
  totalLength?: number;
  offset?: number;
  truncated?: boolean;
  nextOffset?: number | null;
}
export interface TaskList {
  tasks: Task[];
  frozen: boolean;
  defaultModel: Selection | null;
}
export const emptyTasks: TaskList = {
  tasks: [],
  frozen: false,
  defaultModel: null,
};
export const tasksScope = (s: Scope) => `tasks:${s.workspaceId}:${s.sessionId}`;
export const taskLabels: Record<TaskStatus, string> = {
  queued: "排队中",
  starting: "正在初始化",
  running: "执行中",
  stopping: "正在停止",
  completed: "已完成",
  failed: "失败",
  cancelled: "已停止",
  interrupted: "执行中断",
};
export const taskActive = (s: TaskStatus) =>
  [
    "queued",
    "starting",
    "running",
    "stopping",
  ].includes(s);
