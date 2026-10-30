import { createHash } from "node:crypto";
import type { Scope } from "../shared/protocol.js";
import type { TaskWindowField } from "../shared/task-window.js";
import { cleanTaskResult, taskLabels, type TaskResult } from "../shared/tasks.js";
import { WindowFrameBudgetError } from "../shared/window-frame-budget.js";
import type { Store } from "./storage.js";
import type { TaskWindowSourceTask } from "./task-window-source.js";

export interface TaskWindowReport {
  readonly fingerprint: string;
  readonly fields: Readonly<Record<TaskWindowField, string>>;
}
const unavailable = (): never => { throw new WindowFrameBudgetError("UNAVAILABLE"); };
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

/** Lazy read of ONE selected immutable delivery, never the scope's report bodies.
 * Membership comes from the task cut; current SQL rechecks parent/task/run links.
 * This later read is not claimed to be the metadata capture's SQL transaction.
 * Parsing/hashing a selected report remains O(report size), not a CPU/RSS bound. */
export function readTaskWindowReport(store: Pick<Store, "db" | "session" | "workspace">, scope: Scope,
  task: TaskWindowSourceTask, result: TaskWindowSourceTask["results"][number]): TaskWindowReport {
  store.session(scope.workspaceId, scope.sessionId);
  if (!store.workspace(scope.workspaceId).authorized || task.workspaceId !== scope.workspaceId || task.parentSessionId !== scope.sessionId ||
    !task.results.some(item => item.id === result.id && item.runId === result.runId && item.status === result.status)) return unavailable();
  const row = store.db.prepare(`SELECT r.body FROM task_results r JOIN tasks t ON t.id=r.taskId
    JOIN runs execution ON execution.id=r.runId AND execution.sessionId=t.sessionId
    WHERE t.id=? AND t.workspaceId=? AND t.parentSessionId=? AND t.sessionId=? AND r.id=? AND r.runId=?`)
    .get(task.id, scope.workspaceId, scope.sessionId, task.sessionId, result.id, result.runId);
  if (!row || typeof row.body !== "string") return unavailable();
  const value: unknown = JSON.parse(row.body);
  if (!value || typeof value !== "object" || Array.isArray(value)) return unavailable();
  const body = value as Record<string, unknown>;
  if (body.id !== result.id || body.taskId !== task.id || body.runId !== result.runId || body.status !== result.status ||
    typeof body.status !== "string" || !Object.hasOwn(taskLabels, body.status) || typeof body.report !== "string" ||
    typeof body.sideEffects !== "string" || body.reason !== null && typeof body.reason !== "string" ||
    !Array.isArray(body.unfinished) || !body.unfinished.every(item => typeof item === "string")) return unavailable();
  const report = cleanTaskResult(body as unknown as TaskResult);
  // The old UI displayed unfinished.join('；'). Keep that display projection as
  // an independently chunked plain-text field instead of embedding a giant array
  // in metadata or requiring complete JSON reassembly before displaying notes.
  const notes = [report.sideEffects, report.unfinished.length ? `未完成／未验证\n${report.unfinished.join("；")}` : ""].filter(Boolean).join("\n\n");
  const fields = Object.freeze({
    text: report.report,
    input: notes,
    error: report.reason ?? "",
    metadata: JSON.stringify({ status: report.status, reportKind: ["final", "partial", "system"].includes(report.reportKind ?? "") ? report.reportKind : null,
      startedAt: finite(report.startedAt), endedAt: finite(report.endedAt), hasNotes: notes.length > 0, hasReason: !!report.reason }),
  });
  store.session(scope.workspaceId, scope.sessionId);
  if (!store.workspace(scope.workspaceId).authorized) return unavailable();
  return Object.freeze({ fingerprint: createHash("sha256").update(row.body).digest("hex"), fields });
}
