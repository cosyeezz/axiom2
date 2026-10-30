import type { Agents } from "./agents.js";
import type { ServiceRecovery } from "./service-recovery-records.js";
import { AppError, text, type Scope, type Command } from "../shared/protocol.js";
import { TaskWindows } from "./task-windows.js";
import { running, type Run } from "../shared/agent.js";
import { tasksScope, taskToolNames } from "../shared/tasks.js";
import {
  TaskRecords,
  target,
  parent,
  failure,
  type TaskRow as Row,
} from "./tasks/records.js";
import { TaskDelivery } from "./tasks/delivery.js";
import { TaskScheduler } from "./tasks/scheduler.js";
import { TaskCommands } from "./tasks/commands.js";
// Public command/ownership boundary. Workers, scheduler and storage do not import this facade.
export class Tasks {
  private readonly commands: TaskCommands;
  private calls = new Set<Promise<unknown>>();
  private readonly records: TaskRecords;
  private readonly delivery: TaskDelivery;
  private readonly scheduler: TaskScheduler;
  private readonly windows: TaskWindows;
  readonly store;
  constructor(readonly agents: Agents) {
    this.store = agents.store;
    this.windows = new TaskWindows(this.store, scope => agents.windowIdentity(scope));
    this.records = new TaskRecords(this.store);
    this.delivery = new TaskDelivery(agents, this.records);
    this.scheduler = new TaskScheduler(agents, this.records, this.delivery);
    this.commands = new TaskCommands(
      agents,
      this.records,
      this.scheduler,
      this.delivery,
      (scope) => this.stopParent(scope),
    );
    agents.reloads.onReleased = scope => { this.delivery.notify(scope); this.scheduler.kick(); };
    agents.onEvent = (scope, run, event) => this.event(scope, run, event);
    agents.onSettled = (scope, run) => {
      const recovering = !this.scheduler.closing && this.store.recoveries.get(scope.sessionId)?.runId === run.id;
      const row = this.records.child(scope);
      if (row) this.scheduler.settle(row, run, recovering);
      else if (!recovering) this.delivery.parentSettled(scope, run);
      this.scheduler.kick();
    };
    // Recoverable children are settled by recover() before entering the normal queue.
    for (const row of this.records.rows(
      "WHERE tasks.runId IS NOT NULL AND EXISTS (SELECT 1 FROM sessions s JOIN workspaces w ON w.id=s.workspaceId WHERE s.id=tasks.sessionId AND s.deletedAt IS NULL AND w.archived=0)",
    )) {
      if (this.store.recoveries.get(row.sessionId)) continue;
      const run = agents.info(target(row)).run;
      if (
        run &&
        !running(run) &&
        !this.store.db
          .prepare("SELECT 1 FROM task_results WHERE runId=?")
          .get(run.id)
      )
        this.scheduler.settle(row, run, true);
    }
  }
  async recover(scope: Scope, recovery: ServiceRecovery): Promise<string | undefined> {
    const row = this.records.child(scope);
    if (row) {
      if (recovery.kind === "resume") {
        const run = this.agents.info(scope).run;
        if (!run || run.id !== recovery.runId) throw new AppError("RUN_MISMATCH", "恢复对象已变化");
        this.scheduler.settle(row, run, true);
      }
      await this.scheduler.recoverAndStart(row, recovery);
      return this.agents.info(scope).run?.id;
    }
    // Children have reconnected first; their model work need not finish before the parent reconnects.
    this.delivery.reconcilePending(scope);
    this.store.db.prepare("UPDATE task_parents SET frozen=0 WHERE sessionId=?").run(scope.sessionId);
    await this.delivery.notify(scope, true);
    const runId = this.agents.info(scope).run?.id;
    if ((runId ?? null) === recovery.runId && this.store.db.prepare(`SELECT 1 FROM task_results r JOIN tasks t ON t.id=r.taskId
      WHERE t.parentSessionId=? AND r.delivery NOT IN ('delivered','discarded') LIMIT 1`).get(scope.sessionId))
      throw new AppError("RECOVERY_BLOCKED", "子任务结果通知未能确认启动；请检查会话与模型配置。");
    this.store.recoveries.remove(scope.sessionId, recovery);
    return runId !== recovery.runId ? runId : undefined;
  }
  list(scope: Scope) {
    return this.records.list(scope);
  }
  window(c: Command, signal?: AbortSignal) {
    return this.windows.read({ workspaceId: text(c.workspaceId, "工作空间标识"), sessionId: text(c.sessionId, "会话标识") }, c.requestId, c.params?.query, signal);
  }
  windowInvalidation(scope: Scope, revision: number) {
    this.windows.check(scope);
    return { revision };
  }
  invalidateWindows(changed: string) { this.windows.changed(changed); }
  child(scope: Scope) {
    return this.records.child(scope);
  }
  preferences() {
    return this.records.preferences();
  }
  settings() {
    return this.records.settings();
  }
  result(scope: Scope, taskId: unknown, resultId: unknown) {
    return this.delivery.result(scope, taskId, resultId);
  }
  private trackCall<T>(job: Promise<T>) {
    this.calls.add(job);
    void job.finally(() => this.calls.delete(job)).catch(() => {});
    return job;
  }
  private event(scope: Scope, run: Run, event: any) {
    if (event.type === "task-call") {
      this.trackCall(
        (async () => {
          try {
            if (
              !taskToolNames.includes(event.name) ||
              typeof event.callId !== "string"
            )
              throw new AppError("INVALID_INPUT", "子任务工具无效");
            const data = await this.commands.tool(
              scope,
              run,
              event.name,
              event.callId,
              event.params,
            );
            this.agents.signal(scope, run.id, {
              type: "task-reply",
              key: event.key,
              ok: true,
              data,
            });
          } catch (e) {
            this.agents.signal(scope, run.id, {
              type: "task-reply",
              key: event.key,
              ok: false,
              error: failure(e),
            });
          }
        })(),
      );
    }
    const row = this.records.child(scope);
    if (row) this.scheduler.event(row, run, event);
    else {
      if (event.type === "running") this.delivery.notify(scope);
      if (event.type === "input-error") this.delivery.rejected(scope, event.id, event.error, event.uncertain === true);
      if (event.type === "delivered") {
        this.delivery.acknowledge(scope, event.ids);
        this.delivery.notify(scope);
      }
    }
  }
  command(c: Command, recovery?: ServiceRecovery) {
    return this.commands.command(c, recovery);
  }
  async stopParent(scope: Scope) {
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
    if (failed?.status === "rejected") throw failed.reason;
  }
  async stopProviders(providers: string[], confirmed: boolean) {
    const recoveries = this.store.db.prepare(`SELECT r.sessionId,s.workspaceId,s.title,json_extract(a.selection,'$.provider') AS provider
      FROM service_recoveries r JOIN sessions s ON s.id=r.sessionId
      JOIN agent_sessions a ON a.sessionId=r.sessionId`).all()
      .filter(row => providers.includes(String(row.provider)));
    const affected = [...new Map([...this.agents.affected(providers), ...recoveries.map(row => ({
      sessionId: String(row.sessionId), workspaceId: String(row.workspaceId), title: String(row.title),
    }))].map(scope => [scope.sessionId, scope])).values()];
    // Check every affected kind before stopping anything without explicit confirmation.
    this.agents.compressions.checkProviders(providers, confirmed);
    // Archived workspaces retain history, but are not valid execution scopes.
    const rows = this.records.rows(
      "WHERE EXISTS (SELECT 1 FROM sessions s JOIN workspaces w ON w.id=s.workspaceId WHERE s.id=tasks.sessionId AND s.deletedAt IS NULL AND w.archived=0)",
    );
    const queued = rows.filter((row) =>
      row.status === "queued" && providers.includes(
        this.agents.info(target(row)).selection?.provider ?? "",
      ),
    );
    if ((affected.length || queued.length) && !confirmed)
      throw new AppError(
        "ACTIVE_RUNS_CONFIRMATION_REQUIRED",
        `需先停止受影响会话／排队子任务：${[...affected.map((s) => s.title), ...queued.map((t) => t.description.slice(0, 120))].join("、")}。确认后才退出登录。`,
      );
    // A confirmed provider stop also revokes interrupted/non-live intentions.
    // Otherwise logging in again could revive work the user explicitly stopped.
    for (const recovery of recoveries) {
      this.store.recoveries.remove(String(recovery.sessionId));
      this.store.db.prepare("UPDATE task_parents SET frozen=1 WHERE sessionId=?").run(recovery.sessionId);
    }
    const children: Row[] = [];
    for (const row of rows) {
      const selection = this.agents.info(target(row)).selection;
      if (
        (selection && providers.includes(selection.provider)) ||
        affected.some(
          (s) =>
            s.sessionId === row.parentSessionId ||
            s.sessionId === row.sessionId,
        )
      ) {
        this.records.freeze(parent(row));
        children.push(row);
      }
    }
    await this.scheduler.stop(children, "供应商认证将撤销", "provider");
    await this.agents.stopProviders(providers, confirmed);
  }
  async remove(c: Command) {
    if (this.store.receipt(c.requestId).status === "committed")
      return this.agents.remove(c);
    const scope = { workspaceId: c.workspaceId!, sessionId: c.sessionId! };
    if (c.params?.confirmed !== true)
      throw new AppError(
        "CONFIRMATION_REQUIRED",
        "删除需要确认；停止所属执行并从列表移除，保留对话、子任务结果和记忆，不删除项目文件",
      );
    const position = this.store.session(scope.workspaceId, scope.sessionId);
    await this.stopParent(scope);
    for (const row of this.records.rows(
      "WHERE parentSessionId=?",
      scope.sessionId,
    ))
      await this.agents.remove({
        requestId: `${c.requestId}-${row.id}`,
        op: "session.delete",
        ...target(row),
        params: { confirmed: true },
      });
    return this.agents.remove(c, position);
  }
  async close() {
    this.windows.close();
    this.delivery.pause();
    await this.scheduler.close();
    await Promise.allSettled(this.calls);
    await this.delivery.close();
  }
}
