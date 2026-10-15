import { randomUUID } from "node:crypto";
import type { Agents } from "../agents.js";
import { AppError, text, attachmentsInput, attachmentPrompt } from "../../shared/protocol.js";
import { running, type Run } from "../../shared/agent.js";
import {
  tasksScope,
  taskActive,
  type StopSource,
} from "../../shared/tasks.js";
import {
  TaskRecords,
  target,
  parent,
  failure,
  type TaskRow as Row,
} from "./records.js";
import { TaskDelivery } from "./delivery.js";
import { configuration } from "../models.js";
import { imagesInput, requireImageModel } from "../images.js";
// Owns launch capacity, live input handoff, budgets and cancellation.
export class TaskScheduler {
  private timers = new Map<string, NodeJS.Timeout>();
  private cancelling = new Map<string, Promise<void>>();
  private launching = new Set<string>();
  private nativePending = new Map<string, Set<string>>();
  private handed = new Set<string>();
  private recalling = new Set<string>();
  private failedInputs = new Set<string>();
  private scheduled = false;
  private pumping = false;
  private jobs = new Set<Promise<unknown>>();
  closing = false;
  readonly store;
  constructor(
    readonly agents: Agents,
    readonly records: TaskRecords,
    readonly delivery: TaskDelivery,
  ) {
    this.store = records.store;
  }
  settle(row: Row, run: Run, recovery = false) {
    row = this.records.rows("WHERE id=?", row.id)[0];
    if (!row || row.runId !== run.id || this.store.db.prepare("SELECT 1 FROM task_results WHERE runId=?").get(run.id)) return;
    clearTimeout(this.timers.get(run.id));
    this.timers.delete(run.id);
    for (const input of ["queued", "starting", "inflight"].flatMap((state) => this.records.inputs(row, state))) {
      this.records.drafts.delete(input.id);
      this.handed.delete(input.id);
      this.failedInputs.delete(input.id);
      this.records.receipt(input.id, "failed", "执行已结束，输入未确认送达；未自动重发。", run.id);
    }
    this.nativePending.delete(row.id);
    this.delivery.save(row, run);
    const waiting = this.records.inputs(row, "waiting");
    if (waiting.length && !recovery && !this.closing) {
      this.store.db.exec("BEGIN IMMEDIATE");
      try {
        this.records.enqueue(this.records.rows("WHERE id=?", row.id)[0]);
        this.store.db.prepare("UPDATE task_inputs SET state='queued',runId=NULL WHERE taskId=? AND state='waiting' AND runId=?").run(row.id, run.id);
        this.store.db.exec("COMMIT");
      } catch (error) { this.store.db.exec("ROLLBACK"); throw error; }
      this.kick();
    } else if (waiting.length) {
      this.records.deliver(row, waiting.map((input) => input.id), "cancelled");
    }
    this.changed(row);
    if (!recovery) this.delivery.notify(parent(row));
  }
  event(row: Row, run: Run, event: any) {
    row = this.records.rows("WHERE id=?", row.id)[0];
    if (!row || row.runId !== run.id || !["starting", "running"].includes(row.status)) return;
    if (event.type === "running") {
      this.store.db
        .prepare(
          "UPDATE tasks SET status='running' WHERE id=? AND status='starting'",
        )
        .run(row.id);
      this.sendInputs(this.records.rows("WHERE id=?", row.id)[0]);
      this.changed(row);
    }
    if (event.type === "queue") {
      this.nativePending.set(row.id, new Set([...event.queue, ...event.native].map((input: { id: string }) => input.id)));
      this.changed(row);
    }
    if (event.type === "input-accepted") {
      this.records.receipt(event.id, "accepted", null, run.id);
      this.changed(row);
    }
    if (event.type === "input-error") {
      this.handed.delete(event.id);
      this.records.receipt(event.id, "failed", event.error || "追加输入未送达；未自动重发。", run.id);
      if (this.records.drafts.has(event.id)) this.failedInputs.add(event.id);
      else this.store.db.prepare("DELETE FROM task_inputs WHERE id=? AND taskId=? AND runId=? AND state='inflight'").run(event.id, row.id, run.id);
      this.store.db.prepare("UPDATE tasks SET error=? WHERE id=?").run(event.error || "追加输入未送达；未自动重发。", row.id);
      this.changed(row);
    }
    if (event.type === "delivered") {
      this.records.deliver(row, event.ids, "delivered", run.id);
      for (const id of event.ids) { this.handed.delete(id); this.failedInputs.delete(id); this.nativePending.get(row.id)?.delete(id); }
      this.changed(row);
    }
  }
  async stop(rows: Row[], reason: string, source: StopSource = "parent") {
    for (const row of rows)
      if (taskActive(row.status))
        this.cancel(row, { reason }, source);
    await Promise.allSettled(
      rows.flatMap((row) =>
        this.cancelling.has(row.id) ? [this.cancelling.get(row.id)!] : [],
      ),
    );
  }
  async close() {
    this.closing = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    const rows = this.records.rows();
    for (const row of rows) this.records.freeze(parent(row));
    await Promise.all([this.stop(rows, "服务正在退出", "shutdown"), this.agents.close()]);
    await Promise.allSettled(this.jobs);
  }
  private changed(row: Row) {
    const order = new Map([...this.records.drafts.keys()].map((id, index) => [id, index]));
    const queue = ["queued", "waiting", "starting", "inflight"].flatMap((state) => this.records.inputs(row, state))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      .filter((input) => this.records.drafts.has(input.id) &&
        (input.state === "queued" || (input.state === "starting" && !this.nativePending.has(row.id)) || this.failedInputs.has(input.id) || !this.handed.has(input.id) || this.nativePending.get(row.id)?.has(input.id)))
      .map((input) => ({ id: input.id, text: this.records.drafts.get(input.id)!.text,
        mode: input.mode as "steer" | "followUp" }));
    this.agents.setQueue?.(target(row), queue);
    this.agents.publish(
      tasksScope(parent(row)),
      this.records.list(parent(row)),
    );
    this.agents.publish(
      `agent:${row.workspaceId}:${row.sessionId}`,
      this.agents.info(target(row)),
    );
    this.agents.publish(`agent:${row.workspaceId}:${row.parentSessionId}`, this.agents.info(parent(row)));
    this.agents.publish(`thread:${row.workspaceId}:${row.parentSessionId}`, this.agents.thread(parent(row)));
    this.agents.publish(`sessions:${row.workspaceId}`);
  }
  private track<T>(job: Promise<T>) {
    this.jobs.add(job);
    void job.finally(() => this.jobs.delete(job)).catch(() => {});
    return job;
  }
  async append(row: Row, p: Record<string, unknown>, editable = false, requestId?: string) {
    const stopEpoch = this.records.stopEpoch(parent(row));
    const images = imagesInput(p.images);
    const attachments = attachmentsInput(p.attachments, p.attachment, images.length);
    if (images.length) {
      const config = await configuration(this.store.root);
      const info = this.agents.info(target(row));
      const selection = running(info.run) ? info.run!.selection : info.selection;
      requireImageModel(config.available.find((m) => m.provider === selection?.provider && m.id === selection?.id), images);
      row = this.records.rows("WHERE id=?", row.id)[0];
    }
    const body = attachmentPrompt(
        text(p.text || (attachments.length || images.length ? "请检查附件。" : ""), "追问", 12000), attachments),
      mode = p.mode ?? "steer";
    if (mode !== "steer")
      throw new AppError("INVALID_INPUT", "新增追问只支持 steer");
    row = this.records.rows("WHERE id=?", row.id)[0];
    if (
      this.closing ||
      this.records.stopEpoch(parent(row)) !== stopEpoch
    )
      throw new AppError("TASK_STOPPED", "发送期间会话已停止，未接受输入。");
    if (
      Number(
        this.store.db
          .prepare(
            "SELECT COUNT(*) AS n FROM task_inputs WHERE taskId=?",
          )
          .get(row.id)!.n,
      ) >= 32
    )
      throw new AppError(
        "TASK_LIMIT",
        "此子会话待处理输入达到 32 条，请稍后发送",
      );
    if (p.expectedRunId !== undefined) this.agents.assertContinuation(target(row), p.expectedRunId);
    let id: string;
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      if (!taskActive(row.status)) this.records.enqueue(row);
      id = this.records.queue(row.id, body, mode, images, requestId);
      if (row.status === "stopping") this.store.db.prepare("UPDATE task_inputs SET state='waiting',runId=? WHERE id=?").run(row.runId, id);
      this.store.db.exec("COMMIT");
    } catch (error) { this.store.db.exec("ROLLBACK"); throw error; }
    if (editable) this.records.drafts.set(id, { text: typeof p.text === "string" ? p.text : "", attachment: null, attachments, images });
    if (row.status === "running") this.sendInputs(row);
    this.changed(row);
    this.kick();
    const receipt = this.store.db.prepare("SELECT state,error,runId FROM task_input_receipts WHERE inputId=?").get(id)!;
    if (receipt.state === "failed") throw new AppError("INPUT_NOT_DELIVERED", String(receipt.error));
    return { taskId: row.id, inputId: id, runId: receipt.runId, status: receipt.state };
  }
  resume(row: Row, expectedRunId: string, requestId: string) {
    if (this.closing || this.cancelling.has(row.id))
      throw new AppError("TASK_STOPPED", "子会话正在停止，暂时无法重试。");
    this.agents.assertContinuation(target(row), expectedRunId);
    // A control item shares capacity, stop and receipt handling with task inputs,
    // but is never sent to the model as text or batched with user requirements.
    let id: string;
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      this.records.enqueue(row);
      id = this.records.queue(row.id, expectedRunId, "resume", [], requestId);
      this.store.db.exec("COMMIT");
    } catch (error) { this.store.db.exec("ROLLBACK"); throw error; }
    this.changed(row);
    this.kick();
    return { taskId: row.id, inputId: id, status: "queued" };
  }
  async recall(row: Row) {
    // Freeze handoff/preflight before yielding. A failed worker recall must not
    // erase queued drafts whose successful withdrawal could not be returned.
    this.recalling.add(row.id);
    try {
      const queued = ["queued", "waiting"].flatMap((state) => this.records.inputs(row, state)).filter((input) => this.records.drafts.has(input.id));
      const sent = ["starting", "inflight"].flatMap((state) => this.records.inputs(row, state))
        .filter((input) => this.records.drafts.has(input.id));
      const snapshot = new Map(this.records.drafts);
      const native = sent.filter((input) => !this.failedInputs.has(input.id));
      const ids = native.length ? await this.agents.recallIds(target(row), native.map((input) => input.id)) : [];
      const removed = new Set([...queued.map((input) => input.id), ...ids,
        ...sent.filter((input) => this.failedInputs.has(input.id)).map((input) => input.id)]);
      for (const id of removed) { this.failedInputs.delete(id); this.handed.delete(id); this.nativePending.get(row.id)?.delete(id); }
      this.records.deliver(row, [...removed], "cancelled");
      if (this.records.rows("WHERE id=?", row.id)[0]?.status === "queued" && !this.records.inputs(row, "queued").length)
        this.store.db.prepare("UPDATE tasks SET status='interrupted',error=NULL WHERE id=?").run(row.id);
      this.changed(row);
      return { drafts: [...snapshot].filter(([id]) => removed.has(id)).map(([, draft]) => draft), ...(removed.size ? { ids: [...removed] } : {}) };
    } finally {
      this.recalling.delete(row.id);
      const current = this.records.rows("WHERE id=?", row.id)[0];
      if (current) this.sendInputs(current);
      this.kick();
    }
  }
  private sendInputs(row: Row) {
    if (!row.runId || row.status !== "running" || this.recalling.has(row.id)) return;
    for (const input of this.records.inputs(row, "queued")) {
      this.records.receipt(input.id, "queued", null, row.runId);
      this.handed.add(input.id);
      this.store.db
        .prepare("UPDATE task_inputs SET state='inflight',runId=? WHERE id=?")
        .run(row.runId, input.id);
      if (
        !this.agents.signal(target(row), row.runId, {
          type: "input",
          id: input.id,
          text: input.body,
          images: this.records.images(input.id),
          mode: input.mode,
        })
      ) {
        this.handed.delete(input.id);
        this.records.receipt(input.id, "failed", "追加输入未送达；未自动重发。", row.runId);
        if (this.records.drafts.has(input.id)) this.failedInputs.add(input.id);
        else this.store.db.prepare("DELETE FROM task_inputs WHERE id=?").run(input.id);
        this.store.db.prepare("UPDATE tasks SET error=? WHERE id=?")
          .run("追加输入未送达；未自动重发。", row.id);
      }
    }
  }
  kick() {
    if (this.closing || this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      this.track(this.pump()).catch(() => {});
    });
  }
  private async pump() {
    if (this.pumping || this.closing) return;
    this.pumping = true;
    try {
      for (const row of this.records.rows(
        "JOIN task_queue_order q ON q.taskId=tasks.id WHERE status='queued' ORDER BY q.seq",
      )) {
        const active =
          this.records
            .rows()
            .filter((t) =>
              [
                "starting",
                "running",
                "stopping",
              ].includes(t.status),
            ).length +
          this.records
            .rows("WHERE status='queued'")
            .filter((t) => this.launching.has(t.id)).length;
        if (active >= this.records.preferences().concurrency || this.closing)
          break;
        if (this.launching.has(row.id) || this.recalling.has(row.id) || this.cancelling.has(row.id) || this.agents.active(target(row))) continue;
        this.launching.add(row.id);
        this.track(
          this.start(row).finally(() => {
            this.launching.delete(row.id);
            this.kick();
          }),
        ).catch(() => {});
      }
    } finally {
      this.pumping = false;
    }
  }
  private async start(row: Row) {
    const queued = this.records.inputs(row, "queued");
    // Editable drafts retain independent identity; legacy delegation/tool inputs
    // keep their initial batching through the first image-bearing input.
    const editableAt = queued.findIndex((input) => this.records.drafts.has(input.id));
    const resuming = queued[0]?.mode === "resume";
    const batch = resuming || editableAt === 0 ? queued.slice(0, 1) : editableAt < 0 ? queued : queued.slice(0, editableAt);
    const firstImage = batch.findIndex((input) => this.records.images(input.id).length > 0);
    const inputs = firstImage < 0 ? batch : batch.slice(0, firstImage + 1);
    const images = firstImage < 0 ? [] : this.records.images(inputs.at(-1)!.id);
    if (!inputs.length) {
      this.store.db
        .prepare(
          "UPDATE tasks SET status='interrupted',error='没有待发送输入；未自动重发' WHERE id=?",
        )
        .run(row.id);
      this.changed(row);
      return;
    }
    try {
      const budgetContext = { workMs: this.records.preferences().workMs, elapsedMs: this.records.elapsed(row.id) };
      await this.agents.command(
        {
          requestId: randomUUID(),
          op: resuming ? "agent.resume" : "prompt",
          ...target(row),
          params: resuming ? { expectedRunId: inputs[0].body } : { text: "处理明确委派／追加的子任务", images },
        },
        {
          prompt: resuming ? undefined : inputs.map((i) => i.body).join("\n\n"),
          task: {
            id: row.id,
            role: row.role,
            inputIds: inputs.map((i) => i.id),
            editable: inputs.every((i) => this.records.drafts.has(i.id)),
            budget: budgetContext,
          },
          beforeStart: () => {
            if (
              this.closing || this.recalling.has(row.id) ||
              this.records.rows("WHERE id=?", row.id)[0]?.status !== "queued" ||
              !inputs.every((input) =>
                this.records.inputs(row, "queued").some((queued) => queued.id === input.id),
              )
            )
              throw new AppError("TASK_STOPPED", "子任务已停止，未启动");
          },
          onStart: (run) => {
            this.store.db
              .prepare(
                "UPDATE tasks SET status='starting',runId=?,error=NULL WHERE id=?",
              )
              .run(run.id, row.id);
            this.store.db.prepare("DELETE FROM task_stops WHERE taskId=?").run(row.id);
            for (const input of inputs) {
              this.records.receipt(input.id, "queued", null, run.id);
              this.handed.add(input.id);
              this.store.db
                .prepare(
                  "UPDATE task_inputs SET state='starting',runId=? WHERE id=?",
                )
                .run(run.id, input.id);
            }
            budgetContext.workMs = this.records.preferences().workMs;
            const budgets = JSON.stringify(this.records.preferences());
            this.store.db.prepare("UPDATE tasks SET budgets=? WHERE id=?").run(budgets, row.id);
            this.arm({ ...row, budgets }, run);
            this.changed(row);
          },
        },
      );
    } catch (e) {
      const current = this.records.rows("WHERE id=?", row.id)[0];
      if (!current) return;
      const run = this.agents.info(target(current)).run;
      if (current.status === "starting" && run && !running(run))
        this.settle(current, run);
      else if (
        current.status === "queued" && !this.recalling.has(row.id) &&
        inputs.every((input) =>
          this.records.inputs(current, "queued").some((queued) => queued.id === input.id),
        )
      )
        this.finishUnstarted(current, "failed", failure(e));
    }
  }
  preferencesChanged() {
    const budgets = JSON.stringify(this.records.preferences());
    for (const row of this.records.rows("WHERE status IN ('queued','starting','running')")) {
      this.store.db.prepare("UPDATE tasks SET budgets=? WHERE id=?").run(budgets, row.id);
      const current = { ...row, budgets };
      const run = this.agents.info(target(row)).run;
      if (run && run.id === row.runId && ["starting", "running"].includes(row.status)) {
        this.arm(current, run);
        this.agents.signal(target(row), run.id, { type: "budget", workMs: this.records.preferences().workMs,
          deadlineAt: run.startedAt + this.records.preferences().workMs });
      }
      this.changed(current);
    }
    this.kick();
  }
  private arm(row: Row, run: Run) {
    clearTimeout(this.timers.get(run.id));
    const budgets = this.records.budgets(row.budgets);
    const timer = setTimeout(() => {
      const current = this.records.rows("WHERE id=?", row.id)[0];
      if (
        !current ||
        current.runId !== run.id ||
        !["starting", "running"].includes(current.status)
      )
        return;
      this.cancel(current, { reason: "子任务工作预算已到" }, "budget");
    }, Math.max(0, budgets.workMs - (Date.now() - run.startedAt)));
    this.timers.set(run.id, timer);
  }
  cancel(row: Row, p: Record<string, unknown>, source: StopSource = "user") {
    if (Object.keys(p).some((key) => !["taskId", "reason"].includes(key)))
      throw new AppError("INVALID_INPUT", "停止仅支持 taskId 和 reason");
    const reason = p.reason === undefined
      ? "用户或主代理请求停止"
      : text(p.reason, "停止原因", 2000);
    const current = this.records.rows("WHERE id=?", row.id)[0];
    row = current;
    if (!taskActive(current.status))
      return { taskId: row.id, status: current.status };
    const inputs = ["queued", "waiting", "starting", "inflight"].flatMap((state) => this.records.inputs(row, state));
    try { this.delivery.reconcileInputs(row); } catch { /* An unreadable transcript never prevents a requested stop. */ }
    for (const input of inputs) {
      this.handed.delete(input.id);
      this.failedInputs.delete(input.id);
      this.records.receipt(input.id, "cancelled", reason);
      this.records.drafts.delete(input.id);
    }
    this.nativePending.delete(row.id);
    this.store.db.prepare("DELETE FROM task_inputs WHERE taskId=?").run(row.id);
    if (this.cancelling.has(row.id) || row.status === "stopping") {
      this.changed(row);
      return { taskId: row.id, status: current.status };
    }
    this.store.db.prepare("INSERT OR REPLACE INTO task_stops VALUES(?,?)").run(row.id, JSON.stringify({ source, reason, requestedAt: Date.now() }));
    this.store.db
      .prepare("UPDATE tasks SET status=?,error=? WHERE id=?")
      .run(
        this.agents.active(target(row)) ? "stopping" : "cancelled",
        reason,
        row.id,
      );
    clearTimeout(this.timers.get(row.runId ?? ""));
    this.timers.delete(row.runId ?? "");
    if (!this.agents.active(target(row))) {
      this.finishUnstarted(row, "cancelled", reason);
      this.kick();
      return { taskId: row.id, status: "cancelled" };
    }
    const operation = this.agents
      .stop(target(row), source)
      .catch((e) => {
        this.store.db
          .prepare("UPDATE tasks SET error=? WHERE id=?")
          .run(failure(e), row.id);
        this.changed(row);
      })
      .finally(() => {
        this.cancelling.delete(row.id);
        this.kick();
      });
    this.cancelling.set(row.id, operation);
    this.track(operation);
    this.changed(row);
    return { taskId: row.id, status: "stopping" };
  }
  private finishUnstarted(
    row: Row,
    status: "cancelled" | "failed",
    reason: string,
  ) {
    // Preflight failure / queue cancellation still produces a report, without launching a worker.
    const selection = this.agents.info(target(row)).selection!;
    const run: Run = {
      id: randomUUID(),
      sessionId: row.sessionId,
      status,
      selection,
      startedAt: Date.now(),
      endedAt: Date.now(),
      error: reason,
    };
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      this.store.db
        .prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,endedAt,error) VALUES(?,?,?,?,?,?,?)")
        .run(
          run.id,
          row.sessionId,
          status,
          JSON.stringify(selection),
          run.startedAt,
          run.endedAt,
          reason,
        );
      this.store.db
        .prepare("UPDATE tasks SET runId=?,status=?,error=? WHERE id=?")
        .run(run.id, status, reason, row.id);
      this.records.deliver(row, ["queued", "starting", "inflight"].flatMap((state) => this.records.inputs(row, state)).map((input) => input.id), status === "cancelled" ? "cancelled" : "failed");
      this.store.db.exec("COMMIT");
    } catch (e) {
      this.store.db.exec("ROLLBACK");
      throw e;
    }
    this.settle({ ...row, runId: run.id, status, error: reason }, run);
  }
}
