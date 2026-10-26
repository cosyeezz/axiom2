import { AppError } from "../shared/protocol.js";
import { running } from "../shared/agent.js";
import { tasksScope, taskToolNames } from "../shared/tasks.js";
import { TaskRecords, target, parent, failure, } from "./tasks/records.js";
import { TaskDelivery } from "./tasks/delivery.js";
import { TaskScheduler } from "./tasks/scheduler.js";
import { TaskCommands } from "./tasks/commands.js";
// Public command/ownership boundary. Workers, scheduler and storage do not import this facade.
export class Tasks {
    agents;
    commands;
    calls = new Set();
    records;
    delivery;
    scheduler;
    store;
    constructor(agents) {
        this.agents = agents;
        this.store = agents.store;
        this.records = new TaskRecords(this.store);
        this.delivery = new TaskDelivery(agents, this.records);
        this.scheduler = new TaskScheduler(agents, this.records, this.delivery);
        this.commands = new TaskCommands(agents, this.records, this.scheduler, this.delivery, (scope) => this.stopParent(scope));
        agents.reloads.onReleased = scope => { this.delivery.notify(scope); this.scheduler.kick(); };
        agents.onEvent = (scope, run, event) => this.event(scope, run, event);
        agents.onSettled = (scope, run) => {
            const row = this.records.child(scope);
            if (row)
                this.scheduler.settle(row, run);
            else
                this.delivery.parentSettled(scope, run);
            this.scheduler.kick();
        };
        // Recoverable children are settled by recover() before entering the normal queue.
        for (const row of this.records.rows("WHERE tasks.runId IS NOT NULL AND EXISTS (SELECT 1 FROM sessions s JOIN workspaces w ON w.id=s.workspaceId WHERE s.id=tasks.sessionId AND s.deletedAt IS NULL AND w.archived=0)")) {
            if (this.store.recoveries.get(row.sessionId))
                continue;
            const run = agents.info(target(row)).run;
            if (run &&
                !running(run) &&
                !this.store.db
                    .prepare("SELECT 1 FROM task_results WHERE runId=?")
                    .get(run.id))
                this.scheduler.settle(row, run, true);
        }
    }
    async recover(scope, recovery) {
        const row = this.records.child(scope);
        if (row) {
            if (recovery.kind === "resume") {
                const run = this.agents.info(scope).run;
                if (!run || run.id !== recovery.runId)
                    throw new AppError("RUN_MISMATCH", "恢复对象已变化");
                this.scheduler.settle(row, run, true);
            }
            this.scheduler.recover(row, recovery);
            return;
        }
        // The coordinator keeps parents frozen until all child recoveries have settled.
        this.delivery.reconcilePending(scope);
        this.store.db.prepare("UPDATE task_parents SET frozen=0 WHERE sessionId=?").run(scope.sessionId);
        await this.delivery.notify(scope);
        const runId = this.agents.info(scope).run?.id;
        if ((runId ?? null) === recovery.runId && this.store.db.prepare(`SELECT 1 FROM task_results r JOIN tasks t ON t.id=r.taskId
      WHERE t.parentSessionId=? AND r.delivery NOT IN ('delivered','discarded') LIMIT 1`).get(scope.sessionId))
            throw new AppError("RECOVERY_BLOCKED", "子任务结果通知未能确认启动；请检查会话与模型配置。");
        this.store.recoveries.remove(scope.sessionId, recovery);
        return runId !== recovery.runId ? runId : undefined;
    }
    list(scope) {
        return this.records.list(scope);
    }
    child(scope) {
        return this.records.child(scope);
    }
    preferences() {
        return this.records.preferences();
    }
    settings() {
        return this.records.settings();
    }
    result(scope, taskId, resultId) {
        return this.delivery.result(scope, taskId, resultId);
    }
    trackCall(job) {
        this.calls.add(job);
        void job.finally(() => this.calls.delete(job)).catch(() => { });
        return job;
    }
    event(scope, run, event) {
        if (event.type === "task-call") {
            this.trackCall((async () => {
                try {
                    if (!taskToolNames.includes(event.name) ||
                        typeof event.callId !== "string")
                        throw new AppError("INVALID_INPUT", "子任务工具无效");
                    const data = await this.commands.tool(scope, run, event.name, event.callId, event.params);
                    this.agents.signal(scope, run.id, {
                        type: "task-reply",
                        key: event.key,
                        ok: true,
                        data,
                    });
                }
                catch (e) {
                    this.agents.signal(scope, run.id, {
                        type: "task-reply",
                        key: event.key,
                        ok: false,
                        error: failure(e),
                    });
                }
            })());
        }
        const row = this.records.child(scope);
        if (row)
            this.scheduler.event(row, run, event);
        else {
            if (event.type === "running")
                this.delivery.notify(scope);
            if (event.type === "input-error")
                this.delivery.rejected(scope, event.id, event.error, event.uncertain === true);
            if (event.type === "delivered") {
                this.delivery.acknowledge(scope, event.ids);
                this.delivery.notify(scope);
            }
        }
    }
    command(c, recovery) {
        return this.commands.command(c, recovery);
    }
    async stopParent(scope) {
        this.store.session(scope.workspaceId, scope.sessionId);
        this.records.freeze(scope);
        this.store.db.prepare("DELETE FROM service_recoveries WHERE sessionId=? OR sessionId IN (SELECT sessionId FROM tasks WHERE parentSessionId=?)").run(scope.sessionId, scope.sessionId);
        const owned = this.records.rows("WHERE parentSessionId=?", scope.sessionId);
        const outcomes = await Promise.allSettled([
            this.agents.stop(scope),
            this.scheduler.stop(owned, "父会话整体停止"),
            ...owned.map(async (row) => {
                await this.agents.releaseIdle(target(row));
                await this.agents.compressions.stop(target(row));
            }),
        ]);
        this.agents.publish(tasksScope(scope));
        const failed = outcomes.find((o) => o.status === "rejected");
        if (failed?.status === "rejected")
            throw failed.reason;
    }
    async stopProviders(providers, confirmed) {
        const affected = this.agents.affected(providers);
        // Check every affected kind before stopping anything without explicit confirmation.
        this.agents.compressions.checkProviders(providers, confirmed);
        // Archived workspaces retain history, but are not valid execution scopes.
        const rows = this.records.rows("WHERE EXISTS (SELECT 1 FROM sessions s JOIN workspaces w ON w.id=s.workspaceId WHERE s.id=tasks.sessionId AND s.deletedAt IS NULL AND w.archived=0)");
        const queued = rows.filter((row) => row.status === "queued" && providers.includes(this.agents.info(target(row)).selection?.provider ?? ""));
        if ((affected.length || queued.length) && !confirmed)
            throw new AppError("ACTIVE_RUNS_CONFIRMATION_REQUIRED", `需先停止受影响会话／排队子任务：${[...affected.map((s) => s.title), ...queued.map((t) => t.description.slice(0, 120))].join("、")}。确认后才退出登录。`);
        const children = [];
        for (const row of rows) {
            const selection = this.agents.info(target(row)).selection;
            if ((selection && providers.includes(selection.provider)) ||
                affected.some((s) => s.sessionId === row.parentSessionId ||
                    s.sessionId === row.sessionId)) {
                this.records.freeze(parent(row));
                children.push(row);
            }
        }
        await this.scheduler.stop(children, "供应商认证将撤销", "provider");
        await this.agents.stopProviders(providers, confirmed);
    }
    async remove(c) {
        if (this.store.receipt(c.requestId).status === "committed")
            return this.agents.remove(c);
        const scope = { workspaceId: c.workspaceId, sessionId: c.sessionId };
        if (c.params?.confirmed !== true)
            throw new AppError("CONFIRMATION_REQUIRED", "删除需要确认；停止所属执行并从列表移除，保留对话、子任务结果和记忆，不删除项目文件");
        const position = this.store.session(scope.workspaceId, scope.sessionId);
        await this.stopParent(scope);
        for (const row of this.records.rows("WHERE parentSessionId=?", scope.sessionId))
            await this.agents.remove({
                requestId: `${c.requestId}-${row.id}`,
                op: "session.delete",
                ...target(row),
                params: { confirmed: true },
            });
        return this.agents.remove(c, position);
    }
    async close() {
        this.delivery.pause();
        await this.scheduler.close();
        await Promise.allSettled(this.calls);
        await this.delivery.close();
    }
}
//# sourceMappingURL=tasks.js.map