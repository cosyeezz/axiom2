export const defaultMaintenanceBudgets = { headersMs: 30_000, idleMs: 60_000, installMs: 600_000, totalMs: 1_200_000 };
export const maintenanceBudgetLabels = { headersMs: "等待响应头", idleMs: "下载无数据等待", installMs: "安装阶段", totalMs: "任务总时限" };
export const maintenancePhaseLabels = { queued: "排队", checking: "检查", downloading: "下载", verifying: "校验", installing: "安装", validating: "验证", removing: "清理" };
export const maintenanceStatusLabels = { running: "进行中", cancelling: "正在取消", succeeded: "已完成", failed: "未完成", cancelled: "已取消", interrupted: "已中断，需核实", unknown: "结果待核实" };
export const emptyMaintenanceState = { tasks: [], budgets: defaultMaintenanceBudgets };
export function maintenanceActive(task) { return task.status === "running" || task.status === "cancelling"; }
export function retainMaintenanceTasks(tasks, recent = 100) {
    const completed = tasks.filter(task => !maintenanceActive(task) && task.status !== "unknown" && task.status !== "interrupted").slice(-recent);
    const keep = new Set(completed);
    return tasks.filter(task => maintenanceActive(task) || task.status === "unknown" || task.status === "interrupted" || keep.has(task));
}
export function validMaintenanceBudgets(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    const p = value;
    return Object.keys(p).length === 4 && Object.keys(defaultMaintenanceBudgets).every(key => Number.isSafeInteger(p[key]) && Number(p[key]) >= 1000 && Number(p[key]) <= 86_400_000);
}
export function validMaintenanceTask(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    const task = value;
    const phase = (v) => typeof v === "string" && Object.hasOwn(maintenancePhaseLabels, v);
    const time = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
    if (![task.id, task.attemptId, task.resource, task.label, task.action, task.scope].every(v => typeof v === "string" && v.length > 0)
        || !["backend", "browser", "desktop"].includes(task.endpoint) || !Object.hasOwn(maintenanceStatusLabels, task.status)
        || !phase(task.phase) || !Array.isArray(task.steps) || !task.steps.every(phase)
        || !Number.isSafeInteger(task.completedSteps) || task.completedSteps < 0 || task.completedSteps > task.steps.length
        || !time(task.createdAt) || !time(task.updatedAt) || task.startedAt !== undefined && !time(task.startedAt) || task.finishedAt !== undefined && !time(task.finishedAt)
        || !validMaintenanceBudgets(task.budgets) || typeof task.capabilities?.cancel !== "boolean" || typeof task.capabilities?.extend !== "boolean"
        || task.message !== undefined && typeof task.message !== "string" || task.previousAttemptId !== undefined && typeof task.previousAttemptId !== "string")
        return false;
    if (task.error !== undefined && (!task.error || typeof task.error !== "object" || typeof task.error.message !== "string" || !phase(task.error.phase) || !["cancelled", "headers-timeout", "idle-timeout", "install-timeout", "total-timeout", "network", "http", "output-limit", "stop-unconfirmed", "operation"].includes(task.error.code)))
        return false;
    const transfer = task.transfer;
    return transfer === undefined || !!transfer && typeof transfer === "object" && time(transfer.received) && time(transfer.updatedAt) && ["connecting", "receiving", "waiting", "retrying", "finished"].includes(transfer.connection)
        && (transfer.total === undefined || time(transfer.total)) && (transfer.bytesPerSecond === undefined || time(transfer.bytesPerSecond))
        && (transfer.source === undefined || typeof transfer.source === "string") && (transfer.retryAt === undefined || time(transfer.retryAt))
        && (transfer.attempt === undefined || Number.isSafeInteger(transfer.attempt) && transfer.attempt >= 0);
}
export class MaintenanceError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "MaintenanceError";
    }
}
//# sourceMappingURL=maintenance.js.map