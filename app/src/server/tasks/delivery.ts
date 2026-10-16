import { randomUUID } from "node:crypto";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { Agents } from "../agents.js";
import { openTranscript } from "../transcript.js";
import { AppError, text, type Scope } from "../../shared/protocol.js";
import { running, type Run } from "../../shared/agent.js";
import type { TaskResult } from "../../shared/tasks.js";
import { TaskRecords, target, type TaskRow as Row } from "./records.js";
// Owns immutable reports and durable notification reconciliation, never task scheduling.
export class TaskDelivery {
  private notifying = new Set<string>();
  private settledWhileNotifying = new Set<string>();
  private jobs = new Set<Promise<unknown>>();
  private closing = false;
  readonly store;
  constructor(
    readonly agents: Agents,
    readonly records: TaskRecords,
  ) {
    this.store = records.store;
  }
  private track<T>(job: Promise<T>) {
    this.jobs.add(job);
    void job.finally(() => this.jobs.delete(job)).catch(() => {});
    return job;
  }
  pause() {
    this.closing = true;
  }
  async close() {
    this.pause();
    await Promise.allSettled(this.jobs);
  }
  parentSettled(scope: Scope, _run: Run) {
    if (this.notifying.has(scope.sessionId)) {
      this.settledWhileNotifying.add(scope.sessionId);
      return;
    }
    this.reconcilePending(scope, false);
    this.notify(scope);
  }
  reconcilePending(scope: Scope, retryFailed = true) {
    if (!this.reconcileNotifications(scope) || this.notifying.has(scope.sessionId)) return;
    // Only an explicit new operation authorizes retries. An unconfirmed active
    // attempt stays unknown until its owner has stopped and history is readable.
    const activeRun = this.agents.active(scope) ? this.agents.info(scope).run?.id ?? "" : "";
    this.store.db.prepare(`UPDATE task_results SET delivery='failed'
      WHERE delivery IN ('inflight','unknown') AND taskId IN (SELECT id FROM tasks WHERE parentSessionId=?)
      AND id IN (SELECT j.value FROM task_notification_attempts a, json_each(a.resultIds) j
        WHERE a.sessionId=? AND COALESCE(a.runId,'')!=?
        AND a.rowid=(SELECT MAX(b.rowid) FROM task_notification_attempts b, json_each(b.resultIds) k WHERE b.sessionId=a.sessionId AND k.value=j.value))`).run(scope.sessionId, scope.sessionId, activeRun || "no-active-run");
    if (!activeRun) this.store.db.prepare(`UPDATE task_results SET delivery='failed'
      WHERE delivery IN ('inflight','unknown') AND taskId IN (SELECT id FROM tasks WHERE parentSessionId=?)`).run(scope.sessionId);
    if (retryFailed) this.store.db.prepare(`UPDATE task_results SET delivery='pending'
      WHERE delivery='failed' AND taskId IN (SELECT id FROM tasks WHERE parentSessionId=?)`).run(scope.sessionId);
  }
  rejected(scope: Scope, id: string, error = "通知未进入安全交付边界", uncertain = false) {
    const state = uncertain ? "unknown" : "failed";
    this.store.db.prepare(`UPDATE task_results SET delivery=? WHERE id=? AND delivery!='delivered'
      AND taskId IN (SELECT id FROM tasks WHERE parentSessionId=?)`).run(state, id, scope.sessionId);
    this.store.db.prepare("UPDATE task_notification_attempts SET state=?,error=? WHERE sessionId=? AND state IN ('inflight','unknown') AND EXISTS (SELECT 1 FROM json_each(resultIds) WHERE value=?)")
      .run(state, error, scope.sessionId, id);
  }
  acknowledge(scope: Scope, ids: string[]) {
    for (const id of ids) {
      this.store.db.prepare(`UPDATE task_notification_attempts SET state='delivered',error=NULL WHERE sessionId=? AND state IN ('inflight','unknown')
        AND NOT EXISTS (SELECT 1 FROM json_each(resultIds) j JOIN task_results r ON r.id=j.value WHERE r.delivery!='delivered' AND r.id!=?)`).run(scope.sessionId, id);
      this.store.db
        .prepare(
          "UPDATE task_results SET delivery='delivered' WHERE id=? AND taskId IN (SELECT id FROM tasks WHERE parentSessionId=?)",
        )
        .run(id, scope.sessionId);
    }
  }
  private manager(scope: Scope): SessionManager | null {
    const file = this.store.db
      .prepare("SELECT file FROM agent_sessions WHERE sessionId=?")
      .get(scope.sessionId)?.file;
    return file
      ? openTranscript(
          String(file),
          this.store.workspace(scope.workspaceId).path,
        )
      : null;
  }
  reconcileInputs(row: Row, entries = this.manager(target(row))?.getEntries() ?? []) {
    const consumed = entries.flatMap((entry) => entry.type === "message"
      ? ((entry.message as any).axiomInputIds ?? [])
      : entry.type === "custom_message" && (entry.details as any)?.axiomInput ? [(entry.details as any).axiomInput] : []);
    if (row.runId) this.records.deliver(row, consumed, "delivered", row.runId);
  }
  save(row: Row, run: Run) {
    if (row.runId !== run.id || this.records.rows("WHERE id=?", row.id)[0]?.runId !== run.id ||
        this.store.db.prepare("SELECT 1 FROM task_results WHERE runId=?").get(run.id)) return;
    let report = "未取得可靠的最终回复。",
      known: string[] = [];
    let reportKind: TaskResult["reportKind"] = "system";
    try {
      const entries = this.manager(target(row))?.getEntries() ?? [];
      this.reconcileInputs(row, entries);
      const messages = entries.flatMap((e) =>
        e.type === "message" && (e.message as any).axiomRunId === run.id
          ? [e.message as any]
          : [],
      );
      const complete = messages.filter((m) => m.role === "assistant" && m.stopReason === "stop").at(-1);
      const partial = messages.filter((m) => m.role === "assistant").map((m) =>
        m.content?.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n")).filter(Boolean).join("\n\n");
      const final = complete?.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
      if (final && run.status === "completed") { report = final; reportKind = "final"; }
      else if (partial) { report = partial; reportKind = "partial"; }
      known = messages
        .filter((m) => m.role === "toolResult")
        .map((m) => `${m.toolName}：${m.isError ? "失败" : "已记录返回"}`);
    } catch {
      report = "会话文件无法读取，不能宣称结果完整；原文件保留。";
    }
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      // Inputs belong to this live execution only. Pi owns delivered conversation;
      // exit never turns unacknowledged inputs into a new model request.
      this.store.db.prepare("DELETE FROM task_inputs WHERE taskId=? AND state!='waiting'").run(row.id);
      const status = ["stopping", "cancelled"].includes(
        row.status,
      )
        ? "cancelled"
        : run.status === "completed"
          ? "completed"
          : run.status === "failed"
            ? "failed"
            : run.status === "cancelled"
              ? "cancelled"
              : "interrupted";
      const stop = this.store.db.prepare("SELECT body FROM task_stops WHERE taskId=?").get(row.id);
      const result: TaskResult = {
        id: randomUUID(),
        taskId: row.id,
        runId: run.id,
        status,
        report,
        reportKind,
        ...(row.summaryDeadlineAt ? { budgetSummary: true } : {}),
        elapsedMs: Math.max(0, (run.endedAt ?? Date.now()) - run.startedAt),
        ...(stop ? { stop: JSON.parse(String(stop.body)) } : {}),
        reason: row.error || run.error,
        startedAt: run.startedAt,
        endedAt: run.endedAt ?? Date.now(),
        unfinished:
          status === "completed"
            ? [row.summaryDeadlineAt ? "工作预算已到，本次交付为无工具总结；请核对实际完成情况和未验证项。" : "模型报告不等于全部验收通过；请核对交付中的未验证项。"]
            : ["任务未正常完成；只保留已记录产出，未自动重做。"],
        sideEffects: `${known.length ? known.slice(-30).join("；") : "未记录工具返回"}。文件及外部副作用未回滚。`,
      };
      const inserted = this.store.db
        .prepare(
          "INSERT OR IGNORE INTO task_results(id,taskId,runId,body) VALUES(?,?,?,?)",
        )
        .run(result.id, row.id, run.id, JSON.stringify(result)).changes;
      this.store.db
        .prepare("UPDATE tasks SET status=?,error=? WHERE id=? AND runId=?")
        .run(status, result.reason, row.id, run.id);
      if (inserted) {
        this.store.recordResult(row.sessionId, run.id, "run");
        this.store.recordResult(row.parentSessionId, result.id, "task");
      }
      this.store.db.exec("COMMIT");
    } catch (e) {
      this.store.db.exec("ROLLBACK");
      throw e;
    }
  }
  result(scope: Scope, taskId: unknown, resultId: unknown, offset: unknown = 0, limit: unknown = 16000): TaskResult {
    if (!Number.isSafeInteger(offset) || Number(offset) < 0 || !Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 16000)
      throw new AppError("INVALID_INPUT", "offset 必须为非负整数，limit 必须为 1–16000");
    const task = this.records.own(scope, taskId),
      id = text(resultId, "结果标识");
    const result = this.store.db
      .prepare("SELECT body FROM task_results WHERE id=? AND taskId=?")
      .get(id, task.id);
    if (!result)
      throw new AppError(
        "RESULT_SCOPE_MISMATCH",
        "结果不存在或不属于此任务；读取结果不是进度查询",
      );
    const saved: TaskResult = JSON.parse(String(result.body));
    const start = Number(offset), end = Math.min(saved.report.length, start + Number(limit));
    return { ...saved, report: saved.report.slice(start, end), offset: start, totalLength: saved.report.length,
      truncated: end < saved.report.length, nextOffset: end < saved.report.length ? end : null };
  }
  reconcileNotifications(scope: Scope) {
    if (!this.store.db.prepare(`SELECT 1 FROM task_results r JOIN tasks t ON t.id=r.taskId
      WHERE t.parentSessionId=? AND r.delivery!='delivered' LIMIT 1`).get(scope.sessionId)) return true;
    try {
      for (const entry of this.manager(scope)?.getEntries() ?? [])
        if (
          entry.type === "custom_message" && entry.customType === "axiom-result" &&
          (entry.details as any)?.axiomInput
        )
          this.acknowledge(scope, [(entry.details as any).axiomInput]);
      return true;
    } catch {
      return false; // Damaged transcripts must not trigger replacement or automatic replay.
    }
  }
  notify(scope: Scope) {
    if (
      this.closing ||
      this.records.frozen(scope) ||
      this.notifying.has(scope.sessionId)
    )
      return;
    this.notifying.add(scope.sessionId);
    this.track(
      (async () => {
        try {
          const list = this.store.db
            .prepare("SELECT task_results.* FROM task_results JOIN tasks ON tasks.id=task_results.taskId WHERE parentSessionId=? AND delivery='pending' ORDER BY task_results.rowid LIMIT 8")
            .all(scope.sessionId);
          if (!list.length || this.closing || this.records.frozen(scope)) return;
          const run = this.agents.info(scope).run;
          if (run && running(run) && run.status !== "running") return;
          const items = list.map((row) => {
            const result: TaskResult = JSON.parse(String(row.body));
            return { id: result.id, content: JSON.stringify({ taskId: result.taskId, runId: result.runId, resultId: result.id, status: result.status }) };
          });
          const attemptId = randomUUID();
          this.store.db.exec("BEGIN IMMEDIATE");
          try {
            this.store.db.prepare("INSERT INTO task_notification_attempts(id,sessionId,resultIds,state,error,createdAt,runId) VALUES(?,?,?,'inflight',NULL,?,?)")
              .run(attemptId, scope.sessionId, JSON.stringify(items.map((item) => item.id)), Date.now(), run && running(run) ? run.id : null);
            for (const item of items) this.store.db.prepare("UPDATE task_results SET delivery='inflight' WHERE id=?").run(item.id);
            this.store.db.exec("COMMIT");
          } catch (error) { this.store.db.exec("ROLLBACK"); throw error; }
          try {
            if (run && running(run)) {
              if (!this.agents.signal(scope, run.id, { type: "input", id: items[0].id, text: items[0].content,
                notification: true, notifications: items, mode: "steer" }))
                throw new AppError("NOTIFICATION_NOT_SENT", "父执行已结束，通知未发送");
            } else {
              const receipt = await this.agents.command({ requestId: `notify-${attemptId}`, op: "prompt", ...scope,
              params: { text: "处理子任务完成通知" } }, {
              notification: { ...items[0], items },
              onStart: (owner) => { this.store.db.prepare("UPDATE task_notification_attempts SET runId=? WHERE id=?").run(owner.id, attemptId); },
              beforeStart: () => {
                if (this.closing || this.records.frozen(scope)) throw new AppError("PARENT_FROZEN", "父会话已停止，不自动启动结果处理");
              },
            });
              if (receipt && typeof receipt === "object" && "runId" in receipt && typeof receipt.runId === "string")
                this.store.db.prepare("UPDATE task_notification_attempts SET runId=? WHERE id=?").run(receipt.runId, attemptId);
            }
          } catch (error) {
            const known = error instanceof AppError && ["INVALID_CONFIG", "MODEL_UNAVAILABLE", "PARENT_FROZEN", "AGENT_STOPPED", "SHUTTING_DOWN", "NOTIFICATION_NOT_SENT", "AGENT_BUSY", "REVISION_CONFLICT", "PROMPT_PREPARATION_FAILED", "WORKER_START_FAILED"].includes(error.code);
            const state = known ? "failed" : "unknown";
            this.reconcileNotifications(scope);
            this.store.db.prepare("UPDATE task_notification_attempts SET state=?,error=? WHERE id=? AND state!='delivered'")
              .run(state, known ? (error as AppError).message : "投递结果未知；须先核对会话记录。", attemptId);
            for (const item of items) this.store.db.prepare("UPDATE task_results SET delivery=? WHERE id=? AND delivery!='delivered'").run(state, item.id);
          }
        } finally {
          this.notifying.delete(scope.sessionId);
          if (this.settledWhileNotifying.delete(scope.sessionId) && !this.closing) {
            this.reconcilePending(scope, false);
            this.notify(scope);
          }
        }
      })(),
    ).catch(() => {});
  }
}
