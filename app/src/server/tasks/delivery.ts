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
  parentSettled(scope: Scope, run: Run) {
    if (run.status === "completed")
      this.reconcilePending(scope);
    else this.reconcileNotifications(scope);
    this.notify(scope);
  }
  reconcilePending(scope: Scope) {
    if (this.reconcileNotifications(scope))
      this.store.db
        .prepare(
          "UPDATE task_results SET delivery='pending' WHERE delivery='inflight' AND taskId IN (SELECT id FROM tasks WHERE parentSessionId=?)",
        )
        .run(scope.sessionId);
  }
  acknowledge(scope: Scope, ids: string[]) {
    for (const id of ids)
      this.store.db
        .prepare(
          "UPDATE task_results SET delivery='delivered' WHERE id=? AND taskId IN (SELECT id FROM tasks WHERE parentSessionId=?)",
        )
        .run(id, scope.sessionId);
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
  save(row: Row, run: Run) {
    if (row.runId !== run.id) return;
    let report = "未取得可靠的最终回复。",
      known: string[] = [];
    try {
      const entries = this.manager(target(row))?.getEntries() ?? [];
      const messages = entries.flatMap((e) =>
        e.type === "message" && (e.message as any).axiomRunId === run.id
          ? [e.message as any]
          : [],
      );
      const last = messages
        .filter((m) => m.role === "assistant" && m.stopReason === "stop")
        .at(-1);
      if (last)
        report =
          last.content
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text)
            .join("\n")
            .slice(0, 16000) || report;
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
      this.store.db.prepare("DELETE FROM task_inputs WHERE taskId=?").run(row.id);
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
      const result: TaskResult = {
        id: randomUUID(),
        taskId: row.id,
        runId: run.id,
        status,
        report,
        reason: row.error || run.error,
        startedAt: run.startedAt,
        endedAt: run.endedAt ?? Date.now(),
        unfinished:
          status === "completed"
            ? ["模型报告不等于全部验收通过；请核对交付中的未验证项。"]
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
  result(scope: Scope, taskId: unknown, resultId: unknown): TaskResult {
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
    return JSON.parse(String(result.body));
  }
  reconcileNotifications(scope: Scope) {
    try {
      for (const entry of this.manager(scope)?.getEntries() ?? [])
        if (
          entry.type === "custom_message" &&
          (entry.details as any)?.axiomInput
        )
          this.store.db
            .prepare(
              "UPDATE task_results SET delivery='delivered' WHERE id=? AND taskId IN (SELECT id FROM tasks WHERE parentSessionId=?)",
            )
            .run((entry.details as any).axiomInput, scope.sessionId);
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
            .prepare(
              "SELECT task_results.* FROM task_results JOIN tasks ON tasks.id=task_results.taskId WHERE parentSessionId=? AND delivery='pending' ORDER BY task_results.rowid",
            )
            .all(scope.sessionId);
          for (const row of list) {
            if (this.closing || this.records.frozen(scope)) break;
            const result: TaskResult = JSON.parse(String(row.body));
            const content = JSON.stringify({
              taskId: result.taskId,
              runId: result.runId,
              resultId: result.id,
              status: result.status,
            });
            const run = this.agents.info(scope).run;
            if (run && running(run)) {
              if (
                run.status !== "running" ||
                !this.agents.signal(scope, run.id, {
                  type: "input",
                  id: result.id,
                  text: content,
                  notification: true,
                  mode: "followUp",
                })
              )
                break;
              this.store.db
                .prepare(
                  "UPDATE task_results SET delivery='inflight' WHERE id=?",
                )
                .run(result.id);
            } else {
              this.store.db
                .prepare(
                  "UPDATE task_results SET delivery='inflight' WHERE id=?",
                )
                .run(result.id);
              try {
                await this.agents.command(
                  {
                    requestId: `notify-${result.id}`,
                    op: "prompt",
                    ...scope,
                    params: { text: "处理子任务完成通知" },
                  },
                  {
                    notification: { id: result.id, content },
                    beforeStart: () => {
                      if (this.closing || this.records.frozen(scope))
                        throw new AppError(
                          "PARENT_FROZEN",
                          "父会话已停止，不自动启动结果处理",
                        );
                    },
                  },
                );
              } catch {
                /* Persisted in-flight claim prevents duplicate wake after uncertainty. */
              }
              break;
            }
          }
        } finally {
          this.notifying.delete(scope.sessionId);
        }
      })(),
    ).catch(() => {});
  }
}
