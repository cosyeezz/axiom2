import { createHash } from "node:crypto";
import type { Agents } from "../agents.js";
import { toolKey } from "../transcript.js";
import { configuration } from "../models.js";
import {
  AppError,
  object,
  text,
  attachmentInput,
  type Scope,
  type Command,
} from "../../shared/protocol.js";
import type { Run, Selection } from "../../shared/agent.js";
import { tasksScope, taskActive, type TaskTool } from "../../shared/tasks.js";
import { TaskRecords, parent } from "./records.js";
import { TaskDelivery } from "./delivery.js";
import { TaskScheduler } from "./scheduler.js";
// User commands and model tools share validation, receipts and per-task serialization.
export class TaskCommands {
  private locks = new Map<string, Promise<unknown>>();
  readonly store;
  constructor(
    readonly agents: Agents,
    readonly records: TaskRecords,
    readonly scheduler: TaskScheduler,
    readonly delivery: TaskDelivery,
    private readonly stopParent: (scope: Scope) => Promise<void>,
  ) {
    this.store = records.store;
  }
  private serial<T>(id: string, action: () => Promise<T>) {
    const job = (this.locks.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(action);
    this.locks.set(id, job);
    void job
      .finally(() => {
        if (this.locks.get(id) === job) this.locks.delete(id);
      })
      .catch(() => {});
    return job;
  }
  async tool(
    scope: Scope,
    run: Run,
    name: TaskTool,
    callId: string,
    params: unknown,
  ) {
    if (this.records.child(scope))
      throw new AppError(
        "RECURSIVE_DELEGATION",
        "子会话不允许委派或管理其他子任务",
      );
    const allowed: Record<TaskTool, string[]> = {
      delegate: ["context", "tasks"],
      append: ["taskId", "text", "mode"],
      cancel_task: ["taskId", "mode", "reason"],
      read_result: ["taskId", "resultId"],
    };
    if (Object.keys(object(params)).some((k) => !allowed[name].includes(k)))
      throw new AppError("INVALID_INPUT", "子任务工具包含未支持的参数");
    const c: Command = {
      requestId:
        "tool-" +
        createHash("sha256")
          .update(JSON.stringify([scope, run.id, callId]))
          .digest("hex"),
      op: name,
      ...scope,
      params: object(params),
    };
    const invoke = () =>
      this.store.external(c, async () => {
        if (
          this.scheduler.closing ||
          this.records.frozen(scope) ||
          this.agents.info(scope).run?.id !== run.id ||
          !this.agents.active(scope) ||
          this.agents.info(scope).run?.status === "stopping"
        )
          throw new AppError(
            "RUN_MISMATCH",
            "父执行已停止或变化；未接受新的子任务操作",
          );
        if (name === "delegate")
          return this.delegate(scope, run, callId, c.params!);
        const row = this.records.own(scope, c.params!.taskId);
        if (name === "append") return this.scheduler.append(row, c.params!);
        if (name === "cancel_task")
          return this.scheduler.cancel(row, c.params!);
        return this.delivery.result(scope, row.id, c.params!.resultId);
      });
    return name === "append" || name === "cancel_task"
      ? this.serial(text(c.params!.taskId, "子任务标识"), invoke)
      : invoke();
  }
  private async delegate(
    scope: Scope,
    run: Run,
    callId: string,
    p: Record<string, unknown>,
  ) {
    const context = text(p.context, "背景", 12000);
    if (!Array.isArray(p.tasks) || !p.tasks.length || p.tasks.length > 8)
      throw new AppError("INVALID_INPUT", "一次委派需要 1–8 个子任务");
    const definitions = p.tasks.map((value) => {
      const t = object(value);
      if (Object.keys(t).some((k) => !["task", "systemPrompt"].includes(k)))
        throw new AppError("INVALID_INPUT", "子任务定义包含未支持的参数");
      return {
        task: text(t.task, "任务", 12000),
        role:
          t.systemPrompt === undefined
            ? ""
            : text(t.systemPrompt, "职责补充", 4000),
      };
    });
    const selection =
      this.records.list(scope).defaultModel ??
      this.agents.info(scope).selection;
    const config = await configuration(this.store.root);
    if (
      !selection ||
      !config.available.some(
        (m) =>
          m.provider === selection.provider &&
          m.id === selection.id &&
          m.levels.includes(selection.thinking),
      )
    )
      throw new AppError(
        "MODEL_UNAVAILABLE",
        "默认子模型不可用；请明确选择，不自动替换。",
      );
    if (
      this.scheduler.closing ||
      this.records.frozen(scope) ||
      !this.agents.active(scope) ||
      this.agents.info(scope).run?.id !== run.id ||
      this.agents.info(scope).run?.status === "stopping"
    )
      throw new AppError("RUN_MISMATCH", "委派期间父执行已停止，未创建任务");
    // Recheck after the asynchronous catalog read so parallel delegations share the same limit.
    if (
      this.records
        .rows("WHERE parentSessionId=?", scope.sessionId)
        .filter((t) => taskActive(t.status)).length +
        definitions.length >
      32
    )
      throw new AppError("TASK_LIMIT", "每个主会话最多 32 个活动／排队子任务");
    const { taskIds, budgets } = this.records.create(
      scope,
      toolKey(run.id, callId),
      context,
      definitions,
      selection,
    );
    this.agents.publish(tasksScope(scope), this.records.list(scope));
    this.scheduler.kick();
    this.agents.publish(`sessions:${scope.workspaceId}`);
    return { taskIds, status: "queued", budgets };
  }
  async command(c: Command): Promise<unknown> {
    const scope = { workspaceId: c.workspaceId!, sessionId: c.sessionId! },
      p = object(c.params ?? {});
    if (c.op === "task.preferences.get") return this.records.preferences();
    if (c.op === "task.preferences.save")
      return this.store.external(c, async () => {
        const values = object(p.budgets),
          bounds = {
            concurrency: [1, 16],
            workMs: [1000, 86400000],
            wrapMs: [0, 3600000],
            summaryMs: [1000, 60000],
            cleanupMs: [1000, 10000],
          };
        for (const [key, [min, max]] of Object.entries(bounds))
          if (
            !Number.isInteger(values[key]) ||
            Number(values[key]) < min ||
            Number(values[key]) > max
          )
            throw new AppError("INVALID_INPUT", `预算 ${key} 超出允许范围`);
        const budgets = Object.fromEntries(
          Object.keys(bounds).map((k) => [k, values[k]]),
        );
        this.store.db
          .prepare(
            "INSERT INTO task_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
          )
          .run(JSON.stringify(budgets));
        this.scheduler.kick();
        return budgets;
      });
    const child = this.records.child(scope);
    if (c.op === "task.pending") {
      const row = this.records.own(scope, p.taskId);
      const inputId =
        p.inputId === undefined ? null : text(p.inputId, "输入标识");
      return this.store.db
        .prepare(
          inputId
            ? "SELECT id,body,mode,state,runId FROM task_inputs WHERE taskId=? AND id=?"
            : "SELECT id,substr(body,1,500) AS body,mode,state,runId FROM task_inputs WHERE taskId=? AND state!='delivered' ORDER BY createdAt,rowid",
        )
        .all(...(inputId ? [row.id, inputId] : [row.id]));
    }
    if (c.op === "task.result")
      return this.delivery.result(scope, p.taskId, p.resultId);
    if (c.op === "task.append" || c.op === "task.cancel") {
      const row = this.records.own(scope, p.taskId);
      return this.serial(row.id, () =>
        this.store.external(c, async () =>
          c.op === "task.append"
            ? this.scheduler.append(this.records.own(scope, p.taskId), p)
            : this.scheduler.cancel(this.records.own(scope, p.taskId), p),
        ),
      );
    }
    if (c.op === "task.default-model")
      return this.store.external(c, async () => {
        if (child)
          throw new AppError("RECURSIVE_DELEGATION", "子会话没有默认子模型");
        const selection =
          p.selection === null
            ? null
            : (object(p.selection) as unknown as Selection);
        const config = await configuration(this.store.root);
        if (
          selection &&
          !config.available.some(
            (m) =>
              m.provider === selection.provider &&
              m.id === selection.id &&
              m.levels.includes(selection.thinking),
          )
        )
          throw new AppError("MODEL_UNAVAILABLE", "子模型不可用");
        this.store.db
          .prepare(
            "INSERT INTO task_parents(sessionId,defaultModel) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET defaultModel=excluded.defaultModel",
          )
          .run(scope.sessionId, selection ? JSON.stringify(selection) : null);
        this.agents.publish(tasksScope(scope), this.records.list(scope));
        return this.records.list(scope);
      });
    if (c.op === "agent.stop")
      return this.store.external(c, async () => {
        if (p.runId !== this.agents.info(scope).run?.id)
          throw new AppError("RUN_MISMATCH", "执行已变化，未停止其他执行");
        if (child) {
          const response = this.scheduler.cancel(child, {
            mode: "summary",
            reason: "用户停止子会话",
          });
          return response;
        }
        await this.stopParent(scope);
        return this.agents.info(scope);
      });
    if (child && (c.op === "prompt" || c.op === "agent.continue")) {
      const attachment = attachmentInput(p.attachment);
      const body =
        c.op === "agent.continue"
          ? "请检查已保存的对话和文件状态，只继续未完成部分，不盲目重放命令。"
          : text(p.text || (attachment ? "请检查附件。" : ""), "追问", 12000);
      return this.serial(child.id, () =>
        this.store.external(c, async () =>
          this.scheduler.append(this.records.own(parent(child), child.id), {
            text: body,
            attachment,
            mode: p.mode ?? "steer",
          }),
        ),
      );
    }
    const fresh = this.store.receipt(c.requestId).status === "not_found";
    const newWork =
      fresh && !child && ["prompt", "agent.continue"].includes(c.op);
    const stopEpoch = this.records.stopEpoch(scope);
    const result = await this.agents.command(
      c,
      newWork
        ? {
            beforeStart: () => {
              if (
                this.scheduler.closing ||
                this.records.stopEpoch(scope) !== stopEpoch
              )
                throw new AppError(
                  "PARENT_FROZEN",
                  "发送期间父会话已停止；未启动，请核实后发送新要求。",
                );
            },
          }
        : {},
    );
    if (newWork && this.records.stopEpoch(scope) === stopEpoch) {
      this.delivery.reconcilePending(scope);
      this.store.db
        .prepare(
          "INSERT INTO task_parents(sessionId,frozen) VALUES(?,0) ON CONFLICT(sessionId) DO UPDATE SET frozen=0",
        )
        .run(scope.sessionId);
      this.agents.publish(tasksScope(scope), this.records.list(scope));
      this.delivery.notify(scope);
    }
    return result;
  }
}
