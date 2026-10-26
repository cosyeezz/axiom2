import { useSyncExternalStore } from "react";
import { defaultMaintenanceBudgets, maintenanceActive, retainMaintenanceTasks, validMaintenanceBudgets, type MaintenanceBudgets, type MaintenancePhase, type MaintenanceState, type MaintenanceTask } from "../../shared/maintenance.js";
import { MaintenanceExecution } from "../../shared/maintenance-runtime.js";

const historyKey = "axiom.maintenance.browser.history", budgetKey = "axiom.maintenance.browser.budgets";
const listeners = new Set<() => void>(), executions = new Map<string, MaintenanceExecution>();
let state: MaintenanceState = { tasks: [], budgets: { ...defaultMaintenanceBudgets } }, historyWritable = true;
try {
  const budgets: unknown = JSON.parse(localStorage.getItem(budgetKey) ?? "null");
  if (validMaintenanceBudgets(budgets)) state.budgets = budgets;
} catch { state.error = "浏览器维护预算无法读取，已使用默认预算。"; }
try {
  const tasks: unknown = JSON.parse(sessionStorage.getItem(historyKey) ?? "[]");
  if (!Array.isArray(tasks)) throw Error("维护历史不是任务列表。");
  const valid = tasks.filter((task): task is MaintenanceTask => task?.endpoint === "browser" && typeof task.id === "string" && typeof task.attemptId === "string" && typeof task.label === "string" && typeof task.resource === "string" && typeof task.phase === "string" && Number.isFinite(task.createdAt) && Array.isArray(task.steps) && task.steps.every((step: unknown) => typeof step === "string") && ["queued", "running", "cancelling", "unknown", "interrupted", "succeeded", "failed", "cancelled"].includes(task.status) && typeof task.capabilities?.cancel === "boolean" && typeof task.capabilities?.extend === "boolean" && validMaintenanceBudgets(task.budgets));
  state.tasks = retainMaintenanceTasks(valid).map(task => maintenanceActive(task) ? { ...task, status: "interrupted", capabilities: { cancel: false, extend: false }, message: "页面已重新加载，请核实字体库；未自动重试。" } : task);
  if (valid.length !== tasks.length) throw Error("部分维护历史损坏。");
} catch { historyWritable = false; state.error = "浏览器维护记录部分损坏或无法读取，原记录已保留；新任务仅在当前页面查看。"; }
function publish() {
  state = { ...state, tasks: state.tasks.map(task => structuredClone(task)) };
  if (historyWritable) try { sessionStorage.setItem(historyKey, JSON.stringify(state.tasks)); } catch { state.error = "浏览器无法保存维护记录，刷新页面后记录可能丢失。"; }
  listeners.forEach(listener => listener());
}
export function useBrowserMaintenance() { return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state); }
export async function browserMaintenanceCommand(op: string, id?: string, budgets?: MaintenanceBudgets) {
  if (op === "defaults") {
    if (!validMaintenanceBudgets(budgets)) throw Error("请输入有效的超时设置。");
    localStorage.setItem(budgetKey, JSON.stringify(budgets)); state.budgets = { ...budgets }; publish(); return;
  }
  if (op === "clear") { state.tasks = state.tasks.filter(task => maintenanceActive(task) || ["unknown", "interrupted"].includes(task.status)); publish(); return; }
  const execution = id ? executions.get(id) : undefined;
  if (!execution) throw Error("此任务已结束或属于另一页面，请重新读取状态。");
  if (op === "cancel") { execution.task.status = "cancelling"; execution.abort("cancelled", "已取消字体操作。"); execution.update(true); }
  if (op === "extend") {
    if (!validMaintenanceBudgets(budgets) || Object.keys(budgets).some(key => budgets[key as keyof MaintenanceBudgets] < execution.budgets[key as keyof MaintenanceBudgets])) throw Error("运行中只能延长时限。");
    execution.task.budgets = { ...budgets }; execution.update(true);
  }
}
export async function runBrowserMaintenance<T>(options: { resource: string; label: string; action: string; steps: MaintenancePhase[]; signal?: AbortSignal }, run: (execution: MaintenanceExecution) => Promise<T>): Promise<T> {
  const controller = new AbortController(), now = Date.now();
  const task: MaintenanceTask = { id: crypto.randomUUID(), attemptId: crypto.randomUUID(), endpoint: "browser", scope: "当前浏览器 · 字体库", resource: options.resource, label: options.label, action: options.action, status: "running", phase: "checking", steps: options.steps, completedSteps: 0, createdAt: now, startedAt: now, updatedAt: now, budgets: { ...state.budgets }, capabilities: { cancel: true, extend: true } };
  const execution = new MaintenanceExecution(task, controller, () => { state.tasks = state.tasks.map(item => item.id === task.id ? task : item); publish(); });
  const abort = () => execution.abort("cancelled", "已取消字体操作。");
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  state.tasks = [...retainMaintenanceTasks(state.tasks, 99), task];
  executions.set(task.id, execution); publish();
  try { execution.signal.throwIfAborted(); const result = await run(execution); execution.signal.throwIfAborted(); return result; }
  catch (error) { execution.fail(error); throw execution.signal.aborted ? execution.signal.reason : error; }
  finally { execution.finish(); executions.delete(task.id); options.signal?.removeEventListener("abort", abort); }
}
