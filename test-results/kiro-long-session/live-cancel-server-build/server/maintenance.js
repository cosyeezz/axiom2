import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AppError } from "../shared/protocol.js";
import { defaultMaintenanceBudgets, MaintenanceError, maintenanceActive, retainMaintenanceTasks, validMaintenanceBudgets, validMaintenanceTask } from "../shared/maintenance.js";
import { MaintenanceExecution, maintenanceFetch } from "../shared/maintenance-runtime.js";
const contexts = new AsyncLocalStorage();
const registries = new Map();
export const currentMaintenance = () => contexts.getStore();
export const maintainedFetch = (url, init, fetcher) => maintenanceFetch(url, init, currentMaintenance(), undefined, fetcher);
export function maintenancePhase(phase, message) { currentMaintenance()?.phase(phase, message); }
export function maintenanceCancelled(error, signal) {
    if (error instanceof MaintenanceError && error.code === "stop-unconfirmed")
        return false;
    const reason = signal?.aborted ? signal.reason : error;
    return reason instanceof MaintenanceError ? reason.code === "cancelled" : reason instanceof Error && reason.name === "AbortError";
}
export function maintenanceFailure(error) { currentMaintenance()?.fail(error); }
export class MaintenanceService {
    root;
    changed;
    state = { tasks: [], budgets: { ...defaultMaintenanceBudgets } };
    active = new Map();
    historyUnreadable = false;
    file;
    constructor(root, changed = () => { }) {
        this.root = root;
        this.changed = changed;
        this.file = join(root, "maintenance", "tasks.json");
        try {
            const saved = JSON.parse(readFileSync(this.file, "utf8"));
            if (!Array.isArray(saved.tasks) || !validMaintenanceBudgets(saved.budgets))
                throw Error("invalid");
            this.state.budgets = saved.budgets;
            const valid = saved.tasks.filter((task) => validMaintenanceTask(task) && task.endpoint === "backend");
            const unique = new Map(valid.map(task => [task.id, task]));
            this.state.tasks = retainMaintenanceTasks([...unique.values()]);
            for (const task of this.state.tasks)
                if (maintenanceActive(task)) {
                    task.status = "interrupted";
                    task.message = "服务已重启，请先到来源页面核实；不会自动重放操作。";
                    task.capabilities = { cancel: false, extend: false };
                }
            if (valid.length !== saved.tasks.length || unique.size !== valid.length)
                throw Error("partial history");
        }
        catch (error) {
            if (error.code !== "ENOENT") {
                this.historyUnreadable = true;
                this.state.error = "任务历史无法读取；原记录不会被覆盖，请核实文件权限与内容后重启服务。";
            }
        }
        registries.set(root, this);
    }
    recordInterruption(task) {
        if (this.active.has(task.id))
            throw new AppError("RESOURCE_BUSY", "原维护任务仍在执行。");
        const previous = this.state.tasks.find(item => item.id === task.id);
        if (previous && previous.attemptId !== task.attemptId)
            throw new AppError("RESOURCE_SHARED", "维护任务身份已变化。");
        const interrupted = { ...task, status: "interrupted", updatedAt: Date.now(), capabilities: { cancel: false, extend: false }, message: "原操作已中断，进程退出已核实；保留安装目录，请重新检查当前配置。", error: { code: "operation", phase: task.phase, message: "原操作已中断；未自动重放安装或删除候选目录。" } };
        this.state.tasks = [...this.state.tasks.filter(item => item.id !== task.id), interrupted];
        this.publish();
        if (this.state.error)
            throw new AppError("STORAGE_ERROR", this.state.error);
    }
    recordUnconfirmed(task, message) {
        if (this.active.has(task.id))
            throw new AppError("RESOURCE_BUSY", "原维护任务仍在执行。");
        const previous = this.state.tasks.find(item => item.id === task.id);
        if (previous && previous.attemptId !== task.attemptId)
            throw new AppError("RESOURCE_SHARED", "维护任务身份已变化。");
        const value = { ...task, status: "unknown", updatedAt: Date.now(), capabilities: { cancel: false, extend: false }, message, error: { code: "stop-unconfirmed", phase: task.phase, message } };
        delete value.finishedAt;
        this.state.tasks = [...this.state.tasks.filter(item => item.id !== task.id), value];
        this.publish();
        if (this.state.error)
            throw new AppError("STORAGE_ERROR", this.state.error);
    }
    snapshot() { return structuredClone(this.state); }
    publish = () => {
        if (!this.historyUnreadable) {
            const temporary = `${this.file}.${randomUUID()}.tmp`;
            try {
                mkdirSync(dirname(this.file), { recursive: true });
                const fd = openSync(temporary, "wx", 0o600);
                try {
                    writeFileSync(fd, JSON.stringify(this.state));
                    fsyncSync(fd);
                }
                finally {
                    closeSync(fd);
                }
                renameSync(temporary, this.file);
                if (process.platform !== "win32") {
                    const directory = openSync(dirname(this.file), "r");
                    try {
                        fsyncSync(directory);
                    }
                    finally {
                        closeSync(directory);
                    }
                }
                delete this.state.error;
            }
            catch {
                this.state.error = "任务历史未能保存；请核实实际安装结果，不要重复提交安装。";
            }
            finally {
                try {
                    rmSync(temporary, { force: true });
                }
                catch { /* Preserve the primary storage error. */ }
            }
        }
        this.changed();
    };
    async run(admission, controller, work) {
        if (this.state.tasks.some(task => task.id === admission.id))
            throw new AppError("DUPLICATE_TASK", "任务标识已被使用，请读取已有任务状态。");
        const budgets = admission.params?.budgets;
        if (budgets !== undefined && !validMaintenanceBudgets(budgets))
            throw new AppError("INVALID_BUDGETS", "时间预算须为 1 秒至 24 小时的整数毫秒。");
        const previous = this.state.tasks.findLast(task => task.resource === admission.resource && task.scope === (admission.scope ?? "应用级"));
        const now = Date.now();
        const task = { id: admission.id, attemptId: randomUUID(), previousAttemptId: previous?.attemptId, resource: admission.resource, label: admission.label, action: admission.action, scope: admission.scope ?? "应用级", endpoint: "backend", status: "running", phase: admission.queued ? "queued" : "checking", steps: admission.steps ?? ["checking", "downloading", "verifying", "installing", "validating"], completedSteps: 0, createdAt: now, startedAt: admission.queued ? undefined : now, updatedAt: now, budgets: { ...(budgets ?? this.state.budgets) }, capabilities: { cancel: admission.cancel === true, extend: admission.controllable !== false } };
        this.state.tasks = [...retainMaintenanceTasks(this.state.tasks, 99), task];
        this.publish();
        if (this.state.error) {
            task.status = "failed";
            task.finishedAt = Date.now();
            task.capabilities = { cancel: false, extend: false };
            task.error = { code: "operation", message: this.state.error, phase: task.phase };
            this.changed();
            throw new AppError("STORAGE_ERROR", this.state.error);
        }
        const execution = new MaintenanceExecution(task, controller, this.publish);
        this.active.set(task.id, execution);
        try {
            execution.signal.throwIfAborted();
            const result = await contexts.run(execution, work);
            execution.signal.throwIfAborted();
            return result;
        }
        catch (error) {
            execution.fail(error);
            if (task.status === "unknown")
                throw new MaintenanceError("stop-unconfirmed", task.error.message);
            throw execution.signal.aborted ? execution.signal.reason : error;
        }
        finally {
            execution.finish();
            if (this.active.get(task.id) === execution)
                this.active.delete(task.id);
        }
    }
    command(command) {
        if (command.workspaceId || command.sessionId)
            throw new AppError("INVALID_SCOPE", "下载任务通过自身记录绑定范围。");
        const p = command.params ?? {};
        if (command.op === "maintenance.get")
            return this.snapshot();
        if (command.op === "maintenance.defaults") {
            if (!validMaintenanceBudgets(p.budgets))
                throw new AppError("INVALID_BUDGETS", "请填写有效的时间预算。");
            this.state.budgets = { ...p.budgets };
            this.publish();
            return this.snapshot();
        }
        if (command.op === "maintenance.clear") {
            this.state.tasks = this.state.tasks.filter(task => maintenanceActive(task) || task.status === "unknown" || task.status === "interrupted");
            this.publish();
            return this.snapshot();
        }
        const execution = this.active.get(String(p.id));
        if (!execution)
            throw new AppError("NOT_RUNNING", "任务已结束或当前不可控制，请读取最新状态。");
        if (command.op === "maintenance.extend") {
            if (!execution.task.capabilities.extend)
                throw new AppError("NOT_CONTROLLABLE", "此包管理器未提供动态期限控制，请等待结果。");
            const budgets = p.budgets;
            if (!validMaintenanceBudgets(budgets) || Object.keys(defaultMaintenanceBudgets).some(key => budgets[key] < execution.budgets[key]))
                throw new AppError("INVALID_BUDGETS", "运行中只能延长预算，不能缩短。");
            execution.task.budgets = { ...budgets };
            execution.update(true);
        }
        else if (command.op === "maintenance.cancel") {
            if (!execution.task.capabilities.cancel)
                throw new AppError("NOT_CANCELLABLE", "此阶段需要等待安装器结果。");
            execution.task.status = "cancelling";
            execution.controller.abort(new MaintenanceError("cancelled", "已请求取消，等待执行与清理结束。"));
            execution.update(true);
        }
        else
            throw new AppError("UNKNOWN_OPERATION", "不支持此下载任务操作。");
        return this.snapshot();
    }
    close() { if (registries.get(this.root) === this)
        registries.delete(this.root); }
}
export function recordMaintenanceUnconfirmed(root, task, message) {
    (registries.get(root) ?? new MaintenanceService(root)).recordUnconfirmed(task, message);
}
export function recordMaintenanceInterruption(root, task) {
    (registries.get(root) ?? new MaintenanceService(root)).recordInterruption(task);
}
export function runMaintenance(root, admission, controller, work) {
    const service = registries.get(root) ?? new MaintenanceService(root);
    return service.run(admission, controller, work);
}
//# sourceMappingURL=maintenance.js.map