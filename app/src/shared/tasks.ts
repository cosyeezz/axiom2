import type { Run, Selection } from "./agent.js";
import type { Scope } from "./protocol.js";

export const taskToolNames = [
  "delegate",
  "append",
  "cancel_task",
  "read_result",
] as const;
export type TaskTool = (typeof taskToolNames)[number];
export interface TaskBudgets {
  concurrency: number;
  workMs: number;
  wrapMs: number;
  summaryMs: number;
  cleanupMs: number;
}
export const defaultBudgets: TaskBudgets = {
  concurrency: 4,
  workMs: 600_000,
  wrapMs: 180_000,
  summaryMs: 60_000,
  cleanupMs: 10_000,
};
export type TaskStatus =
  | "queued"
  | "starting"
  | "running"
  | "wrapping"
  | "stopping"
  | "summarizing"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";
export interface Task {
  id: string;
  workspaceId: string;
  parentSessionId: string;
  sessionId: string;
  anchor: string;
  description: string;
  status: TaskStatus;
  runId: string | null;
  createdAt: number;
  budgets: TaskBudgets;
  results: { id: string; runId: string; status: TaskStatus }[];
  pending: number;
  error: string | null;
}
export interface TaskResult {
  id: string;
  taskId: string;
  runId: string;
  status: TaskStatus;
  report: string;
  reason: string | null;
  cleanup: Run["cleanup"];
  startedAt: number;
  endedAt: number;
  unfinished: string[];
  sideEffects: string;
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
  wrapping: "正在收尾",
  stopping: "正在停止",
  summarizing: "停止总结中",
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
    "wrapping",
    "stopping",
    "summarizing",
  ].includes(s);
