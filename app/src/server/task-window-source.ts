import type { Run } from "../shared/agent.js";
import type { Scope } from "../shared/protocol.js";
import { defaultBudgets, type Task, type TaskInputReceipt } from "../shared/tasks.js";
import { WindowFrameBudgetError } from "../shared/window-frame-budget.js";
import type { Store } from "./storage.js";
import type { TaskRow } from "./tasks/records.js";

export type TaskWindowSourceTask = Readonly<Omit<Task, "results" | "inputs" | "budgets">> & {
  readonly budgets: Readonly<Task["budgets"]>;
  readonly results: readonly Readonly<Task["results"][number]>[];
  readonly inputs: readonly Readonly<TaskInputReceipt>[];
};
export interface TaskWindowSource {
  readonly tasks: readonly TaskWindowSourceTask[];
  readonly frozen: boolean;
  readonly resultVersion: number;
  readonly readVersion: number;
  readonly run: Readonly<Pick<Run, "id" | "status">> | null;
  /** Complete outstanding, non-discarded task result membership at THIS SQL cut.
   * This is neither transcript coverage nor permission to acknowledge reading. */
  readonly resultRefs: readonly Readonly<{ taskId: string; resultId: string; runId: string; version: number }>[];
}
const unavailable = (): never => { throw new WindowFrameBudgetError("UNAVAILABLE"); };
const watermark = (value: unknown): number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : unavailable();

/** Read-only host authority, separate from the worker's transcript cut. A SQLite
 * savepoint pins ALL relations and watermarks, including with an outside writer
 * or an enclosing transaction. No TaskRecords construction, alias repair, JSONL,
 * model/session initialization or full report bodies. Still O(N) task metadata
 * and instructions, NOT a CPU/RSS bound. Only a bounded query layer may send it. */
export function captureTaskWindow(store: Pick<Store, "db" | "session" | "workspace">, scope: Scope): TaskWindowSource {
  const { workspaceId, sessionId } = scope, db = store.db;
  db.exec("SAVEPOINT task_window_capture");
  try {
    const owner = store.session(workspaceId, sessionId);
    if (!store.workspace(workspaceId).authorized) return unavailable();
    const resultVersion = watermark(owner.resultVersion), readVersion = watermark(owner.readVersion);
    if (readVersion > resultVersion) return unavailable();
    const parent = db.prepare("SELECT frozen FROM task_parents WHERE sessionId=?").get(sessionId);
    const run = db.prepare("SELECT id,status FROM runs WHERE sessionId=? ORDER BY startedAt DESC,rowid DESC LIMIT 1").get(sessionId) as Pick<Run, "id" | "status"> | undefined;
    const rows = db.prepare(`SELECT t.id,t.workspaceId,t.parentSessionId,t.sessionId,t.anchor,t.title,t.context,t.initialInputId,
      t.description,t.status,t.runId,t.createdAt,t.budgets,t.error,t.workStartedAt,t.workDeadlineAt,t.summaryDeadlineAt,t.budgetRevision
      FROM tasks t WHERE t.workspaceId=? AND t.parentSessionId=? ORDER BY t.createdAt,t.rowid`).all(workspaceId, sessionId) as unknown as TaskRow[];
    const aliases = new Map(db.prepare(`SELECT ref.taskId,ref.seq FROM task_model_refs ref JOIN tasks t ON t.id=ref.taskId
      WHERE t.workspaceId=? AND t.parentSessionId=?`).all(workspaceId, sessionId).map(row => [String(row.taskId), `t${row.seq}`]));
    const inputs = new Map<string, Readonly<TaskInputReceipt>[]>(), results = new Map<string, Readonly<Task["results"][number]>[]>();
    for (const row of db.prepare(`SELECT i.taskId,i.inputId,i.runId,i.state,i.error FROM task_input_receipts i JOIN tasks t ON t.id=i.taskId
      WHERE t.workspaceId=? AND t.parentSessionId=? ORDER BY i.updatedAt,i.rowid`).all(workspaceId, sessionId)) {
      const { taskId, ...receipt } = row, id = String(taskId), group = inputs.get(id) ?? [];
      group.push(Object.freeze(receipt as unknown as TaskInputReceipt)); inputs.set(id, group);
    }
    for (const row of db.prepare(`SELECT r.taskId,r.id,r.runId,json_extract(r.body,'$.status') AS status FROM task_results r JOIN tasks t ON t.id=r.taskId
      WHERE t.workspaceId=? AND t.parentSessionId=? ORDER BY r.rowid`).all(workspaceId, sessionId)) {
      const id = String(row.taskId), group = results.get(id) ?? [];
      group.push(Object.freeze({ id: String(row.id), runId: String(row.runId), status: row.status as Task["status"] })); results.set(id, group);
    }
    const elapsed = new Map(db.prepare(`SELECT tr.taskId,COALESCE(SUM(MAX(0,r.endedAt-r.startedAt)),0) AS ms
      FROM tasks t JOIN task_results tr ON tr.taskId=t.id JOIN runs r ON r.id=tr.runId
      WHERE t.workspaceId=? AND t.parentSessionId=? GROUP BY tr.taskId`).all(workspaceId, sessionId).map(row => [String(row.taskId), Number(row.ms)]));
    const resultRefs: TaskWindowSource["resultRefs"][number][] = [];
    for (const row of db.prepare(`SELECT e.version,r.id,r.taskId,r.runId,r.delivery,t.id AS ownedTaskId FROM session_results e
      LEFT JOIN task_results r ON r.id=e.sourceId LEFT JOIN tasks t ON t.id=r.taskId AND t.workspaceId=? AND t.parentSessionId=?
      WHERE e.sessionId=? AND e.kind='task' AND e.version>? ORDER BY e.version`).all(workspaceId, sessionId, sessionId, readVersion)) {
      // A dangling/foreign event is unavailable evidence, never an empty proof.
      const version = watermark(row.version);
      if (!row.ownedTaskId || version > resultVersion) return unavailable();
      if (row.delivery === "discarded") continue;
      resultRefs.push(Object.freeze({ taskId: String(row.taskId), resultId: String(row.id), runId: String(row.runId), version }));
    }
    const tasks = rows.map((row): TaskWindowSourceTask => {
      const saved = JSON.parse(row.budgets) as Task["budgets"];
      return Object.freeze({ ...row, ref: aliases.get(row.id),
        budgets: Object.freeze({ concurrency: saved.concurrency ?? defaultBudgets.concurrency, workMs: saved.workMs ?? defaultBudgets.workMs }),
        results: Object.freeze(results.get(row.id) ?? []), inputs: Object.freeze(inputs.get(row.id) ?? []), elapsedMs: elapsed.get(row.id) ?? 0 });
    });
    const result = Object.freeze({ tasks: Object.freeze(tasks), frozen: !!parent?.frozen, resultVersion, readVersion,
      run: run ? Object.freeze({ id: run.id, status: run.status }) : null, resultRefs: Object.freeze(resultRefs) });
    db.exec("RELEASE task_window_capture");
    return result;
  } catch (error) {
    db.exec("ROLLBACK TO task_window_capture; RELEASE task_window_capture");
    throw error;
  }
}
