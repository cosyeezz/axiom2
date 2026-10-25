import { ServiceRecoveryRecords } from "./service-recovery-records.js";
import { safeExecutionRejection } from "./execution-diagnostics.js";
import { ExecutionPermitDeniedError } from "./execution-protocol.js";
import { initializeMemory } from "./memory-files.js";
import { initializeMemoryStorage } from "./memory-storage.js";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { realpathSync, statSync, mkdirSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { Run } from "../shared/agent.js";
import { validSessionTitle } from "./session-title.js";
import { isActiveSession, isAutoTopSession, sessionPinCooldownMs } from "../shared/session-attention.js";
import { defaultAutoCompression, type CompressionPreferences } from "../shared/compression.js";
import {
  AppError,
  object,
  text,
  type Command,
  type DeletedSession,
  type DeletedSessionPage,
  type Session,
  type Scope,
  type Workspace,
  type WorkspacePreferences,
} from "../shared/protocol.js";

export type SessionRestorePosition = Pick<Session, "updatedAt" | "pinned" | "unread" | "autoPinUntil">;

export class Store {
  readonly db: DatabaseSync;
  readonly recoveries: ServiceRecoveryRecords;
  private statements = new Map<string, StatementSync>();
  prepare(sql: string) {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      if (this.statements.size >= 128) this.statements.delete(this.statements.keys().next().value!);
      this.statements.set(sql, statement);
    }
    return statement;
  }
  private readonly lease: DatabaseSync;
  /** In-flight runtime operations also veto archival. */
  beforeArchiveWorkspace?: (workspaceId: string) => void;
  constructor(readonly root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    // Trust the configured root once; all managed descendants use its real path.
    // macOS /var aliases and Windows short TEMP paths must share one identity.
    root = this.root = realpathSync(root);
    // A separate SQLite exclusive lock is released by the OS on a crash; no stale PID guessing.
    this.lease = new DatabaseSync(join(root, "service-lock.sqlite"));
    try {
      this.lease.exec("PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE");
    } catch {
      this.lease.close();
      throw new AppError(
        "SERVICE_ALREADY_RUNNING",
        "此数据目录已有服务运行，不能启动第二个执行管理器。",
      );
    }
    this.db = new DatabaseSync(join(root, "axiom.sqlite"));
    this.db
      .exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,path TEXT NOT NULL,pathKey TEXT NOT NULL UNIQUE,name TEXT NOT NULL,authorized INTEGER NOT NULL CHECK(authorized IN (0,1)));
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,workspaceId TEXT NOT NULL REFERENCES workspaces(id),title TEXT NOT NULL,pinned INTEGER NOT NULL DEFAULT 0,unread INTEGER NOT NULL DEFAULT 0,updatedAt INTEGER NOT NULL,UNIQUE(workspaceId,id));
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,hash TEXT NOT NULL,response TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS external_requests(id TEXT PRIMARY KEY,hash TEXT NOT NULL,state TEXT NOT NULL,response TEXT);
      UPDATE external_requests SET state='uncertain' WHERE state='pending';
      CREATE TABLE IF NOT EXISTS agent_sessions(sessionId TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,selection TEXT,file TEXT,environment TEXT,usage TEXT);
      CREATE TABLE IF NOT EXISTS session_capabilities(sessionId TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,selection TEXT,catalog TEXT,revision INTEGER NOT NULL DEFAULT 0,lockedAt INTEGER,legacy INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS agent_preferences(id INTEGER PRIMARY KEY CHECK(id=1),selection TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS compression_preferences(id INTEGER PRIMARY KEY CHECK(id=1),selection TEXT);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,status TEXT NOT NULL,selection TEXT NOT NULL,startedAt INTEGER NOT NULL,endedAt INTEGER,error TEXT);
      CREATE TABLE IF NOT EXISTS run_binding_rejections(runId TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
        body TEXT NOT NULL,createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS task_parents(sessionId TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,frozen INTEGER NOT NULL DEFAULT 0,defaultModel TEXT);
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,workspaceId TEXT NOT NULL,parentSessionId TEXT NOT NULL,sessionId TEXT NOT NULL UNIQUE,anchor TEXT NOT NULL,description TEXT NOT NULL,status TEXT NOT NULL,runId TEXT REFERENCES runs(id),budgets TEXT NOT NULL,createdAt INTEGER NOT NULL,error TEXT,FOREIGN KEY(workspaceId,parentSessionId) REFERENCES sessions(workspaceId,id) ON DELETE CASCADE,FOREIGN KEY(workspaceId,sessionId) REFERENCES sessions(workspaceId,id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS task_inputs(id TEXT PRIMARY KEY,taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,body TEXT NOT NULL,mode TEXT NOT NULL,state TEXT NOT NULL,runId TEXT REFERENCES runs(id),createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS task_input_images(inputId TEXT PRIMARY KEY REFERENCES task_inputs(id) ON DELETE CASCADE,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS task_results(id TEXT PRIMARY KEY,taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,runId TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,body TEXT NOT NULL,delivery TEXT NOT NULL DEFAULT 'pending');
      CREATE INDEX IF NOT EXISTS runs_session_started ON runs(sessionId,startedAt);
      CREATE INDEX IF NOT EXISTS tasks_parent_status ON tasks(parentSessionId,status);
      CREATE INDEX IF NOT EXISTS task_results_task ON task_results(taskId);
    `);
    if (!this.db.prepare("PRAGMA table_info(sessions)").all().some((c) => c.name === "forkParentSessionId"))
      this.db.exec("ALTER TABLE sessions ADD COLUMN forkParentSessionId TEXT");
    if (!this.db.prepare("PRAGMA table_info(sessions)").all().some((c) => c.name === "deletedAt"))
      this.db.exec("ALTER TABLE sessions ADD COLUMN deletedAt INTEGER");
    this.db.exec(`CREATE TABLE IF NOT EXISTS session_restore_positions(
      sessionId TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      updatedAt INTEGER NOT NULL,pinned INTEGER NOT NULL,unread INTEGER NOT NULL DEFAULT 0,autoPinUntil INTEGER)`);
    const restoreColumns = this.db.prepare("PRAGMA table_info(session_restore_positions)").all();
    if (!restoreColumns.some((column) => column.name === "unread"))
      this.db.exec("ALTER TABLE session_restore_positions ADD COLUMN unread INTEGER NOT NULL DEFAULT 0");
    if (!restoreColumns.some((column) => column.name === "autoPinUntil"))
      this.db.exec("ALTER TABLE session_restore_positions ADD COLUMN autoPinUntil INTEGER");
    if (!this.db.prepare("PRAGMA table_info(compression_preferences)").all().some((c) => c.name === "auto"))
      this.db.exec("ALTER TABLE compression_preferences ADD COLUMN auto TEXT");
    this.recoveries = new ServiceRecoveryRecords(this.db);
    // Read versions migrate once; the boolean remains a derived compatibility column.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (!this.db.prepare("PRAGMA table_info(sessions)").all().some((c) => c.name === "resultVersion"))
        this.db.exec(`ALTER TABLE sessions ADD COLUMN resultVersion INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE sessions ADD COLUMN readVersion INTEGER NOT NULL DEFAULT 0;
          UPDATE sessions SET resultVersion=CASE WHEN unread=1 THEN 1 ELSE 0 END;`);
      for (const column of ["phase", "retry", "reasonCode", "resumedFromRunId", "origin"])
        if (!this.db.prepare("PRAGMA table_info(runs)").all().some((c) => c.name === column))
          this.db.exec(`ALTER TABLE runs ADD COLUMN ${column} TEXT`);
      this.db.exec(`CREATE TABLE IF NOT EXISTS session_results(
        sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        sourceId TEXT NOT NULL,kind TEXT NOT NULL,version INTEGER NOT NULL,
        PRIMARY KEY(sessionId,sourceId),UNIQUE(sessionId,version));`);
      // Preserve coordinator-proven initial denials before startup erases live inputs.
      // These need explicit user retry, never the automatic service-resume path.
      this.recoverInitialRetries();
      this.recoveries.capture();
      this.db.exec(`UPDATE tasks SET status='interrupted',error=CASE
          WHEN sessionId IN (SELECT sessionId FROM service_recoveries WHERE state='pending') THEN '服务中断；等待自动恢复。'
          ELSE '服务中断；未自动续跑。' END
        WHERE status IN ('queued','starting','running','wrapping','stopping','summarizing');
        UPDATE task_parents SET frozen=1;
        DELETE FROM task_inputs;`);
      for (const row of this.db.prepare("SELECT id,sessionId,retry FROM runs WHERE status IN ('starting','running','stopping')").all()) {
        const retry = row.retry ? { ...JSON.parse(String(row.retry)), state: "cancelled", nextRetryAt: undefined } : null;
        this.finishRun(String(row.id), "interrupted", "服务中断；可恢复的任务将在服务就绪后自动续跑。", "SERVICE_INTERRUPTED", retry);
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    // Legacy non-default names have no provenance: preserve them as manual.
    if (!this.db.prepare("PRAGMA table_info(sessions)").all().some((c) => c.name === "titleState")) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(`ALTER TABLE sessions ADD COLUMN titleState TEXT NOT NULL DEFAULT 'pending' CHECK(titleState IN ('pending','generated','manual'));
          UPDATE sessions SET titleState='manual' WHERE title<>'新对话';`);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    if (!this.db.prepare("PRAGMA table_info(sessions)").all().some((c) => c.name === "autoPinUntil"))
      this.db.exec("ALTER TABLE sessions ADD COLUMN autoPinUntil INTEGER");
    for (const column of ["pinned", "archived"])
      if (!this.db.prepare("PRAGMA table_info(workspaces)").all().some((c) => c.name === column))
        this.db.exec(`ALTER TABLE workspaces ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0 CHECK(${column} IN (0,1))`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS workspace_preferences(id INTEGER PRIMARY KEY CHECK(id=1),lastWorkspaceId TEXT REFERENCES workspaces(id));
      INSERT OR IGNORE INTO workspace_preferences(id,lastWorkspaceId)
      VALUES(1,(SELECT id FROM workspaces WHERE archived=0 ORDER BY pinned DESC,rowid LIMIT 1));`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS session_preferences(id INTEGER PRIMARY KEY CHECK(id=1),workspaceId TEXT NOT NULL,sessionId TEXT NOT NULL,
      FOREIGN KEY(workspaceId,sessionId) REFERENCES sessions(workspaceId,id) ON DELETE CASCADE)`);
    // Retire the old cleanup gate without touching conversation files or execution history.
    if (this.db.prepare("PRAGMA table_info(runs)").all().some((column) => column.name === "cleanup"))
      this.db.exec("ALTER TABLE runs DROP COLUMN cleanup");
    // Null on older receipts means unknown ownership, never an application-wide read grant.
    for (const table of ["requests", "external_requests"])
      if (
        !this.db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .some((column) => column.name === "scope")
      )
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN scope TEXT`);
    // Upgrade existing installations without making users re-confirm their model.
    // Prefer confirmation receipt order; session updatedAt also changes on messages/renames.
    this.db.exec(`
      INSERT INTO agent_preferences(id,selection)
      SELECT 1,a.selection FROM agent_sessions a
      JOIN sessions s ON s.id=a.sessionId
      WHERE a.selection IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM agent_preferences WHERE id=1)
        AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.sessionId=a.sessionId)
      ORDER BY (
        SELECT MAX(r.rowid) FROM external_requests r
        WHERE r.state='committed' AND json_valid(r.scope) AND json_valid(r.response)
          AND json_extract(r.scope,'$[0]')=s.workspaceId
          AND json_extract(r.scope,'$[1]')=s.id
          AND json_extract(r.response,'$.selection')=a.selection
      ) DESC,a.rowid DESC
      LIMIT 1;
    `);
    try {
      const sessions = this.db.prepare("SELECT id FROM sessions WHERE NOT EXISTS(SELECT 1 FROM tasks WHERE tasks.sessionId=sessions.id)").all();
      initializeMemoryStorage(this.root, sessions.map((row) => String(row.id)));
    } catch (error) {
      // Migration never removes originals or blocks conversation recovery.
      console.warn("会话记忆目录初始化未完成，保留既有位置：", error instanceof Error ? error.message : String(error));
    }
  }
  workspaces(): Workspace[] {
    return (
      this.db
        .prepare(
          "SELECT id,name,path,authorized,pinned FROM workspaces WHERE archived=0 ORDER BY pinned DESC,rowid",
        )
        .all() as unknown as Workspace[]
    ).map((w) => ({ ...w, authorized: !!w.authorized, pinned: !!w.pinned }));
  }
  workspacePreferences(): WorkspacePreferences {
    const row = this.db.prepare("SELECT w.id FROM workspace_preferences p JOIN workspaces w ON w.id=p.lastWorkspaceId WHERE p.id=1 AND w.archived=0").get();
    return { lastWorkspaceId: row ? String(row.id) : null };
  }
  lastSession(): Scope | null {
    const row = this.db.prepare("SELECT p.workspaceId,p.sessionId FROM session_preferences p JOIN workspaces w ON w.id=p.workspaceId JOIN sessions s ON s.id=p.sessionId WHERE p.id=1 AND w.archived=0 AND s.deletedAt IS NULL").get();
    return row ? { workspaceId: String(row.workspaceId), sessionId: String(row.sessionId) } : null;
  }
  compressionPreferences(): CompressionPreferences {
    const row = this.db.prepare("SELECT selection,auto FROM compression_preferences WHERE id=1").get();
    return { selection: row?.selection ? JSON.parse(String(row.selection)) : null,
      auto: row?.auto ? JSON.parse(String(row.auto)) : { ...defaultAutoCompression } };
  }
  saveCompressionPreferences(value: CompressionPreferences): CompressionPreferences {
    this.db.prepare("INSERT INTO compression_preferences(id,selection,auto) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET selection=excluded.selection,auto=excluded.auto")
      .run(value.selection === null ? null : JSON.stringify(value.selection), JSON.stringify(value.auto));
    return this.compressionPreferences();
  }
  workspace(id: unknown): Workspace {
    const w = this.prepare("SELECT id,name,path,authorized,pinned FROM workspaces WHERE id=? AND archived=0")
      .get(text(id, "工作空间标识")) as unknown as Workspace | undefined;
    if (!w) throw new AppError("NOT_FOUND", "工作空间不存在");
    return { ...w, authorized: !!w.authorized, pinned: !!w.pinned };
  }
  sessions(workspaceId: unknown): Session[] {
    return this.sessionSummaries(this.workspace(workspaceId).id);
  }
  pinnedSessions(): Session[] {
    return this.sessionSummaries();
  }
  deletedSessions(params: Record<string, unknown> = {}): DeletedSessionPage {
    const query = params.query ?? "";
    if (typeof query !== "string" || query.length > 200 || query.includes("\0"))
      throw new AppError("INVALID_INPUT", "搜索内容无效（最多 200 字符）");
    const cursor = params.cursor == null ? null : object(params.cursor);
    if (cursor && (typeof cursor.deletedAt !== "number" || !Number.isSafeInteger(cursor.deletedAt) || cursor.deletedAt < 0 || typeof cursor.id !== "string" || !cursor.id || cursor.id.length > 200))
      throw new AppError("INVALID_INPUT", "已删除会话加载位置无效");
    const needle = query.trim();
    const rows = this.prepare(`SELECT s.id,s.workspaceId,s.title,s.deletedAt,w.name AS workspaceName,w.path AS workspacePath
      FROM sessions s JOIN workspaces w ON w.id=s.workspaceId
      WHERE s.deletedAt IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.sessionId=s.id)
        AND (?='' OR instr(lower(s.title),lower(?))>0 OR instr(lower(w.name),lower(?))>0 OR instr(lower(w.path),lower(?))>0)
        ${cursor ? "AND (s.deletedAt<? OR (s.deletedAt=? AND s.id>?))" : ""}
      ORDER BY s.deletedAt DESC,s.id LIMIT 31`)
      .all(needle, needle, needle, needle, ...(cursor ? [cursor.deletedAt as number, cursor.deletedAt as number, cursor.id as string] : [])) as unknown as DeletedSession[];
    const items = rows.slice(0, 30), last = items.at(-1);
    return { items, next: rows.length > 30 && last ? { deletedAt: last.deletedAt, id: last.id } : null };
  }
  private sessionSummaries(workspaceId?: string, sessionId?: string): Session[] {
    return (
      this
        .prepare(
          "SELECT sessions.*,r.id AS runId,r.status AS runStatus,r.phase,r.retry,r.reasonCode,(SELECT COUNT(*) FROM tasks WHERE parentSessionId=sessions.id AND status IN ('queued','starting','running','stopping')) AS activeTaskCount FROM sessions LEFT JOIN runs r ON r.id=(SELECT id FROM runs WHERE sessionId=sessions.id ORDER BY startedAt DESC,rowid DESC LIMIT 1) WHERE " + (workspaceId === undefined ? "(pinned=1 OR unread=1 OR autoPinUntil>0 OR r.status IN ('starting','running','stopping') OR activeTaskCount>0)" : "workspaceId=?") + (sessionId === undefined ? "" : " AND sessions.id=?") + " AND sessions.deletedAt IS NULL AND EXISTS(SELECT 1 FROM workspaces w WHERE w.id=sessions.workspaceId AND w.archived=0) AND NOT EXISTS(SELECT 1 FROM tasks WHERE tasks.sessionId=sessions.id) ORDER BY pinned DESC,updatedAt DESC,sessions.id",
        )
        .all(...(workspaceId === undefined ? [] : [workspaceId]), ...(sessionId === undefined ? [] : [sessionId])) as unknown as Session[]
    ).map((s) => ({ ...s, pinned: !!s.pinned, unread: !!s.unread,
      activeTasks: !!s.activeTaskCount, retry: s.retry ? JSON.parse(String(s.retry)) : null }));
  }
  /** Active sessions have no deadline; viewing an idle automatic pin renews cooling. */
  viewSession(scope: Scope, now = Date.now()): boolean {
    this.session(scope.workspaceId, scope.sessionId);
    const summary = this.sessionSummaries(scope.workspaceId, scope.sessionId)[0];
    const automatic = summary && isAutoTopSession(summary);
    return !!this.db.prepare("UPDATE sessions SET autoPinUntil=? WHERE id=? AND ?")
      .run(summary && isActiveSession(summary) ? null : now + sessionPinCooldownMs, scope.sessionId, Number(!!automatic)).changes;
  }
  /** Nested savepoints keep the result event and its reading watermark atomic. */
  recordResult(sessionId: string, sourceId: string, kind: "run" | "task") {
    this.db.exec("SAVEPOINT result_event");
    try {
      const inserted = this.db.prepare("INSERT OR IGNORE INTO session_results(sessionId,sourceId,kind,version) SELECT id,?,?,resultVersion+1 FROM sessions WHERE id=?")
        .run(sourceId, kind, sessionId).changes;
      if (inserted) this.db.prepare("UPDATE sessions SET resultVersion=resultVersion+1,unread=1,updatedAt=? WHERE id=?")
        .run(Date.now(), sessionId);
      this.db.exec("RELEASE result_event");
      return !!inserted;
    } catch (error) { this.db.exec("ROLLBACK TO result_event; RELEASE result_event"); throw error; }
  }
  private recoverInitialRetries() {
    const tables = ["task_initial_retries", "task_input_receipts", "task_input_skills"];
    if (tables.some(name => !this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)) ||
        !this.db.prepare("PRAGMA table_info(tasks)").all().some(column => column.name === "initialInputId")) return;
    const candidates = this.db.prepare(`SELECT t.id AS taskId,t.sessionId,r.id AS runId,i.id AS inputId,i.body
      FROM tasks t JOIN runs r ON r.id=t.runId JOIN run_binding_rejections b ON b.runId=r.id
      JOIN task_inputs i ON i.taskId=t.id AND i.id=t.initialInputId AND i.runId=r.id
      JOIN task_input_receipts receipt ON receipt.inputId=i.id AND receipt.taskId=t.id
      WHERE t.status='starting' AND (r.status='starting' OR r.status='failed' AND r.reasonCode='BINDING_REJECTED')
      AND r.id=(SELECT id FROM runs latest WHERE latest.sessionId=t.sessionId ORDER BY startedAt DESC,rowid DESC LIMIT 1)
      AND i.mode='steer' AND i.state='starting' AND (receipt.runId IS NULL OR receipt.runId=r.id)
      AND receipt.state IN ('queued','failed','unknown')
      AND NOT EXISTS(SELECT 1 FROM task_inputs other WHERE other.taskId=t.id AND other.id<>i.id)
      AND NOT EXISTS(SELECT 1 FROM task_input_images WHERE inputId=i.id)
      AND NOT EXISTS(SELECT 1 FROM task_input_skills WHERE inputId=i.id)
      AND NOT EXISTS(SELECT 1 FROM task_input_receipts WHERE taskId=t.id AND state IN ('accepted','delivered','cancelled'))`).all();
    for (const candidate of candidates) {
      const runId = String(candidate.runId), taskId = String(candidate.taskId);
      const error = new ExecutionPermitDeniedError(this.bindingRejection(runId)).message;
      this.db.prepare("INSERT OR REPLACE INTO task_initial_retries(taskId,runId,inputId,body) VALUES(?,?,?,?)")
        .run(taskId, runId, candidate.inputId, candidate.body);
      this.db.prepare("UPDATE task_input_receipts SET state='failed',runId=?,error=?,updatedAt=? WHERE inputId=? AND taskId=?")
        .run(runId, "绑定校验未通过，初始委派未发送；点击继续可重新发送原任务。", Date.now(), candidate.inputId, taskId);
      this.db.prepare("UPDATE tasks SET status='failed',error=? WHERE id=?").run(error, taskId);
      this.db.prepare("DELETE FROM service_recoveries WHERE sessionId=?").run(candidate.sessionId);
      this.finishRun(runId, "failed", error, "BINDING_REJECTED");
    }
  }
  /** Only called by the execution coordinator, never from a worker event or raw metric. */
  rejectBinding(runId: string, rejection: unknown) {
    this.db.prepare(`INSERT OR IGNORE INTO run_binding_rejections(runId,body,createdAt)
      SELECT id,?,? FROM runs WHERE id=? AND status='starting'`)
      .run(JSON.stringify(safeExecutionRejection(rejection)), Date.now(), runId);
  }
  bindingRejection(runId: string) {
    const row = this.db.prepare("SELECT body FROM run_binding_rejections WHERE runId=?").get(runId);
    return row ? safeExecutionRejection(JSON.parse(String(row.body))) : undefined;
  }
  finishRun(id: string, status: Run["status"], error: string | null, reasonCode: string | null = null, retry?: Run["retry"]) {
    this.db.exec("SAVEPOINT finish_run");
    try {
      const row = this.db.prepare("UPDATE runs SET status=?,endedAt=?,error=?,reasonCode=?,phase=NULL,retry=COALESCE(?,retry) WHERE id=? AND status IN ('starting','running','stopping') RETURNING sessionId")
        .get(status, Date.now(), error, reasonCode, retry ? JSON.stringify(retry) : null, id);
      if (row) this.recordResult(String(row.sessionId), id, "run");
      this.db.exec("RELEASE finish_run");
      return !!row;
    } catch (failure) { this.db.exec("ROLLBACK TO finish_run; RELEASE finish_run"); throw failure; }
  }
  readSession(scope: Scope, throughVersion: unknown) {
    this.session(scope.workspaceId, scope.sessionId);
    if (typeof throughVersion !== "number" || !Number.isSafeInteger(throughVersion) || throughVersion < 0)
      throw new AppError("INVALID_INPUT", "已读确认必须包含已展示的结果版本 throughVersion");
    this.viewSession(scope);
    this.db.prepare("UPDATE sessions SET readVersion=MAX(readVersion,MIN(?,resultVersion)),unread=(resultVersion>MAX(readVersion,MIN(?,resultVersion))) WHERE id=?")
      .run(throughVersion, throughVersion, scope.sessionId);
  }
  /** No ownership lookup here: a viewer may leave after its session was deleted/archived. */
  leaveSession(scope: Scope, now = Date.now()): boolean {
    const summary = this.sessionSummaries(scope.workspaceId, scope.sessionId)[0];
    if (summary && isActiveSession(summary))
      return !!this.db.prepare("UPDATE sessions SET autoPinUntil=NULL WHERE id=? AND autoPinUntil IS NOT NULL")
        .run(scope.sessionId).changes;
    return !!this.db.prepare("UPDATE sessions SET autoPinUntil=? WHERE workspaceId=? AND id=? AND autoPinUntil>0")
      .run(now + sessionPinCooldownMs, scope.workspaceId, scope.sessionId).changes;
  }
  session(workspaceId: unknown, sessionId: unknown): Session {
    const w = this.workspace(workspaceId);
    const s = this.db
      .prepare("SELECT * FROM sessions WHERE workspaceId=? AND id=? AND deletedAt IS NULL")
      .get(w.id, text(sessionId, "会话标识")) as unknown as Session | undefined;
    if (!s) throw new AppError("SCOPE_MISMATCH", "会话不属于该工作空间");
    return { ...s, pinned: !!s.pinned, unread: !!s.unread };
  }
  /** Pending includes fallback names: a missing/invalid reply is retried on later requests. */
  requestTitle(scope: Scope, fallback?: string): boolean {
    this.session(scope.workspaceId, scope.sessionId);
    const pending = !!this.db.prepare("SELECT 1 FROM sessions WHERE id=? AND titleState='pending' AND NOT EXISTS(SELECT 1 FROM tasks WHERE sessionId=sessions.id)").get(scope.sessionId);
    if (pending && fallback !== undefined) {
      const title = [...fallback.replace(/\[(?:image|img|imag)\d+\]/gi, "").replace(/\s+/g, " ").trim()].slice(0, 60).join("") || "[图片]";
      this.db.prepare("UPDATE sessions SET title=? WHERE id=? AND titleState='pending' AND NOT EXISTS(SELECT 1 FROM runs WHERE sessionId=sessions.id)").run(title, scope.sessionId);
    }
    return pending;
  }
  generatedTitle(scope: Scope, value: unknown): boolean {
    this.session(scope.workspaceId, scope.sessionId);
    const title = validSessionTitle(value);
    if (!title) return false;
    // Compare-and-set makes manual rename win even over an already in-flight response.
    return !!this.db.prepare("UPDATE sessions SET title=?,titleState='generated' WHERE id=? AND titleState='pending' AND NOT EXISTS(SELECT 1 FROM tasks WHERE sessionId=sessions.id)").run(title, scope.sessionId).changes;
  }
  private requestScope(scope: Partial<Scope>) {
    return JSON.stringify([scope.workspaceId ?? null, scope.sessionId ?? null]);
  }
  receipt(
    requestId: unknown,
    scope?: Partial<Scope>,
  ): { status: string; data?: unknown } {
    const id = text(requestId, "请求标识");
    const row = this.db
      .prepare(
        "SELECT 'committed' AS state,response,scope FROM requests WHERE id=? UNION ALL SELECT state,response,scope FROM external_requests WHERE id=?",
      )
      .get(id, id);
    if (!row) return { status: "not_found" };
    // Internal duplicate checks still validate the original full command hash on execute/external.
    if (scope) {
      if (row.scope === null) return { status: "uncertain" };
      if (row.scope !== this.requestScope(scope))
        throw new AppError(
          "REQUEST_SCOPE_MISMATCH",
          "回执不属于此工作空间／会话",
        );
    }
    return {
      status: String(row.state),
      ...(row.response ? { data: JSON.parse(String(row.response)) } : {}),
    };
  }
  async external(
    command: Command,
    run: () => Promise<unknown>,
  ): Promise<unknown> {
    const id = text(command.requestId, "请求标识");
    const hash = createHash("sha256")
      .update(JSON.stringify(command))
      .digest("hex");
    if (this.db.prepare("SELECT 1 FROM requests WHERE id=?").get(id))
      throw new AppError("REQUEST_CONFLICT", "请求标识已用于其他操作");
    const previous = this.db
      .prepare("SELECT hash,state,response FROM external_requests WHERE id=?")
      .get(id);
    if (previous) {
      if (previous.hash !== hash)
        throw new AppError("REQUEST_CONFLICT", "同一请求标识不能使用不同参数");
      if (previous.state === "committed")
        return JSON.parse(previous.response as string);
      if (previous.state === "failed") {
        const error = JSON.parse(previous.response as string);
        throw new AppError(error.code, error.message);
      }
      throw new AppError(
        "UNCERTAIN",
        "操作处理中或结果待核实；请读取当前状态，不自动重做。",
      );
    }
    this.db
      .prepare(
        "INSERT INTO external_requests(id,hash,state,response,scope) VALUES(?,?,'pending',NULL,?)",
      )
      .run(id, hash, this.requestScope(command));
    try {
      const result = await run();
      this.db
        .prepare(
          "UPDATE external_requests SET state='committed',response=? WHERE id=?",
        )
        .run(JSON.stringify(result), id);
      return result;
    } catch (error) {
      const safe =
        error instanceof AppError
          ? error
          : new AppError(
              "UNCERTAIN",
              "操作状态待核实，请读取对应会话或配置状态。",
            );
      try {
        this.db
          .prepare("UPDATE external_requests SET state=?,response=? WHERE id=?")
          .run(
            safe.code === "UNCERTAIN" ? "uncertain" : "failed",
            JSON.stringify({ code: safe.code, message: safe.message }),
            id,
          );
      } catch {
        throw new AppError(
          "UNCERTAIN",
          "操作回执未保存；请重新读取会话或配置状态，勿重复提交。",
        );
      }
      throw safe;
    }
  }
  // Synchronous SQLite transaction: mutation and receipt commit together before acknowledgement.
  execute(command: Command, deletionPosition?: SessionRestorePosition, mutation?: () => unknown): unknown {
    const id = text(command.requestId, "请求标识");
    if (this.db.prepare("SELECT 1 FROM external_requests WHERE id=?").get(id))
      throw new AppError("REQUEST_CONFLICT", "请求标识已用于其他操作");
    const hash = createHash("sha256")
      .update(JSON.stringify(command))
      .digest("hex");
    const previous = this.db
      .prepare("SELECT hash,response FROM requests WHERE id=?")
      .get(id);
    if (previous) {
      if (previous.hash !== hash)
        throw new AppError("REQUEST_CONFLICT", "同一请求标识不能使用不同参数");
      return JSON.parse(previous.response as string);
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = mutation ? mutation() : this.mutate(command, deletionPosition);
      this.db
        .prepare("INSERT INTO requests(id,hash,response,scope) VALUES(?,?,?,?)")
        .run(id, hash, JSON.stringify(result), this.requestScope(command));
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private mutate(c: Command, deletionPosition?: SessionRestorePosition): unknown {
    const p = object(c.params ?? {});
    if (c.op === "workspace.open") {
      if (p.authorized !== true)
        throw new AppError("AUTHORIZATION_REQUIRED", "请明确授权项目访问");
      const input = text(p.path, "项目绝对路径", 4096);
      if (!isAbsolute(input))
        throw new AppError("INVALID_PATH", "请输入服务端项目的绝对路径");
      let path: string;
      try {
        path = realpathSync.native(input);
        if (!statSync(path).isDirectory()) throw Error();
      } catch {
        throw new AppError("INVALID_PATH", "目录不存在或无法访问");
      }
      // Only Windows folds case; macOS volumes may be case-sensitive.
      const key = process.platform === "win32" ? path.toLowerCase() : path;
      this.db
        .prepare("INSERT INTO workspaces(id,path,pathKey,name,authorized) VALUES(?,?,?,?,1) ON CONFLICT(pathKey) DO UPDATE SET archived=0,authorized=1")
        .run(randomUUID(), path, key, basename(path) || path);
      return this.workspaces().find(
        (w) =>
          (process.platform === "win32" ? w.path.toLowerCase() : w.path) ===
          key,
      )!;
    }
    if (["workspace.rename", "workspace.pin", "workspace.delete", "workspace.select"].includes(c.op)) {
      const w = this.workspace(c.workspaceId);
      if (c.sessionId !== undefined) this.session(w.id, c.sessionId);
      if (c.op === "workspace.rename") {
        const name = text(p.name, "工作空间名称", 120);
        if (/[\x00-\x1f\x7f]/.test(name)) throw new AppError("INVALID_INPUT", "工作空间名称不能包含控制字符");
        this.db.prepare("UPDATE workspaces SET name=? WHERE id=?").run(name, w.id);
      } else if (c.op === "workspace.pin") {
        if (typeof p.pinned !== "boolean") throw new AppError("INVALID_INPUT", "置顶状态必须为布尔值");
        this.db.prepare("UPDATE workspaces SET pinned=? WHERE id=?").run(Number(p.pinned), w.id);
      } else if (c.op === "workspace.select") {
        if (p.view !== undefined) {
          if (p.view === null) this.db.prepare("DELETE FROM session_preferences WHERE id=1").run();
          else {
            const view = object(p.view), session = this.session(view.workspaceId, view.sessionId);
            if (this.db.prepare("SELECT 1 FROM tasks WHERE sessionId=?").get(session.id))
              throw new AppError("INVALID_INPUT", "默认查看位置只能是主会话");
            this.db.prepare("INSERT INTO session_preferences(id,workspaceId,sessionId) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET workspaceId=excluded.workspaceId,sessionId=excluded.sessionId").run(session.workspaceId, session.id);
          }
        }
        this.db.prepare("INSERT INTO workspace_preferences(id,lastWorkspaceId) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET lastWorkspaceId=excluded.lastWorkspaceId").run(w.id);
        return this.workspacePreferences();
      } else {
        if (p.confirmed !== true) throw new AppError("CONFIRMATION_REQUIRED", "从列表移除工作空间需要确认；不会删除项目文件或会话历史");
        this.assertWorkspaceIdle(w.id);
        this.beforeArchiveWorkspace?.(w.id);
        // Preserve pending results/history, but do not let them auto-wake an invisible parent.
        this.db.prepare("INSERT INTO task_parents(sessionId,frozen) SELECT id,1 FROM sessions WHERE workspaceId=? ON CONFLICT(sessionId) DO UPDATE SET frozen=1").run(w.id);
        this.db.prepare("DELETE FROM task_inputs WHERE taskId IN (SELECT id FROM tasks WHERE workspaceId=?)").run(w.id);
        this.db.prepare("UPDATE workspaces SET archived=1 WHERE id=?").run(w.id);
        this.db.prepare("UPDATE workspace_preferences SET lastWorkspaceId=NULL WHERE lastWorkspaceId=?").run(w.id);
        return { deleted: w.id };
      }
      return this.workspace(w.id);
    }
    if (c.op === "session.create") {
      const w = this.workspace(c.workspaceId);
      if (p.reuseEmpty !== undefined && typeof p.reuseEmpty !== "boolean")
        throw new AppError("INVALID_INPUT", "复用新会话状态必须为布尔值");
      if (p.reuseEmpty === true) {
        // Lookup and insertion share execute's synchronous transaction, including across viewers.
        // Drafts, attachments and model selection stay bound to the reused session.
        const existing = this.db.prepare(`SELECT s.id FROM sessions s
          WHERE s.workspaceId=? AND s.deletedAt IS NULL AND s.titleState='pending' AND s.title='新对话'
            AND NOT EXISTS(SELECT 1 FROM runs r WHERE r.sessionId=s.id)
            AND NOT EXISTS(SELECT 1 FROM agent_sessions a WHERE a.sessionId=s.id AND a.file IS NOT NULL)
            AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.sessionId=s.id OR t.parentSessionId=s.id)
          ORDER BY s.updatedAt DESC,s.rowid DESC LIMIT 1`).get(w.id);
        if (existing) return this.session(w.id, String(existing.id));
      }
      const id = randomUUID();
      this.db
        .prepare(
          "INSERT INTO sessions(id,workspaceId,title,updatedAt) VALUES(?,?,?,?)",
        )
        .run(id, w.id, "新对话", Date.now());
      try { initializeMemory(this.root, id); }
      catch { /* Optional memory must not prevent creating a usable conversation. */ }
      // Copy once at creation; later default changes must not affect existing sessions.
      this.db
        .prepare(
          "INSERT INTO agent_sessions(sessionId,selection) SELECT ?,selection FROM agent_preferences WHERE id=1",
        )
        .run(id);
      return this.session(w.id, id);
    }
    if (c.op === "session.restore") {
      const workspaceId = text(c.workspaceId, "工作空间标识"), sessionId = text(c.sessionId, "会话标识");
      const deleted = this.db.prepare(`SELECT s.id FROM sessions s WHERE s.workspaceId=? AND s.id=?
        AND s.deletedAt IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.sessionId=s.id)`).get(workspaceId, sessionId);
      if (!deleted) throw new AppError("SCOPE_MISMATCH", "已删除会话不存在或不属于该工作空间");
      // Reuse the original workspace and ordering keys; never rewrite conversation files.
      this.db.prepare("UPDATE workspaces SET archived=0 WHERE id=?").run(workspaceId);
      this.db.prepare(`UPDATE sessions SET deletedAt=NULL,
        updatedAt=COALESCE((SELECT updatedAt FROM session_restore_positions p WHERE p.sessionId=sessions.id),updatedAt),
        pinned=COALESCE((SELECT pinned FROM session_restore_positions p WHERE p.sessionId=sessions.id),pinned),
        unread=COALESCE((SELECT unread FROM session_restore_positions p WHERE p.sessionId=sessions.id),unread) AND resultVersion>readVersion,
        autoPinUntil=CASE WHEN (SELECT autoPinUntil FROM session_restore_positions p WHERE p.sessionId=sessions.id)>?
          THEN (SELECT autoPinUntil FROM session_restore_positions p WHERE p.sessionId=sessions.id) ELSE 0 END
        WHERE id=? OR id IN (SELECT sessionId FROM tasks WHERE parentSessionId=?)`).run(Date.now(), sessionId, sessionId);
      this.db.prepare("DELETE FROM session_restore_positions WHERE sessionId=? OR sessionId IN (SELECT sessionId FROM tasks WHERE parentSessionId=?)").run(sessionId, sessionId);
      return this.session(workspaceId, sessionId);
    }
    const s = this.session(c.workspaceId, c.sessionId);
    if (c.op === "session.rename")
      this.db
        .prepare("UPDATE sessions SET title=?,titleState='manual',updatedAt=? WHERE id=?")
        .run(text(p.title, "标题", 120), Date.now(), s.id);
    else if (c.op === "session.pin") {
      if (typeof p.pinned !== "boolean")
        throw new AppError("INVALID_INPUT", "置顶状态必须为布尔值");
      this.db
        .prepare("UPDATE sessions SET pinned=? WHERE id=?")
        .run(Number(p.pinned), s.id);
    } else if (c.op === "session.read") {
      this.readSession({ workspaceId: s.workspaceId, sessionId: s.id }, p.throughVersion);
    } else if (c.op === "session.delete") {
      if (p.confirmed !== true)
        throw new AppError("CONFIRMATION_REQUIRED", "删除会话需要确认");
      const position = deletionPosition ?? s;
      this.db.prepare("INSERT OR REPLACE INTO session_restore_positions(sessionId,updatedAt,pinned,unread,autoPinUntil) VALUES(?,?,?,?,?)")
        .run(s.id, position.updatedAt, Number(position.pinned), Number(position.unread), position.autoPinUntil ?? null);
      this.db.prepare("UPDATE sessions SET deletedAt=?,pinned=0,unread=0,autoPinUntil=0 WHERE id=? OR id IN (SELECT sessionId FROM tasks WHERE parentSessionId=?)").run(Date.now(), s.id, s.id);
      this.db.prepare("DELETE FROM session_preferences WHERE sessionId=?").run(s.id);
      return { deleted: s.id };
    } else throw new AppError("UNKNOWN_OPERATION", "不支持的操作");
    return this.session(s.workspaceId, s.id);
  }
  private assertWorkspaceIdle(id: string) {
    const busy = () => { throw new AppError("WORKSPACE_BUSY", "工作空间仍有活动执行或后台压缩；请先停止再移除。"); };
    if (this.db.prepare("SELECT 1 FROM runs r JOIN sessions s ON s.id=r.sessionId WHERE s.workspaceId=? AND r.status IN ('starting','running','stopping') LIMIT 1").get(id) ||
        this.db.prepare("SELECT 1 FROM tasks WHERE workspaceId=? AND status IN ('queued','starting','running','wrapping','stopping','summarizing') LIMIT 1").get(id) ||
        this.db.prepare("SELECT 1 FROM task_inputs i JOIN tasks t ON t.id=i.taskId WHERE t.workspaceId=? AND i.state IN ('starting','inflight') LIMIT 1").get(id)) busy();
    // These tables belong to optional services and do not exist in a standalone Store.
    const hasTable = (name: string) => this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
    if (hasTable("compressions") && this.db.prepare("SELECT 1 FROM compressions c JOIN sessions s ON s.id=c.sessionId WHERE s.workspaceId=? AND (NOT json_valid(c.body) OR json_extract(c.body,'$.state')='running') LIMIT 1").get(id)) busy();

    // Async startup/append may have passed ownership checks but not yet recorded a run.
    if (this.db.prepare("SELECT 1 FROM external_requests WHERE state='pending' AND json_valid(scope) AND json_extract(scope,'$[0]')=? LIMIT 1").get(id)) busy();
  }
  close() {
    this.statements.clear();
    this.db.close();
    this.lease.close();
  }
}
