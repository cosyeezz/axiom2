import { createHash } from "node:crypto";
import type { Agents } from "../agents.js";
import { toolKey } from "../transcript.js";
import { configuration } from "../models.js";
import {
  AppError,
  object,
  text,
  attachmentsInput,
  type Scope,
  type Command,
} from "../../shared/protocol.js";
import type { Run, Selection } from "../../shared/agent.js";
import { tasksScope, taskPreferencesScope, taskActive, type TaskTool } from "../../shared/tasks.js";
import { TaskRecords, parent } from "./records.js";
import { TaskDelivery } from "./delivery.js";
import { TaskScheduler } from "./scheduler.js";
import { imagesInput } from "../images.js";
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
      cancel_task: ["taskId", "reason"],
      read_result: ["taskId", "resultId", "offset", "limit"],
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
          return this.scheduler.cancel(row, c.params!, "agent");
        return this.delivery.result(scope, row.id, c.params!.resultId, c.params!.offset, c.params!.limit);
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
    const config = await configuration(this.store.root);
    const selection =
      this.records.settings().selection ??
      this.agents.info(scope).selection;
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
    if (c.op === "task.preferences.get") return this.records.settings();
    if (c.op === "task.preferences.save" || c.op === "task.default-model")
      return this.serial("global-preferences", () => this.store.external(c, async () => {
        if (c.op === "task.default-model" && this.records.child(scope))
          throw new AppError("RECURSIVE_DELEGATION", "子会话没有默认子模型");
        if (!Object.keys(p).length || Object.keys(p).some((key) => !["budgets", "selection"].includes(key)))
          throw new AppError("INVALID_INPUT", "子代理设置参数无效");
        const patch = p.budgets === undefined ? {} : object(p.budgets);
        const bounds = { concurrency: [1, 16], workMs: [1000, 86400000] };
        for (const [key, value] of Object.entries(patch)) {
          const range = bounds[key as keyof typeof bounds];
          if (!range || !Number.isInteger(value) || Number(value) < range[0] || Number(value) > range[1])
            throw new AppError("INVALID_INPUT", `预算 ${key} 超出允许范围`);
        }
        let selection: Selection | null | undefined;
        if (p.selection !== undefined) {
          selection = p.selection === null ? null : object(p.selection) as unknown as Selection;
          if (selection && Object.keys(selection).some((key) => !["provider", "id", "thinking"].includes(key)))
            throw new AppError("INVALID_INPUT", "子模型参数无效");
          if (selection) {
            const config = await configuration(this.store.root);
            if (!config.available.some((m) => m.provider === selection!.provider && m.id === selection!.id && m.levels.includes(selection!.thinking)))
              throw new AppError("MODEL_UNAVAILABLE", "子模型不可用");
            selection = { provider: selection.provider, id: selection.id, thinking: selection.thinking };
          }
        }
        const budgets = { ...this.records.preferences(), ...patch };
        this.store.db.exec("BEGIN IMMEDIATE");
        try {
          if (p.budgets !== undefined) this.store.db.prepare(
            "INSERT INTO task_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
          ).run(JSON.stringify(budgets));
          if (selection !== undefined) this.store.db.prepare("UPDATE task_model_preferences SET selection=? WHERE id=1")
            .run(selection ? JSON.stringify(selection) : null);
          this.store.db.exec("COMMIT");
        } catch (error) { this.store.db.exec("ROLLBACK"); throw error; }
        if (p.budgets !== undefined) this.scheduler.preferencesChanged();
        this.agents.publish(taskPreferencesScope, this.records.settings());
        // Keep older task-list subscribers consistent with the global default.
        for (const row of selection === undefined ? [] : this.store.db.prepare("SELECT s.id,s.workspaceId FROM task_parents p JOIN sessions s ON s.id=p.sessionId JOIN workspaces w ON w.id=s.workspaceId WHERE w.archived=0").all()) {
          const parent = { workspaceId: String(row.workspaceId), sessionId: String(row.id) };
          this.agents.publish(tasksScope(parent), this.records.list(parent));
        }
        return c.op === "task.default-model" ? this.records.list(scope) : this.records.settings();
      }));
    const child = this.records.child(scope);
    if (c.op === "task.result")
      return this.delivery.result(scope, p.taskId, p.resultId, p.offset, p.limit);
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

    if (c.op === "agent.recall" && child) {
      if (Object.keys(p).length) throw new AppError("INVALID_INPUT", "撤回不接受额外参数");
      return this.serial(child.id, () => this.store.external(c, () =>
        this.scheduler.recall(this.records.own(parent(child), child.id))));
    }
    if (c.op === "agent.stop")
      return this.store.external(c, async () => {
        if (p.runId !== this.agents.info(scope).run?.id)
          throw new AppError("RUN_MISMATCH", "执行已变化，未停止其他执行");
        if (child) {
          const response = this.scheduler.cancel(child, {
            reason: "用户停止子会话",
          });
          return response;
        }
        await this.stopParent(scope);
        return this.agents.info(scope);
      });
    if (child && c.op === "agent.resume") {
      if (typeof p.expectedRunId !== "string" || Object.keys(p).some((key) => key !== "expectedRunId"))
        throw new AppError("INVALID_INPUT", "重试只接受原执行标识。");
      return this.serial(child.id, () => this.store.external(c, async () =>
        this.scheduler.resume(this.records.own(parent(child), child.id), p.expectedRunId as string, c.requestId)));
    }
    if (child && c.op === "prompt") {
      const images = imagesInput(p.images);
      const attachments = attachmentsInput(p.attachments, p.attachment, images.length);
      const body = text(p.text || (attachments.length || images.length ? "请检查附件。" : ""), "追问", 12000);
      return this.serial(child.id, () =>
        this.store.external(c, async () =>
          this.scheduler.append(this.records.own(parent(child), child.id), {
            text: typeof p.text === "string" ? p.text : body,
            attachments,
            images,
            mode: p.mode ?? "steer",
            expectedRunId: p.expectedRunId,
          }, true, c.requestId),
        ),
      );
    }
    const fresh = this.store.receipt(c.requestId).status === "not_found";
    const newWork =
      fresh && !child && (c.op === "prompt" || c.op === "agent.resume");
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
                  "发送期间父会话已停止；未启动，请发送新要求。",
                );
            },
          }
        : {},
    );
    if (!child && c.op === "agent.model") {
      this.delivery.reconcilePending(scope);
      this.delivery.notify(scope);
    }
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
