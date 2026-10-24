export type MaintenanceEndpoint = "backend" | "browser" | "desktop";
export type MaintenancePhase = "queued" | "checking" | "downloading" | "verifying" | "installing" | "validating" | "removing";
export type MaintenanceStatus = "running" | "cancelling" | "succeeded" | "failed" | "cancelled" | "interrupted" | "unknown";
export type MaintenanceErrorCode = "cancelled" | "headers-timeout" | "idle-timeout" | "install-timeout" | "total-timeout" | "network" | "http" | "output-limit" | "stop-unconfirmed" | "operation";
export type MaintenanceBudgets = { headersMs: number; idleMs: number; installMs: number; totalMs: number };
export const defaultMaintenanceBudgets: MaintenanceBudgets = { headersMs: 30_000, idleMs: 60_000, installMs: 600_000, totalMs: 1_200_000 };
export const maintenanceBudgetLabels: Record<keyof MaintenanceBudgets, string> = { headersMs: "等待响应头", idleMs: "下载无数据等待", installMs: "安装阶段", totalMs: "任务总时限" };
export const maintenancePhaseLabels: Record<MaintenancePhase, string> = { queued: "排队", checking: "检查", downloading: "下载", verifying: "校验", installing: "安装", validating: "验证", removing: "清理" };
export const maintenanceStatusLabels: Record<MaintenanceStatus, string> = { running: "进行中", cancelling: "正在取消", succeeded: "已完成", failed: "未完成", cancelled: "已取消", interrupted: "已中断，需核实", unknown: "结果待核实" };
export type MaintenanceTransfer = { received: number; total?: number; bytesPerSecond?: number; updatedAt: number; source?: string; connection: "connecting" | "receiving" | "waiting" | "retrying" | "finished"; attempt?: number; retryAt?: number };
export type MaintenanceTask = {
  id: string; resource: string; label: string; action: string; endpoint: MaintenanceEndpoint;
  scope: string; attemptId: string; previousAttemptId?: string; status: MaintenanceStatus;
  phase: MaintenancePhase; steps: MaintenancePhase[]; completedSteps: number;
  createdAt: number; startedAt?: number; updatedAt: number; finishedAt?: number;
  message?: string; transfer?: MaintenanceTransfer; budgets: MaintenanceBudgets;
  capabilities: { cancel: boolean; extend: boolean };
  error?: { code: MaintenanceErrorCode; message: string; phase: MaintenancePhase };
};
export type MaintenanceState = { tasks: MaintenanceTask[]; budgets: MaintenanceBudgets; error?: string };
export const emptyMaintenanceState: MaintenanceState = { tasks: [], budgets: defaultMaintenanceBudgets };
export function maintenanceActive(task: MaintenanceTask) { return task.status === "running" || task.status === "cancelling"; }
export function retainMaintenanceTasks(tasks: MaintenanceTask[], recent = 100) {
  const completed = tasks.filter(task => !maintenanceActive(task) && task.status !== "unknown" && task.status !== "interrupted").slice(-recent);
  const keep = new Set(completed);
  return tasks.filter(task => maintenanceActive(task) || task.status === "unknown" || task.status === "interrupted" || keep.has(task));
}
export function validMaintenanceBudgets(value: unknown): value is MaintenanceBudgets {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return Object.keys(p).length === 4 && Object.keys(defaultMaintenanceBudgets).every(key => Number.isSafeInteger(p[key]) && Number(p[key]) >= 1000 && Number(p[key]) <= 86_400_000);
}
export function validMaintenanceTask(value: unknown): value is MaintenanceTask {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const task = value as MaintenanceTask;
  const phase = (v: unknown) => typeof v === "string" && Object.hasOwn(maintenancePhaseLabels, v);
  const time = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (![task.id, task.attemptId, task.resource, task.label, task.action, task.scope].every(v => typeof v === "string" && v.length > 0)
    || !["backend", "browser", "desktop"].includes(task.endpoint) || !Object.hasOwn(maintenanceStatusLabels, task.status)
    || !phase(task.phase) || !Array.isArray(task.steps) || !task.steps.every(phase)
    || !Number.isSafeInteger(task.completedSteps) || task.completedSteps < 0 || task.completedSteps > task.steps.length
    || !time(task.createdAt) || !time(task.updatedAt) || task.startedAt !== undefined && !time(task.startedAt) || task.finishedAt !== undefined && !time(task.finishedAt)
    || !validMaintenanceBudgets(task.budgets) || typeof task.capabilities?.cancel !== "boolean" || typeof task.capabilities?.extend !== "boolean"
    || task.message !== undefined && typeof task.message !== "string" || task.previousAttemptId !== undefined && typeof task.previousAttemptId !== "string") return false;
  if (task.error !== undefined && (!task.error || typeof task.error !== "object" || typeof task.error.message !== "string" || !phase(task.error.phase) || !["cancelled", "headers-timeout", "idle-timeout", "install-timeout", "total-timeout", "network", "http", "output-limit", "stop-unconfirmed", "operation"].includes(task.error.code))) return false;
  const transfer = task.transfer;
  return transfer === undefined || !!transfer && typeof transfer === "object" && time(transfer.received) && time(transfer.updatedAt) && ["connecting", "receiving", "waiting", "retrying", "finished"].includes(transfer.connection)
    && (transfer.total === undefined || time(transfer.total)) && (transfer.bytesPerSecond === undefined || time(transfer.bytesPerSecond))
    && (transfer.source === undefined || typeof transfer.source === "string") && (transfer.retryAt === undefined || time(transfer.retryAt))
    && (transfer.attempt === undefined || Number.isSafeInteger(transfer.attempt) && transfer.attempt >= 0);
}
export class MaintenanceError extends Error {
  constructor(readonly code: MaintenanceErrorCode, message: string) { super(message); this.name = "MaintenanceError"; }
}
