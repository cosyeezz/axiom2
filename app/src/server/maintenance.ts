import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AppError, type Command } from "../shared/protocol.js";
import { defaultMaintenanceBudgets, MaintenanceError, maintenanceActive, validMaintenanceBudgets, type MaintenanceState, type MaintenanceTask, type MaintenancePhase } from "../shared/maintenance.js";
import { MaintenanceExecution, maintenanceFetch } from "../shared/maintenance-runtime.js";

const contexts = new AsyncLocalStorage<MaintenanceExecution>();
const registries = new Map<string, MaintenanceService>();
export const currentMaintenance = () => contexts.getStore();
export const maintainedFetch = (url: string, init?: RequestInit, fetcher?: typeof fetch) => maintenanceFetch(url, init, currentMaintenance(), undefined, fetcher);
export function maintenancePhase(phase: MaintenancePhase, message?: string) { currentMaintenance()?.phase(phase, message); }
export function maintenanceCancelled(error: unknown, signal?: AbortSignal) {
  if (error instanceof MaintenanceError && error.code === "stop-unconfirmed") return false;
  const reason = signal?.aborted ? signal.reason : error;
  return reason instanceof MaintenanceError ? reason.code === "cancelled" : reason instanceof Error && reason.name === "AbortError";
}
export function maintenanceFailure(error: unknown) { currentMaintenance()?.fail(error); }
export type MaintenanceAdmission = { id: string; resource: string; label: string; action: string; scope?: string; queued?: boolean; cancel?: boolean; controllable?: boolean; steps?: MaintenancePhase[]; params?: Record<string, unknown> };
export class MaintenanceService {
  private state: MaintenanceState = { tasks: [], budgets: { ...defaultMaintenanceBudgets } };
  private active = new Map<string, MaintenanceExecution>();
  private file: string;
  // Component standard: maintenance tasks are live progress only. History,
  // interrupted and unconfirmed records are never persisted or replayed;
  // only the user's time budgets survive a restart.
  constructor(readonly root: string, private changed: () => void = () => {}) {
    this.file = join(root, "maintenance", "tasks.json");
    try {
      const saved = JSON.parse(readFileSync(this.file, "utf8"));
      if (validMaintenanceBudgets(saved?.budgets)) this.state.budgets = saved.budgets;
    } catch { /* Missing or unreadable settings fall back to defaults. */ }
    registries.set(root, this);
  }
  /** Kept for callers; component maintenance no longer records stale tasks. */
  recordInterruption(_task: MaintenanceTask) {}
  recordUnconfirmed(_task: MaintenanceTask, _message: string) {}
  snapshot() { return structuredClone(this.state); }
  private publish = () => {
    {
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        mkdirSync(dirname(this.file), { recursive: true });
        const fd = openSync(temporary, "wx", 0o600);
        try { writeFileSync(fd, JSON.stringify({ tasks: [], budgets: this.state.budgets })); fsyncSync(fd); } finally { closeSync(fd); }
        renameSync(temporary, this.file);
        if (process.platform !== "win32") { const directory = openSync(dirname(this.file), "r"); try { fsyncSync(directory); } finally { closeSync(directory); } }
        delete this.state.error;
      }
      catch { /* Budgets are best-effort settings; never block maintenance. */ }
      finally { try { rmSync(temporary, { force: true }); } catch { /* Preserve the primary storage error. */ } }
    }
    this.changed();
  };
  async run<T>(admission: MaintenanceAdmission, controller: AbortController, work: () => Promise<T>): Promise<T> {
    if (this.active.has(admission.id)) throw new AppError("DUPLICATE_TASK", "任务标识已被使用，请读取已有任务状态。");
    const budgets = admission.params?.budgets;
    if (budgets !== undefined && !validMaintenanceBudgets(budgets)) throw new AppError("INVALID_BUDGETS", "时间预算须为 1 秒至 24 小时的整数毫秒。");
    const previous = this.state.tasks.findLast(task => task.resource === admission.resource && task.scope === (admission.scope ?? "应用级"));
    const now = Date.now();
    const task: MaintenanceTask = { id: admission.id, attemptId: randomUUID(), previousAttemptId: previous?.attemptId, resource: admission.resource, label: admission.label, action: admission.action, scope: admission.scope ?? "应用级", endpoint: "backend", status: "running", phase: admission.queued ? "queued" : "checking", steps: admission.steps ?? ["checking", "downloading", "verifying", "installing", "validating"], completedSteps: 0, createdAt: now, startedAt: admission.queued ? undefined : now, updatedAt: now, budgets: { ...(budgets as typeof defaultMaintenanceBudgets ?? this.state.budgets) }, capabilities: { cancel: admission.cancel === true, extend: admission.controllable !== false } };
    // Only the latest attempt per resource and scope is shown; older results are dropped.
    this.state.tasks = [...this.state.tasks.filter(item => item.id !== task.id && (maintenanceActive(item) || item.resource !== task.resource || item.scope !== task.scope)), task];
    this.changed();
    const execution = new MaintenanceExecution(task, controller, this.changed); this.active.set(task.id, execution);
    try { execution.signal.throwIfAborted(); const result = await contexts.run(execution, work); execution.signal.throwIfAborted(); return result; }
    catch (error) {
      execution.fail(error);
      if (task.status === "unknown") throw new MaintenanceError("stop-unconfirmed", task.error!.message);
      throw execution.signal.aborted ? execution.signal.reason : error;
    }
    finally { execution.finish(); if (this.active.get(task.id) === execution) this.active.delete(task.id); }
  }
  command(command: Command) {
    if (command.workspaceId || command.sessionId) throw new AppError("INVALID_SCOPE", "下载任务通过自身记录绑定范围。");
    const p = command.params ?? {};
    if (command.op === "maintenance.get") return this.snapshot();
    if (command.op === "maintenance.defaults") {
      if (!validMaintenanceBudgets(p.budgets)) throw new AppError("INVALID_BUDGETS", "请填写有效的时间预算。");
      this.state.budgets = { ...p.budgets }; this.publish(); return this.snapshot();
    }
    if (command.op === "maintenance.clear") {
      this.state.tasks = this.state.tasks.filter(task => maintenanceActive(task)); this.changed(); return this.snapshot();
    }
    const execution = this.active.get(String(p.id));
    if (!execution) throw new AppError("NOT_RUNNING", "任务已结束或当前不可控制，请读取最新状态。");
    if (command.op === "maintenance.extend") {
      if (!execution.task.capabilities.extend) throw new AppError("NOT_CONTROLLABLE", "此包管理器未提供动态期限控制，请等待结果。");
      const budgets = p.budgets;
      if (!validMaintenanceBudgets(budgets) || (Object.keys(defaultMaintenanceBudgets) as (keyof typeof defaultMaintenanceBudgets)[]).some(key => budgets[key] < execution.budgets[key])) throw new AppError("INVALID_BUDGETS", "运行中只能延长预算，不能缩短。");
      execution.task.budgets = { ...budgets }; execution.update(true);
    } else if (command.op === "maintenance.cancel") {
      if (!execution.task.capabilities.cancel) throw new AppError("NOT_CANCELLABLE", "此阶段需要等待安装器结果。");
      execution.task.status = "cancelling"; execution.controller.abort(new MaintenanceError("cancelled", "已请求取消，等待执行与清理结束。")); execution.update(true);
    } else throw new AppError("UNKNOWN_OPERATION", "不支持此下载任务操作。");
    return this.snapshot();
  }
  close() { if (registries.get(this.root) === this) registries.delete(this.root); }
}
export function recordMaintenanceUnconfirmed(root: string, task: MaintenanceTask, message: string) {
  (registries.get(root) ?? new MaintenanceService(root)).recordUnconfirmed(task, message);
}
export function recordMaintenanceInterruption(root: string, task: MaintenanceTask) {
  (registries.get(root) ?? new MaintenanceService(root)).recordInterruption(task);
}
export function runMaintenance<T>(root: string, admission: MaintenanceAdmission, controller: AbortController, work: () => Promise<T>) {
  const service = registries.get(root) ?? new MaintenanceService(root);
  return service.run(admission, controller, work);
}
