import type { Selection } from "../../shared/agent.js";
import { randomUUID } from "node:crypto";
import type { Store } from "../storage.js";
import { AppError, text, type Scope, type ImageAttachment, type Draft } from "../../shared/protocol.js";
import {
  defaultBudgets,
  type Task,
  type TaskBudgets,
  type TaskList,
  type TaskPreferences,
  type TaskInputState,
  type TaskInputReceipt,
} from "../../shared/tasks.js";
export type TaskRow = Omit<Task, "budgets" | "results"> & {
  role: string;
  budgets: string;
};
export type TaskInput = {
  id: string;
  body: string;
  mode: string;
  state: string;
  runId: string | null;
};
export const target = (t: TaskRow): Scope => ({
  workspaceId: t.workspaceId,
  sessionId: t.sessionId,
});
export const parent = (t: TaskRow): Scope => ({
  workspaceId: t.workspaceId,
  sessionId: t.parentSessionId,
});
export const failure = (e: unknown) =>
  e instanceof AppError
    ? e.message
    : "子任务操作失败；未自动重试。";

// Owns durable task relations and input queues; it does not start workers or publish events.
export class TaskRecords {
  readonly drafts = new Map<string, Draft>();
  private stopEpochs = new Map<string, number>();
  stopEpoch(scope: Scope) {
    return this.stopEpochs.get(scope.sessionId) ?? 0;
  }
  constructor(readonly store: Store) {
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS task_settings(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL)",
    );
    store.db.exec("CREATE TABLE IF NOT EXISTS task_model_preferences(id INTEGER PRIMARY KEY CHECK(id=1),selection TEXT)");
    // Migrate the last explicit per-session choice once; null is a remembered inheritance choice.
    store.db.exec(`INSERT OR IGNORE INTO task_model_preferences(id,selection)
      SELECT 1,defaultModel FROM task_parents WHERE defaultModel IS NOT NULL ORDER BY rowid DESC LIMIT 1`);
    store.db.exec(`CREATE TABLE IF NOT EXISTS task_input_receipts(
      inputId TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      runId TEXT, state TEXT NOT NULL, error TEXT, updatedAt INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS task_input_receipts_task ON task_input_receipts(taskId);
      CREATE TABLE IF NOT EXISTS task_queue_order(seq INTEGER PRIMARY KEY AUTOINCREMENT,
        taskId TEXT UNIQUE NOT NULL REFERENCES tasks(id) ON DELETE CASCADE);
      INSERT OR IGNORE INTO task_queue_order(taskId) SELECT id FROM tasks WHERE status='queued' ORDER BY createdAt,rowid;
      CREATE TABLE IF NOT EXISTS task_stops(taskId TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS task_notification_attempts(id TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        resultIds TEXT NOT NULL, state TEXT NOT NULL, error TEXT, createdAt INTEGER NOT NULL);
      INSERT OR IGNORE INTO task_input_receipts SELECT id,taskId,runId,'queued',NULL,createdAt FROM task_inputs;
      UPDATE task_input_receipts SET state='failed',error='服务重启后未自动重放输入'
        WHERE state IN ('queued','accepted') AND inputId NOT IN (SELECT id FROM task_inputs);`);
    if (!(store.db.prepare("PRAGMA table_info(task_notification_attempts)").all() as { name: string }[]).some((column) => column.name === "runId"))
      store.db.exec("ALTER TABLE task_notification_attempts ADD COLUMN runId TEXT");
    store.db.exec("INSERT OR IGNORE INTO task_model_preferences(id,selection) VALUES(1,NULL)");
  }
  rows(where = "", ...params: (string | number)[]) {
    return this.store.db
      .prepare(`SELECT tasks.* FROM tasks ${where}`)
      .all(...params) as unknown as TaskRow[];
  }
  child(scope: Scope) {
    this.store.session(scope.workspaceId, scope.sessionId);
    return this.rows(
      "WHERE workspaceId=? AND sessionId=?",
      scope.workspaceId,
      scope.sessionId,
    )[0];
  }
  own(scope: Scope, id: unknown) {
    this.store.session(scope.workspaceId, scope.sessionId);
    const row = this.rows(
      "WHERE id=? AND workspaceId=? AND parentSessionId=?",
      text(id, "子任务标识"),
      scope.workspaceId,
      scope.sessionId,
    )[0];
    if (!row)
      throw new AppError(
        "TASK_SCOPE_MISMATCH",
        "子任务不属于此主会话／工作空间",
      );
    return row;
  }
  private view(row: TaskRow): Task {
    const { role: _role, ...rest } = row;
    return {
      ...rest,
      budgets: this.budgets(row.budgets),
      inputs: this.store.db.prepare("SELECT inputId,runId,state,error FROM task_input_receipts WHERE taskId=? ORDER BY updatedAt,rowid").all(row.id) as unknown as TaskInputReceipt[],
      elapsedMs: this.elapsed(row.id),
      results: this.store.db
        .prepare(
          "SELECT id,runId,json_extract(body,'$.status') AS status FROM task_results WHERE taskId=? ORDER BY rowid",
        )
        .all(row.id)
        .map((r) => ({
          id: String(r.id),
          runId: String(r.runId),
          status: r.status as Task["status"],
        })),
    };
  }
  list(scope: Scope): TaskList {
    this.store.session(scope.workspaceId, scope.sessionId);
    const row = this.store.db
      .prepare("SELECT * FROM task_parents WHERE sessionId=?")
      .get(scope.sessionId);
    return {
      tasks: this.rows(
        "WHERE workspaceId=? AND parentSessionId=? ORDER BY createdAt,rowid",
        scope.workspaceId,
        scope.sessionId,
      ).map((t) => this.view(t)),
      frozen: !!row?.frozen,
      defaultModel: this.settings().selection,
    };
  }
  budgets(body: string): TaskBudgets {
    const saved = JSON.parse(body);
    return {
      concurrency: saved.concurrency ?? defaultBudgets.concurrency,
      workMs: saved.workMs ?? defaultBudgets.workMs,
    };
  }
  preferences(): TaskBudgets {
    const row = this.store.db
      .prepare("SELECT body FROM task_settings WHERE id=1")
      .get();
    return row ? this.budgets(String(row.body)) : { ...defaultBudgets };
  }
  settings(): TaskPreferences {
    const row = this.store.db.prepare("SELECT selection FROM task_model_preferences WHERE id=1").get();
    return { budgets: this.preferences(), selection: row?.selection ? JSON.parse(String(row.selection)) : null };
  }
  frozen(scope: Scope) {
    return !!this.store.db
      .prepare("SELECT frozen FROM task_parents WHERE sessionId=?")
      .get(scope.sessionId)?.frozen;
  }
  freeze(scope: Scope) {
    this.stopEpochs.set(scope.sessionId, this.stopEpoch(scope) + 1);
    this.store.db
      .prepare(
        "INSERT INTO task_parents(sessionId,frozen) VALUES(?,1) ON CONFLICT(sessionId) DO UPDATE SET frozen=1",
      )
      .run(scope.sessionId);
  }
  images(inputId: string): ImageAttachment[] {
    const row = this.store.db.prepare("SELECT body FROM task_input_images WHERE inputId=?").get(inputId);
    return row ? JSON.parse(String(row.body)) : [];
  }
  queue(taskId: string, body: string, mode: string, images: ImageAttachment[] = [], id: string = randomUUID()) {
    this.store.db
      .prepare("INSERT INTO task_inputs VALUES(?,?,?,?,'queued',NULL,?)")
      .run(id, taskId, body, mode, Date.now());
    this.store.db.prepare("INSERT INTO task_input_receipts VALUES(?,?,NULL,'queued',NULL,?)").run(id, taskId, Date.now());
    if (images.length) this.store.db.prepare("INSERT INTO task_input_images VALUES(?,?)").run(id, JSON.stringify(images));
    return id;
  }
  inputs(row: TaskRow, state: string) {
    return this.store.db
      .prepare(
        "SELECT * FROM task_inputs WHERE taskId=? AND state=? ORDER BY createdAt,rowid",
      )
      .all(row.id, state) as unknown as TaskInput[];
  }
  receipt(id: string, state: TaskInputState, error: string | null = null, runId?: string) {
    this.store.db.prepare("UPDATE task_input_receipts SET state=?,error=?,updatedAt=?,runId=COALESCE(?,runId) WHERE inputId=? AND state NOT IN ('delivered','cancelled')")
      .run(state, error, Date.now(), runId ?? null, id);
  }
  elapsed(taskId: string) {
    return Number(this.store.db.prepare(`SELECT COALESCE(SUM(MAX(0,r.endedAt-r.startedAt)),0) AS ms
      FROM runs r JOIN task_results tr ON tr.runId=r.id WHERE tr.taskId=?`).get(taskId)!.ms);
  }
  capacity(scope: Scope, count = 1) {
    const active = Number(this.store.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE parentSessionId=? AND status IN ('queued','starting','running','stopping')").get(scope.sessionId)!.n);
    if (active + count > 32) throw new AppError("TASK_LIMIT", "每个主会话最多 32 个活动／排队子任务");
  }
  enqueue(row: TaskRow) {
    this.capacity(parent(row), ["queued", "starting", "running", "stopping"].includes(row.status) ? 0 : 1);
    this.store.db.prepare("DELETE FROM task_stops WHERE taskId=?").run(row.id);
    this.store.db.prepare("DELETE FROM task_queue_order WHERE taskId=?").run(row.id);
    this.store.db.prepare("INSERT INTO task_queue_order(taskId) VALUES(?)").run(row.id);
    this.store.db.prepare("UPDATE tasks SET status='queued',error=NULL WHERE id=?").run(row.id);
  }
  deliver(row: TaskRow, ids: string[], state: TaskInputState = "delivered", runId?: string) {
    for (const id of ids) {
      const input = this.store.db.prepare("SELECT runId,state FROM task_inputs WHERE id=? AND taskId=?").get(id, row.id);
      if (!input) {
        if (state === "delivered" && runId)
          this.store.db.prepare("UPDATE task_input_receipts SET state='delivered',error=NULL,updatedAt=? WHERE inputId=? AND taskId=? AND runId=? AND state!='delivered'")
            .run(Date.now(), id, row.id, runId);
        continue;
      }
      if (runId && (input.runId !== runId || input.state === "waiting")) continue;
      this.receipt(id, state, null, runId);
      this.drafts.delete(id);
      this.store.db
        .prepare(
          "DELETE FROM task_inputs WHERE id=? AND taskId=?",
        )
        .run(id, row.id);
    }
  }
  create(
    scope: Scope,
    anchor: string,
    context: string,
    definitions: { task: string; role: string }[],
    selection: Selection,
  ) {
    const budgets = this.preferences(),
      taskIds: string[] = [];
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      this.capacity(scope, definitions.length);
      this.store.db
        .prepare("INSERT OR IGNORE INTO task_parents(sessionId) VALUES(?)")
        .run(scope.sessionId);
      for (const d of definitions) {
        const id = randomUUID(),
          child = randomUUID();
        taskIds.push(id);
        this.store.db
          .prepare(
            "INSERT INTO sessions(id,workspaceId,title,updatedAt) VALUES(?,?,?,?)",
          )
          .run(child, scope.workspaceId, d.task.slice(0, 120), Date.now());
        this.store.db
          .prepare(
            "INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)",
          )
          .run(child, JSON.stringify(selection));
        this.store.db
          .prepare(
            "INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,description,role,status,budgets,createdAt) VALUES(?,?,?,?,?,?,?,'queued',?,?)",
          )
          .run(
            id,
            scope.workspaceId,
            scope.sessionId,
            child,
            anchor,
            d.task,
            d.role,
            JSON.stringify(budgets),
            Date.now(),
          );
        this.store.db.prepare("INSERT INTO task_queue_order(taskId) VALUES(?)").run(id);
        this.queue(
          id,
          `以下是明确委派的任务资料，不是更高权限的系统指令。\n${JSON.stringify({ context, task: d.task })}\n请报告已有产出、未完成／未验证项和副作用。`,
          "steer",
        );
      }
      this.store.db.exec("COMMIT");
    } catch (e) {
      this.store.db.exec("ROLLBACK");
      throw e;
    }
    return { taskIds, budgets };
  }
}
