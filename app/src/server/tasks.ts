import type { Agents } from "./agents.js";
import { AppError, type Scope, type Command } from "../shared/protocol.js";
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
  readonly store;
  constructor(readonly agents: Agents) {
    this.store = agents.store;
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
    agents.onEvent = (scope, run, event) => this.event(scope, run, event);
    agents.onSettled = (scope, run) => {
      const row = this.records.child(scope);
      if (row) this.scheduler.settle(row, run);
      else this.delivery.parentSettled(scope, run);
      this.scheduler.kick();
    };
    // Restart restores reports only; no worker launch or input replay.
    for (const row of this.records.rows("WHERE tasks.runId IS NOT NULL")) {
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
  list(scope: Scope) {
    return this.records.list(scope);
  }
  child(scope: Scope) {
    return this.records.child(scope);
  }
  preferences() {
    return this.records.preferences();
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
      if (event.type === "delivered")
        this.delivery.acknowledge(scope, event.ids);
    }
  }
  command(c: Command) {
    return this.commands.command(c);
  }
  async stopParent(scope: Scope) {
    this.store.session(scope.workspaceId, scope.sessionId);
    this.records.freeze(scope);
    const owned = this.records.rows("WHERE parentSessionId=?", scope.sessionId);
    const outcomes = await Promise.allSettled([
      this.agents.stop(scope),
      this.scheduler.stop(owned, "父会话整体停止"),
      ...owned.map((row) => this.agents.compressions.stop(target(row))),
    ]);
    this.agents.publish(tasksScope(scope), this.records.list(scope));
    if (
      outcomes.some((o) => o.status === "rejected") ||
      this.records
        .rows("WHERE parentSessionId=?", scope.sessionId)
        .some(
          (row) => this.agents.info(target(row)).run?.cleanup === "unconfirmed",
        )
    )
      throw new AppError(
        "CLEANUP_UNCONFIRMED",
        "父／子执行已请求停止，仍有清理待核实",
      );
  }
  async stopProviders(providers: string[], confirmed: boolean) {
    const affected = this.agents.affected(providers);
    // Check every affected kind before stopping anything without explicit confirmation.
    this.agents.compressions.checkProviders(providers, confirmed);
    const queued = this.records
      .rows("WHERE status='queued'")
      .filter((row) =>
        providers.includes(
          this.agents.info(target(row)).selection?.provider ?? "",
        ),
      );
    if ((affected.length || queued.length) && !confirmed)
      throw new AppError(
        "ACTIVE_RUNS_CONFIRMATION_REQUIRED",
        `需先停止受影响会话／排队子任务：${[...affected.map((s) => s.title), ...queued.map((t) => t.description.slice(0, 120))].join("、")}。确认后才退出登录。`,
      );
    const children: Row[] = [];
    for (const row of this.records.rows()) {
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
    await this.scheduler.stop(children, "供应商认证将撤销");
    await this.agents.stopProviders(providers, confirmed);
  }
  async remove(c: Command) {
    if (this.store.receipt(c.requestId).status === "committed")
      return this.agents.remove(c);
    const scope = { workspaceId: c.workspaceId!, sessionId: c.sessionId! };
    if (c.params?.confirmed !== true)
      throw new AppError(
        "CONFIRMATION_REQUIRED",
        "删除需要确认；同时停止并删除所属子会话记录，不删除项目文件",
      );
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
    return this.agents.remove(c);
  }
  async close() {
    this.delivery.pause();
    await this.scheduler.close();
    await Promise.allSettled(this.calls);
    await this.delivery.close();
  }
}
