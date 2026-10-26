import type { DatabaseSync } from "node:sqlite";

export interface ServiceRecovery {
  sessionId: string;
  runId: string | null;
  kind: "resume" | "queue" | "notify";
  state: "pending" | "blocked";
  payload: string;
  error: string | null;
  createdAt: number;
}

/** Durable intentions, not replayable commands. Only the service interruption creates these. */
export class ServiceRecoveryRecords {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS service_recoveries(
      sessionId TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      runId TEXT,kind TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',
      payload TEXT NOT NULL DEFAULT '[]',error TEXT,createdAt INTEGER NOT NULL)`);
  }
  get(sessionId: string) {
    return this.db.prepare("SELECT * FROM service_recoveries WHERE sessionId=?").get(sessionId) as unknown as ServiceRecovery | undefined;
  }
  pending() {
    return this.db.prepare("SELECT * FROM service_recoveries WHERE state='pending' ORDER BY createdAt,rowid").all() as unknown as ServiceRecovery[];
  }
  remove(sessionId: string, expected?: ServiceRecovery) {
    if (expected) this.db.prepare("DELETE FROM service_recoveries WHERE sessionId=? AND runId IS ? AND kind=? AND createdAt=? AND payload=?")
      .run(sessionId, expected.runId, expected.kind, expected.createdAt, expected.payload);
    else this.db.prepare("DELETE FROM service_recoveries WHERE sessionId=?").run(sessionId);
  }
  block(sessionId: string, error: string) {
    this.db.prepare("UPDATE service_recoveries SET state='blocked',error=? WHERE sessionId=?").run(error, sessionId);
    this.db.prepare(`UPDATE runs SET error=? WHERE id=(SELECT runId FROM service_recoveries WHERE sessionId=?)
      AND status IN ('interrupted','cancelled')`).run(`自动恢复受阻：${error}`, sessionId);
    this.db.prepare("UPDATE tasks SET error=? WHERE sessionId=? AND status='interrupted'").run(`自动恢复受阻：${error}`, sessionId);
  }
  /** Caller owns the transaction, including marking old runs interrupted on startup. */
  capture() {
    const now = Date.now();
    // Exclude stopping: a crash must never undo a user's already accepted stop.
    this.db.prepare(`INSERT OR REPLACE INTO service_recoveries(sessionId,runId,kind,createdAt)
      SELECT r.sessionId,r.id,'resume',? FROM runs r WHERE r.status IN ('starting','running')
      AND r.id=(SELECT id FROM runs latest WHERE latest.sessionId=r.sessionId ORDER BY startedAt DESC,rowid DESC LIMIT 1)
      AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.sessionId=r.sessionId AND t.status='stopping')`).run(now);
    // Only inputs that have never been handed to a worker can be replayed.
    const hasSkills = !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_input_skills'").get();
    for (const task of this.db.prepare(`SELECT t.sessionId,t.id,
      (SELECT id FROM runs WHERE sessionId=t.sessionId ORDER BY startedAt DESC,rowid DESC LIMIT 1) AS runId
      FROM tasks t WHERE t.status IN ('queued','starting','running','wrapping','summarizing')`).all()) {
      const inputs = this.db.prepare("SELECT * FROM task_inputs WHERE taskId=? AND state='queued' AND runId IS NULL ORDER BY createdAt,rowid").all(task.id);
      if (!inputs.length) continue;
      const payload = inputs.map(input => ({ ...input,
        images: this.db.prepare("SELECT body FROM task_input_images WHERE inputId=?").get(input.id)?.body ?? null,
        skills: hasSkills ? this.db.prepare("SELECT body FROM task_input_skills WHERE inputId=?").get(input.id)?.body ?? null : null,
      }));
      const current = this.get(String(task.sessionId));
      if (current?.kind === "resume" && current.runId === task.runId) {
        this.db.prepare("UPDATE service_recoveries SET payload=? WHERE sessionId=?").run(JSON.stringify(payload), task.sessionId);
      } else {
        this.db.prepare(`INSERT OR REPLACE INTO service_recoveries(sessionId,runId,kind,payload,createdAt)
          VALUES(?,?,'queue',?,?)`).run(task.sessionId, task.runId, JSON.stringify(payload), now);
      }
    }
    // An idle parent awaiting delegated work also needs its result delivery re-enabled.
    this.db.prepare(`INSERT OR IGNORE INTO service_recoveries(sessionId,runId,kind,createdAt)
      SELECT p.sessionId,(SELECT id FROM runs WHERE sessionId=p.sessionId ORDER BY startedAt DESC,rowid DESC LIMIT 1),'notify',?
      FROM task_parents p WHERE p.frozen=0 AND (
        EXISTS(SELECT 1 FROM tasks t WHERE t.parentSessionId=p.sessionId
          AND t.status IN ('queued','starting','running','wrapping','summarizing'))
        OR EXISTS(SELECT 1 FROM task_results r JOIN tasks t ON t.id=r.taskId WHERE t.parentSessionId=p.sessionId
          AND r.delivery IN ('pending','inflight','unknown')))`).run(now);
  }
}
