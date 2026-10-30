import { lstatSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { ModelUsageStatistics, UsageRecord, UsageRecordFilter, UsageRecordPage } from "../shared/model-usage.js";
import type { UsageLedgerPublication } from "./model-usage-ledger.js";

export type UsageView = { key: string; scope: string; kind: "ledger" | "statistics"; params: UsageRecordFilter };
export type UsageViewValue = UsageRecordPage | ModelUsageStatistics;
export type UsageSubject = [sessionId: string, workspaceId: string, rootSessionId: string];
export type PublicationMeta = Omit<UsageLedgerPublication, "db" | "queries" | "providers"> & { visibility: string; subjects?: UsageSubject[]; publishedAt: number };
/** Derived data only. The source database is never attached to this writer. */
export class UsageMaterializedStore {
  readonly db: DatabaseSync;
  private scope = "";
  private generation = "";
  constructor(path: string) {
    // Refuse aliases before opening a writer: a damaged cache path must never target source files.
    for (const directory of [dirname(dirname(path)), dirname(path)]) {
      try { mkdirSync(directory, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      const info = lstatSync(directory); if (!info.isDirectory() || info.isSymbolicLink()) throw Error("unsafe usage cache directory");
    }
    for (const file of [path, `${path}-wal`, `${path}-shm`]) {
      try { const info = lstatSync(file); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw Error("unsafe usage cache file"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    this.db = new DatabaseSync(path);
    try {
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=0; PRAGMA synchronous=NORMAL;
      PRAGMA max_page_count=49152; PRAGMA journal_size_limit=8388608; PRAGMA wal_autocheckpoint=256; PRAGMA cache_size=-4096; PRAGMA mmap_size=0;
      CREATE TABLE IF NOT EXISTS generations(scope TEXT NOT NULL,id TEXT NOT NULL,meta TEXT NOT NULL,PRIMARY KEY(scope,id));
      CREATE TABLE IF NOT EXISTS heads(scope TEXT PRIMARY KEY,id TEXT NOT NULL,touched INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS usage_records(scope TEXT NOT NULL,generation TEXT NOT NULL,id TEXT NOT NULL,provider TEXT,timestamp REAL,search TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(scope,generation,id));
      CREATE INDEX IF NOT EXISTS usage_order ON usage_records(scope,generation,timestamp IS NULL,timestamp DESC,id);
      CREATE TABLE IF NOT EXISTS views(key TEXT PRIMARY KEY,scope TEXT NOT NULL,kind TEXT NOT NULL,params TEXT NOT NULL,generation TEXT,visibility TEXT,body TEXT,touched INTEGER NOT NULL);`);
    this.db.function("usage_scope", { deterministic: true }, () => this.scope);
    this.db.function("usage_generation", { deterministic: true }, () => this.generation);
    this.db.exec("CREATE TEMP VIEW records AS SELECT id,provider,timestamp,search,data FROM usage_records WHERE scope=usage_scope() AND generation=usage_generation()");
    } catch (error) { this.db.close(); throw error; }
  }
  head(scope: string): PublicationMeta | undefined {
    const row = this.db.prepare("SELECT g.meta FROM heads h JOIN generations g ON g.scope=h.scope AND g.id=h.id WHERE h.scope=?").get(scope);
    return row ? JSON.parse(String(row.meta)) : undefined;
  }
  register(view: UsageView) {
    this.db.prepare("INSERT INTO views(key,scope,kind,params,touched) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET touched=excluded.touched")
      .run(view.key, view.scope, view.kind, JSON.stringify(view.params), Date.now());
    this.db.prepare("UPDATE heads SET touched=? WHERE scope=?").run(Date.now(), view.scope);
    this.db.prepare("DELETE FROM views WHERE key IN (SELECT key FROM views ORDER BY touched DESC,key LIMIT -1 OFFSET 32)").run();
  }
  views(scope: string): UsageView[] {
    return this.db.prepare("SELECT key,scope,kind,params FROM views WHERE scope=? ORDER BY touched DESC,key LIMIT 32").all(scope)
      .map(row => ({ key: String(row.key), scope: String(row.scope), kind: row.kind as UsageView["kind"], params: JSON.parse(String(row.params)) }));
  }
  prepared(key: string, generation: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM views WHERE key=? AND generation=? AND body IS NOT NULL").get(key, generation);
  }
  cached(key: string): { value: UsageViewValue; visibility: string; generation: string } | undefined {
    const row = this.db.prepare("SELECT body,visibility,generation FROM views WHERE key=? AND body IS NOT NULL").get(key);
    return row ? { value: JSON.parse(String(row.body)), visibility: String(row.visibility), generation: String(row.generation) } : undefined;
  }
  save(view: UsageView, meta: PublicationMeta, value: UsageViewValue) {
    const encoded = JSON.stringify(value);
    if (Buffer.byteLength(encoded) > 1024 * 1024) throw Error("usage view exceeds budget");
    this.db.prepare("UPDATE views SET body=?,generation=?,visibility=? WHERE key=?").run(encoded, meta.id, meta.visibility, view.key);
    // Persisted views retain only bounded accounting rows and aggregates, never histories.
    while (Number(this.db.prepare("SELECT coalesce(sum(length(CAST(body AS BLOB))),0) AS bytes FROM views").get()!.bytes) > 16 * 1024 * 1024)
      this.db.prepare("DELETE FROM views WHERE key=(SELECT key FROM views WHERE body IS NOT NULL ORDER BY touched,key LIMIT 1)").run();
  }
  begin(scope: string) { return { scope, id: randomUUID(), bytes: 0 }; }
  append(stage: { scope: string; id: string; bytes: number }, rows: UsageRecord[]): boolean {
    const insert = this.db.prepare("INSERT OR IGNORE INTO usage_records VALUES(?,?,?,?,?,?,?)");
    let complete = true;
    this.db.exec("BEGIN");
    try {
      for (const row of rows) {
        const data = JSON.stringify(row); stage.bytes += Buffer.byteLength(data);
        if (stage.bytes > 32 * 1024 * 1024) { complete = false; break; }
        const search = [row.workspaceName, row.sessionTitle, row.source, row.model, row.provider, row.name].join(" ").toLowerCase();
        insert.run(stage.scope, stage.id, row.id, row.provider, row.timestamp ?? null, search, data);
      }
      this.db.exec("COMMIT"); return complete;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  publish(stage: { scope: string; id: string }, meta: PublicationMeta) {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("INSERT INTO generations VALUES(?,?,?)").run(stage.scope, stage.id, JSON.stringify({ ...meta, id: stage.id }));
      this.db.prepare("INSERT INTO heads VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET id=excluded.id,touched=excluded.touched").run(stage.scope, stage.id, Date.now());
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  publication(scope: string, meta: PublicationMeta): UsageLedgerPublication {
    this.scope = scope; this.generation = meta.id;
    return { ...meta, db: this.db };
  }
  *rows(): Generator<UsageRecord> {
    for (const row of this.db.prepare("SELECT data FROM records").iterate()) yield JSON.parse(String(row.data));
  }
  cleanup() {
    this.db.prepare("DELETE FROM heads WHERE scope IN (SELECT scope FROM heads ORDER BY touched DESC,scope LIMIT -1 OFFSET 2)").run();
    // Small deletes avoid a large cache writer transaction. Old view bodies remain internally coherent.
    const result = this.db.prepare("DELETE FROM usage_records WHERE rowid IN (SELECT r.rowid FROM usage_records r WHERE NOT EXISTS(SELECT 1 FROM heads h WHERE h.scope=r.scope AND h.id=r.generation) LIMIT 500)").run();
    this.db.exec("DELETE FROM generations WHERE NOT EXISTS(SELECT 1 FROM heads h WHERE h.scope=generations.scope AND h.id=generations.id)");
    return Number(result.changes) > 0;
  }
  discard(stage: { scope: string; id: string }) {
    // Staging has no head and is already invisible. Reclaim it in bounded cleanup slices.
    this.db.prepare("DELETE FROM usage_records WHERE rowid IN (SELECT rowid FROM usage_records WHERE scope=? AND generation=? LIMIT 500)").run(stage.scope, stage.id);
  }
  close() { this.db.close(); }
}
