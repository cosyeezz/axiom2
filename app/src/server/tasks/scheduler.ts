import type { ServiceRecovery } from "../service-recovery-records.js";
import { assertServiceRecovery } from "../service-recovery.js";
import { rewriteTarget } from "../session-rewrite.js";
import { randomUUID } from "node:crypto";
import type { Agents } from "../agents.js";
import { skillsInput } from "../../shared/skills.js";
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
import { taskSummaryMs, type TaskBudget } from "../task-budget.js";
// Owns launch capacity, live input handoff, budgets and cancellation.
export class TaskScheduler {
  private timers = new Map<string, NodeJS.Timeout>();
  private cancelling = new Map<string, Promise<void>>();
  private launching = new Set<string>();
  private nativePending = new Map<string, Set<string>>();
  private nativeQueues = new Map<string, string>();
  private pendingViews = new Set<string>();
  private viewFlush?: NodeJS.Immediate;
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
      const state = input.state === "queued" || this.failedInputs.has(input.id) ? "failed" : "unknown";
      this.failedInputs.delete(input.id);
      this.records.receipt(input.id, state, state === "unknown"
        ? "执行已结束，输入送达未确认；未自动重发。" : "执行已结束，输入未发送；未自动重发。", run.id, row.id);
    }
    this.store.db.prepare(`UPDATE task_input_receipts SET state='unknown',error='执行已结束，输入送达未确认；未自动重发。',updatedAt=?
      WHERE taskId=? AND runId=? AND state IN ('accepted','unknown')`).run(Date.now(), row.id, run.id);
    this.nativePending.delete(row.id);
    this.nativeQueues.delete(row.id);
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
    if (event.type === "ready") this.syncBudget(row);
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
      const key = JSON.stringify([run.id, event.queue, event.native]);
      if (this.nativeQueues.get(row.id) === key) return;
      this.nativeQueues.set(row.id, key);
      this.nativePending.set(row.id, new Set([...event.queue, ...event.native].map((input: { id: string }) => input.id)));
      this.changed(row, "queue");
    }
    if (event.type === "input-accepted") {
      if (!this.records.receipt(event.id, "accepted", null, run.id, row.id)) return;
      this.failedInputs.delete(event.id);
      this.changed(row, "input");
    }
    if (event.type === "input-error") {
      const receipt = this.store.db.prepare("SELECT state FROM task_input_receipts WHERE inputId=? AND taskId=? AND runId=?")
        .get(event.id, row.id, run.id);
      // An uncertain transport error is weaker evidence than an actual acceptance.
      if (!receipt || event.uncertain && receipt.state === "accepted" ||
          !this.records.receipt(event.id, event.uncertain ? "unknown" : "failed",
            event.error || (event.uncertain ? "追加输入送达未确认；未自动重发。" : "追加输入未送达；未自动重发。"), run.id, row.id)) return;
      if (!event.uncertain) {
        this.handed.delete(event.id);
        if (this.records.drafts.has(event.id)) this.failedInputs.add(event.id);
        else this.store.db.prepare("DELETE FROM task_inputs WHERE id=? AND taskId=? AND runId=? AND state='inflight'").run(event.id, row.id, run.id);
      }
      this.changed(row, "input");
    }
    if (event.type === "delivered") {
      this.records.deliver(row, event.ids, "delivered", run.id);
      for (const id of event.ids) { this.handed.delete(id); this.failedInputs.delete(id); this.nativePending.get(row.id)?.delete(id); }
      this.changed(row, "input");
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
    await Promise.all([this.stop(rows.filter(row => row.status !== "queued"), "服务正在退出", "shutdown"), this.agents.close()]);
    await Promise.allSettled(this.jobs);
    this.flushViews();
  }
  private flushViews() {
    if (this.viewFlush) clearImmediate(this.viewFlush);
    this.viewFlush = undefined;
    const scopes = [...this.pendingViews];
    this.pendingViews.clear();
    for (const scope of scopes) {
      try { this.agents.publish(scope); }
      catch (error) {
        if (!(error instanceof AppError) || error.code !== "SCOPE_MISMATCH") throw error;
      }
    }
  }
  private changed(row: Row, kind: "queue" | "input" | "lifecycle" = "lifecycle") {
    const order = new Map([...this.records.drafts.keys()].map((id, index) => [id, index]));
    const queue = ["queued", "waiting", "starting", "inflight"].flatMap((state) => this.records.inputs(row, state))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      .filter((input) => this.records.drafts.has(input.id) &&
        (input.state === "queued" || (input.state === "starting" && !this.nativePending.has(row.id)) || this.failedInputs.has(input.id) || !this.handed.has(input.id) || this.nativePending.get(row.id)?.has(input.id)))
      .map((input) => ({ id: input.id, text: this.records.drafts.get(input.id)!.text,
        mode: input.mode as "steer" | "followUp", ...(this.records.skills(input.id).length ? { skills: this.records.skills(input.id) } : {}) }));
    this.agents.setQueue?.(target(row), queue, false);
    this.pendingViews.add(`agent:${row.workspaceId}:${row.sessionId}`);
    if (kind !== "queue") this.pendingViews.add(tasksScope(parent(row)));
    if (kind === "lifecycle") {
      this.pendingViews.add(`agent:${row.workspaceId}:${row.parentSessionId}`);
      this.pendingViews.add(`thread:${row.workspaceId}:${row.parentSessionId}`);
      this.pendingViews.add(`sessions:${row.workspaceId}`);
    }
    // Publish invalidations, not captured snapshots. The production publisher
    // retains attention/cost side effects and only builds observed payloads.
    this.viewFlush ??= setImmediate(() => this.flushViews());
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
    const skills = skillsInput(p.skills);
    if (images.length) {
      const config = await configuration(this.store.root);
      const info = this.agents.info(target(row));
      const selection = running(info.run) ? info.run!.selection : info.selection;
      requireImageModel(config.available.find((m) => m.provider === selection?.provider && m.id === selection?.id), images);
      row = this.records.rows("WHERE id=?", row.id)[0];
    }
    const body = attachmentPrompt(
        text(p.text || (attachments.length || images.length ? "请检查附件。" : skills.length ? "请使用所选技能。" : ""), "追问", 12000), attachments),
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
    const rewrite = p.rewrite === undefined ? undefined : rewriteTarget(p.rewrite);
    if (rewrite && this.agents.editable(target(row), rewrite.messageId).revision !== rewrite.revision)
      throw new AppError("REWRITE_CONFLICT", "编辑期间会话已变化；请重新打开该消息后修改。");
    if (p.expectedRunId !== undefined) this.agents.assertContinuation(target(row), p.expectedRunId);
    let id: string;
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      if (!taskActive(row.status)) this.records.enqueue(row);
      id = this.records.queue(row.id, rewrite ? JSON.stringify({ text: p.text, attachments, skills, rewrite }) : body, rewrite ? "rewrite" : mode, images, requestId, skills);
      if (row.status === "stopping") this.store.db.prepare("UPDATE task_inputs SET state='waiting',runId=? WHERE id=?").run(row.runId, id);
      if (["starting", "running"].includes(row.status)) {
        const now = Date.now(), budgets = this.records.preferences();
        this.store.db.prepare("UPDATE tasks SET workStartedAt=?,workDeadlineAt=?,summaryDeadlineAt=NULL,budgetRevision=budgetRevision+1,budgets=? WHERE id=?")
          .run(now, now + budgets.workMs, JSON.stringify(budgets), row.id);
      }
      this.store.db.exec("COMMIT");
    } catch (error) { this.store.db.exec("ROLLBACK"); throw error; }
    if (editable) this.records.drafts.set(id, { text: typeof p.text === "string" ? p.text : "", attachment: null, attachments, images, ...(skills.length ? { skills } : {}) });
    row = this.records.rows("WHERE id=?", row.id)[0];
    const activeRun = this.agents.info(target(row)).run;
    if (activeRun?.id === row.runId && ["starting", "running"].includes(row.status)) this.arm(row, activeRun);
    if (row.status === "running") this.sendInputs(row);
    this.changed(row);
    this.kick();
    const receipt = this.store.db.prepare("SELECT state,error,runId FROM task_input_receipts WHERE inputId=?").get(id)!;
    if (receipt.state === "failed") throw new AppError("INPUT_NOT_DELIVERED", String(receipt.error));
    return { taskId: row.id, inputId: id, runId: receipt.runId, status: receipt.state };
  }
  recover(row: Row, recovery: ServiceRecovery) {
    if (this.closing) throw new AppError("SHUTTING_DOWN", "服务正在退出");
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      assertServiceRecovery(this.agents, recovery);
      const inputs = JSON.parse(recovery.payload) as Array<{ id: string; taskId: string; body: string; mode: string; createdAt: number; images: string | null; skills: string | null }>;
      if (recovery.kind === "resume") {
        this.agents.assertContinuation(target(row), recovery.runId);
        const id = `service-resume-${recovery.runId}`;
        const createdAt = Math.min(Date.now(), ...inputs.map(input => input.createdAt)) - 1;
        this.store.db.prepare("INSERT OR IGNORE INTO task_inputs VALUES(?,?,?,'resume','queued',NULL,?)").run(id, row.id, recovery.runId, createdAt);
        this.store.db.prepare("INSERT INTO task_input_receipts VALUES(?,?,NULL,'queued',NULL,?) ON CONFLICT(inputId) DO UPDATE SET runId=NULL,state='queued',error=NULL,updatedAt=excluded.updatedAt")
          .run(id, row.id, Date.now());
      }
      for (const input of inputs) {
          if (recovery.kind === "resume" && input.mode === "resume") continue;
          if (input.taskId !== row.id) throw new AppError("INVALID_INPUT", "恢复队列归属无效");
          this.store.db.prepare("INSERT OR IGNORE INTO task_inputs VALUES(?,?,?,?,'queued',NULL,?)")
            .run(input.id, row.id, input.body, input.mode, input.createdAt);
          this.store.db.prepare("INSERT INTO task_input_receipts VALUES(?,?,NULL,'queued',NULL,?) ON CONFLICT(inputId) DO UPDATE SET runId=NULL,state='queued',error=NULL,updatedAt=excluded.updatedAt")
            .run(input.id, row.id, Date.now());
          if (input.images) this.store.db.prepare("INSERT OR REPLACE INTO task_input_images VALUES(?,?)").run(input.id, input.images);
          if (input.skills) this.store.db.prepare("INSERT OR REPLACE INTO task_input_skills VALUES(?,?)").run(input.id, input.skills);
      }
      this.store.db.prepare("INSERT OR IGNORE INTO task_queue_order(taskId) VALUES(?)").run(row.id);
      this.store.db.prepare("UPDATE tasks SET status='queued',error=NULL WHERE id=?").run(row.id);
      this.store.db.exec("COMMIT");
    } catch (error) { this.store.db.exec("ROLLBACK"); throw error; }
    this.changed(row);
    this.kick();
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
          skills: this.records.skills(input.id),
          mode: input.mode,
          budget: this.budget(row),
        })
      ) {
        this.handed.delete(input.id);
        this.records.receipt(input.id, "failed", "追加输入未送达；未自动重发。", row.runId, row.id);
        if (this.records.drafts.has(input.id)) this.failedInputs.add(input.id);
        else this.store.db.prepare("DELETE FROM task_inputs WHERE id=?").run(input.id);
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
      const concurrency = this.records.preferences().concurrency;
      let active = Number(this.store.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status IN ('starting','running','stopping')").get()!.n) +
        this.records.rows("WHERE status='queued'").filter((t) => this.launching.has(t.id)).length;
      for (const row of this.records.rows(
        "JOIN task_queue_order q ON q.taskId=tasks.id WHERE status='queued' ORDER BY q.seq",
      )) {
        if (active >= concurrency || this.closing)
          break;
        if (this.launching.has(row.id) || this.recalling.has(row.id) || this.cancelling.has(row.id) || this.agents.active(target(row))) continue;
        this.launching.add(row.id);
        active++;
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
    const recovery = this.store.recoveries.get(row.sessionId);
    const queued = this.records.inputs(row, "queued");
    // Keep the initial delegation distinct from queued appends so its durable
    // input identity can display the original brief without hiding later work.
    // Editable drafts and legacy inputs retain their existing batching rules.
    const editableAt = queued.findIndex((input) => this.records.drafts.has(input.id) || this.records.skills(input.id).length || input.mode === "resume" || input.mode === "rewrite");
    const resuming = queued[0]?.mode === "resume";
    const rewriting = queued[0]?.mode === "rewrite";
    const batch = queued[0]?.id === row.initialInputId || resuming || rewriting || editableAt === 0 ? queued.slice(0, 1) : editableAt < 0 ? queued : queued.slice(0, editableAt);
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
      const budgetContext: TaskBudget = { workMs: this.records.preferences().workMs, elapsedMs: this.records.elapsed(row.id) };
      await this.agents.command(
        {
          requestId: randomUUID(),
          op: resuming ? "agent.resume" : "prompt",
          ...target(row),
          params: resuming ? { expectedRunId: inputs[0].body } : rewriting ? { ...JSON.parse(inputs[0].body), images } : { text: "处理明确委派／追加的子任务", images, skills: this.records.skills(inputs[0].id) },
        },
        {
          prompt: resuming || rewriting ? undefined : inputs.map((i) => i.body).join("\n\n"),
          task: {
            id: row.id,
            inputIds: inputs.map((i) => i.id),
            editable: inputs.every((i) => this.records.drafts.has(i.id)),
            budget: budgetContext,
          },
          beforeStart: () => {
            if (recovery) assertServiceRecovery(this.agents, recovery);
            if (
              this.closing || this.recalling.has(row.id) ||
              this.records.rows("WHERE id=?", row.id)[0]?.status !== "queued" ||
              !inputs.every((input) =>
                this.records.inputs(row, "queued").some((queued) => queued.id === input.id),
              )
            )
              throw new AppError("TASK_STOPPED", "子任务已停止，未启动");
            const active = Number(this.store.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status IN ('starting','running','stopping')").get()!.n);
            const earlier = this.records.rows("JOIN task_queue_order q ON q.taskId=tasks.id WHERE status='queued' AND q.seq < (SELECT seq FROM task_queue_order WHERE taskId=?)", row.id)
              .filter((candidate) => this.launching.has(candidate.id)).length;
            if (active + earlier >= this.records.preferences().concurrency)
              throw new AppError("TASK_CAPACITY_DEFERRED", "等待可用子任务容量");
          },
          onCommit: (run) => {
            this.store.db
              .prepare(
                "UPDATE tasks SET status='starting',runId=?,error=NULL,workStartedAt=?,workDeadlineAt=?,summaryDeadlineAt=NULL,budgetRevision=budgetRevision+1 WHERE id=?",
              )
              .run(run.id, run.startedAt, run.startedAt + this.records.preferences().workMs, row.id);
            // Restart recovery retains the original deadlines, including summary
            // mode. Repeated service restarts must not grant an unlimited budget.
            if (recovery) this.store.db.prepare("UPDATE tasks SET workDeadlineAt=?,summaryDeadlineAt=? WHERE id=?")
              .run(row.workDeadlineAt ?? run.startedAt + this.records.budgets(row.budgets).workMs, row.summaryDeadlineAt ?? null, row.id);
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
            Object.assign(budgetContext, this.budget(this.records.rows("WHERE id=?", row.id)[0]));
          },
          onStart: (run) => {
            this.syncBudget(this.records.rows("WHERE id=?", row.id)[0]);
            this.arm(this.records.rows("WHERE id=?", row.id)[0], run);
            this.changed(row);
          },
        },
      );
    } catch (e) {
      if (this.closing || e instanceof AppError && e.code === "TASK_CAPACITY_DEFERRED") return;
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
      const run = this.agents.info(target(row)).run;
      if (run && run.id === row.runId && ["starting", "running"].includes(row.status)) {
        if (!row.summaryDeadlineAt) this.store.db.prepare("UPDATE tasks SET workStartedAt=?,workDeadlineAt=?,budgetRevision=budgetRevision+1 WHERE id=?")
          .run(row.workStartedAt ?? run.startedAt, (row.workStartedAt ?? run.startedAt) + this.records.preferences().workMs, row.id);
        const current = this.records.rows("WHERE id=?", row.id)[0];
        this.arm(current, run);
        this.syncBudget(current);
      }
      this.changed(row);
    }
    this.kick();
  }
  private budget(row: Row): TaskBudget {
    return { workMs: this.records.budgets(row.budgets).workMs, elapsedMs: this.records.elapsed(row.id),
      workStartedAt: row.workStartedAt ?? undefined, deadlineAt: row.workDeadlineAt ?? undefined,
      revision: row.budgetRevision ?? 0, summaryDeadlineAt: row.summaryDeadlineAt };
  }
  private syncBudget(row: Row) {
    if (row.runId) this.agents.signal(target(row), row.runId, {
      type: row.summaryDeadlineAt ? "summarize" : "budget", ...this.budget(row),
    });
  }
  private arm(row: Row, run: Run) {
    clearTimeout(this.timers.get(run.id));
    // Older saved tasks and test fixtures may not yet have a work clock.
    if (!row.workDeadlineAt) {
      this.store.db.prepare("UPDATE tasks SET workStartedAt=?,workDeadlineAt=? WHERE id=? AND runId=?")
        .run(run.startedAt, run.startedAt + this.records.budgets(row.budgets).workMs, row.id, run.id);
      row = this.records.rows("WHERE id=?", row.id)[0];
    }
    const deadlineAt = row.summaryDeadlineAt ?? row.workDeadlineAt!;
    const revision = row.budgetRevision;
    const summary = Boolean(row.summaryDeadlineAt);
    const timer = setTimeout(() => {
      const current = this.records.rows("WHERE id=?", row.id)[0];
      if (!current || current.runId !== run.id || current.budgetRevision !== revision ||
          (current.summaryDeadlineAt ?? current.workDeadlineAt) !== deadlineAt ||
          !["starting", "running"].includes(current.status)) return;
      if (summary) {
        this.cancel(current, { reason: "子任务无工具总结已达到 3 分钟上限" }, "budget");
        return;
      }
      this.store.db.prepare("UPDATE tasks SET summaryDeadlineAt=?,budgetRevision=budgetRevision+1 WHERE id=? AND runId=?")
        .run(Date.now() + taskSummaryMs, row.id, run.id);
      const next = this.records.rows("WHERE id=?", row.id)[0];
      // Arm the hard limit before asking the worker to abort its current operation.
      this.arm(next, run);
      this.syncBudget(next);
      this.changed(next);
    }, Math.max(0, deadlineAt - Date.now()));
    timer.unref?.();
    this.timers.set(run.id, timer);
  }
  cancel(row: Row, p: Record<string, unknown>, source: StopSource = "user") {
    if (Object.keys(p).some((key) => !["taskId", "reason"].includes(key)))
      throw new AppError("INVALID_INPUT", "停止仅支持 taskId 和 reason");
    const reason = p.reason === undefined
      ? "用户或主代理请求停止"
      : text(p.reason, "停止原因", 2000);
    const current = this.records.rows("WHERE id=?", row.id)[0];
    if (source !== "shutdown") this.store.recoveries.remove(current.sessionId);
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
    this.nativeQueues.delete(row.id);
    this.store.db.prepare("DELETE FROM task_inputs WHERE taskId=?").run(row.id);
    if (this.cancelling.has(row.id) || row.status === "stopping") {
      this.changed(row);
      return { taskId: row.id, status: current.status };
    }
    this.store.db.prepare("INSERT OR REPLACE INTO task_stops VALUES(?,?)").run(row.id, JSON.stringify({ source, reason, requestedAt: Date.now() }));
    this.store.db
      .prepare("UPDATE tasks SET status=?,error=? WHERE id=?")
      .run(
        this.agents.executing(target(row)) ? "stopping" : "cancelled",
        reason,
        row.id,
      );
    clearTimeout(this.timers.get(row.runId ?? ""));
    this.timers.delete(row.runId ?? "");
    if (!this.agents.executing(target(row))) {
      // A resource waiter owns no Run yet. Revoke it before recording its single unstarted result.
      void this.agents.stop(target(row), source).catch(() => {});
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
