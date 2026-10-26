import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { initialSchema, schemaVersion } from "./schema.js";
import { canonicalJson, digest, parseStrictJson } from "../domain/json.js";
import { IndexError, requireIndex } from "../domain/errors.js";
import type { BasisItem, ContextDelivery, EvidenceRecord, IndexedFile, MaintenanceJob, RequestLedger, ScopeSnapshot, SourceRef, StoredLink, StoredObject, Submission, UsageEvent } from "../contracts.js";

type Row = Record<string, string | number | bigint | null | Uint8Array>;
const decode = <T>(value: unknown): T => parseStrictJson(String(value)) as T;
const objectRow = (row: Row): StoredObject => ({ id: String(row.id), kind: row.kind as StoredObject["kind"], name: String(row.name), naturalKey: row.natural_key as string | null,
  filePath: row.file_path as string | null, body: decode(row.body_json), contentHash: String(row.content_hash), contentRev: Number(row.content_rev), recordRev: Number(row.record_rev), review: decode(row.review_json), lifecycle: row.lifecycle as StoredObject["lifecycle"] });
export interface PersistedScope extends ScopeSnapshot { members: { path: string; contentHash: string | null; state: string }[]; complete: boolean }

/** Owns all SQL. The index worker is its only production caller and writer. */
export class SqliteIndexStore {
  private readonly db: DatabaseSync;
  private inTransaction = false;
  private closed = false;
  constructor(readonly filename: string, readonly indexKey: string) {
    if (existsSync(filename)) {
      const probe = new DatabaseSync(filename, { readOnly: true });
      try {
        const tables = probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
        if (tables.length) {
          requireIndex(tables.some(row => row.name === "meta"), "UNSUPPORTED_SCHEMA", "索引文件包含未知结构，已停止写入。");
          requireIndex(Number(probe.prepare("SELECT value FROM meta WHERE key='schema_version'").get()?.value) === schemaVersion, "UNSUPPORTED_SCHEMA", "索引版本不兼容，原资产已保留。");
          requireIndex(probe.prepare("SELECT value FROM meta WHERE key='index_key'").get()?.value === indexKey, "ACCESS_DENIED", "索引身份与工作区不一致。");
          requireIndex(Object.values(probe.prepare("PRAGMA quick_check").get() ?? {})[0] === "ok", "STORE_FAILED", "索引完整性检查失败，原资产已保留。");
        }
      } finally { probe.close(); }
    }
    mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    try {
      const exists = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").get();
      if (exists) {
        requireIndex(Number(this.meta("schema_version")) === schemaVersion, "UNSUPPORTED_SCHEMA", "索引版本不兼容，原资产已保留。");
        requireIndex(this.meta("index_key") === indexKey, "ACCESS_DENIED", "索引身份与工作区不一致。");
      }
      this.db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;");
      if (!exists) {
        requireIndex(!this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get(), "UNSUPPORTED_SCHEMA", "索引文件包含未知结构，已停止写入。");
        this.transaction(() => { this.db.exec(initialSchema); this.setMeta("schema_version", String(schemaVersion)); this.setMeta("index_key", indexKey); this.setMeta("observed_epoch", "0"); this.setMeta("semantic_epoch", "0"); });
      }
      requireIndex(Number(this.meta("schema_version")) === schemaVersion, "UNSUPPORTED_SCHEMA", "索引版本不兼容，原资产已保留。");
      requireIndex(this.meta("index_key") === indexKey, "ACCESS_DENIED", "索引身份与工作区不一致。");
      const integrity = this.db.prepare("PRAGMA quick_check").get() as Row | undefined;
      requireIndex(integrity && Object.values(integrity)[0] === "ok", "STORE_FAILED", "索引完整性检查失败，原资产已保留。");
      this.transaction(() => {
        this.db.prepare("UPDATE jobs SET state='interrupted',reason='service_restart',lease_owner=NULL,lease_until=NULL WHERE state='running'").run();
        this.db.prepare("UPDATE job_groups SET state='interrupted' WHERE state='running'").run();
        this.db.prepare("UPDATE usage_events SET measurement_state='unknown',measurement_reason='执行中断，供应商用量未确认',revision=revision+1 WHERE measurement_state='pending'").run();
        this.db.prepare("UPDATE deliveries SET state='obsolete' WHERE state<>'obsolete'").run();
        this.db.exec("DELETE FROM request_ledgers; DELETE FROM query_cache;");
        this.setMeta("reconciled", "false");
      });
    } catch (error) { this.db.close(); throw error; }
  }
  transaction<T>(work: () => T): T {
    requireIndex(!this.closed && !this.inTransaction, "STORE_BUSY", "索引事务暂不可用。");
    try { this.db.exec("BEGIN IMMEDIATE"); } catch { throw new IndexError("STORE_BUSY", "索引数据库忙，请重试。", true); }
    this.inTransaction = true;
    try {
      const result = work();
      requireIndex(!(result && typeof result === "object" && "then" in result), "STORE_FAILED", "索引事务不能等待异步操作。");
      this.db.exec("COMMIT"); return result;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    finally { this.inTransaction = false; }
  }
  meta(key: string) { return (this.db.prepare("SELECT value FROM meta WHERE key=?").get(key) as { value: string } | undefined)?.value ?? null; }
  setMeta(key: string, value: string) { this.db.prepare("INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value); }
  epochs() { return { observedEpoch: Number(this.meta("observed_epoch")), semanticEpoch: Number(this.meta("semantic_epoch")) }; }
  advance(kind: "observed" | "semantic") { const key = `${kind}_epoch`, next = Number(this.meta(key)) + 1; this.setMeta(key, String(next)); this.db.exec("DELETE FROM query_cache; UPDATE deliveries SET state='obsolete' WHERE state<>'obsolete';"); return next; }
  objects() { return this.db.prepare("SELECT * FROM objects ORDER BY id").all().map(row => objectRow(row as Row)); }
  object(id: string) { const row = this.db.prepare("SELECT * FROM objects WHERE id=?").get(id); return row ? objectRow(row as Row) : null; }
  putObject(object: StoredObject) {
    this.db.prepare(`INSERT INTO objects(id,kind,name,natural_key,file_path,body_json,content_hash,content_rev,record_rev,review_json,lifecycle) VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,natural_key=excluded.natural_key,file_path=excluded.file_path,body_json=excluded.body_json,content_hash=excluded.content_hash,content_rev=excluded.content_rev,record_rev=excluded.record_rev,review_json=excluded.review_json,lifecycle=excluded.lifecycle`).run(object.id, object.kind, object.name, object.naturalKey, object.filePath, canonicalJson(object.body), object.contentHash, object.contentRev, object.recordRev, canonicalJson(object.review), object.lifecycle);
    this.db.prepare("DELETE FROM dependencies WHERE owner_id=?").run(object.id);
    for (const basis of object.review.basis) this.db.prepare("INSERT OR REPLACE INTO dependencies(owner_id,kind,dep_key,version) VALUES (?,?,?,?)").run(object.id, basis.kind, basis.key, basis.version);
  }
  links(): StoredLink[] {
    return this.db.prepare("SELECT * FROM links ORDER BY id").all().map(row => ({ id: String(row.id), fromId: String(row.from_id), target: row.to_id !== null ? { objectId: String(row.to_id) } : { sourceRefId: String(row.source_ref_id) }, relation: row.relation as StoredLink["relation"], slot: String(row.slot) }));
  }
  putLink(link: StoredLink) { this.db.prepare("INSERT INTO links(id,from_id,to_id,source_ref_id,relation,slot) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET from_id=excluded.from_id,to_id=excluded.to_id,source_ref_id=excluded.source_ref_id,relation=excluded.relation,slot=excluded.slot").run(link.id, link.fromId, "objectId" in link.target ? link.target.objectId : null, "sourceRefId" in link.target ? link.target.sourceRefId : null, link.relation, link.slot); }
  source(id: string, workspaceId: string): SourceRef | null {
    const row = this.db.prepare("SELECT * FROM source_refs WHERE id=?").get(id); if (!row) return null;
    return { id, workspaceId, path: String(row.path), contentHash: String(row.content_hash), range: { start: { line: Number(row.start_line), character: Number(row.start_character) }, end: { line: Number(row.end_line), character: Number(row.end_character) }, encoding: "utf-16" } };
  }
  putSource(ref: SourceRef) {
    const existing = this.source(ref.id, ref.workspaceId);
    if (existing) { requireIndex(canonicalJson(existing) === canonicalJson(ref), "INVALID_PROPOSAL", "不可覆盖既有来源引用。"); return; }
    this.db.prepare("INSERT INTO source_refs(id,path,content_hash,start_line,start_character,end_line,end_character) VALUES (?,?,?,?,?,?,?)").run(ref.id, ref.path, ref.contentHash, ref.range.start.line, ref.range.start.character, ref.range.end.line, ref.range.end.character);
  }
  evidence(id: string): { record: EvidenceRecord; sourcePaths: string[] } | null {
    const row = this.db.prepare("SELECT body_json,source_closure_json FROM evidence_records WHERE id=?").get(id);
    return row ? { record: decode(row.body_json), sourcePaths: decode(row.source_closure_json) } : null;
  }
  putEvidence(record: EvidenceRecord, sourcePaths: string[]) {
    const closure = [...new Set(sourcePaths)].sort(), existing = this.evidence(record.id);
    if (existing) { requireIndex(canonicalJson(existing) === canonicalJson({ record, sourcePaths: closure }), "INVALID_PROPOSAL", "不可覆盖既有证据。"); return; }
    this.db.prepare("INSERT INTO evidence_records(id,kind,source_ref_id,body_json,source_closure_json) VALUES (?,?,?,?,?)").run(record.id, record.kind, record.kind === "source_range" ? record.sourceRefId : null, canonicalJson(record), canonicalJson(closure));
  }
  files(): IndexedFile[] { return this.db.prepare("SELECT * FROM files ORDER BY path").all().map(row => ({ path: String(row.path), contentHash: row.content_hash as string | null, language: String(row.language), status: row.status as IndexedFile["status"], sizeBytes: Number(row.size_bytes), observedEpoch: Number(row.observed_epoch) })); }
  putFile(file: IndexedFile) { this.db.prepare("INSERT INTO files(path,content_hash,language,status,size_bytes,observed_epoch) VALUES (?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET content_hash=excluded.content_hash,language=excluded.language,status=excluded.status,size_bytes=excluded.size_bytes,observed_epoch=excluded.observed_epoch").run(file.path, file.contentHash, file.language, file.status, file.sizeBytes, file.observedEpoch); }
  scopes(): PersistedScope[] { return this.db.prepare("SELECT * FROM scopes ORDER BY id").all().map(row => ({ id: String(row.id), definition: decode(row.definition_json), definitionHash: String(row.definition_hash), revision: Number(row.revision), contentDigest: String(row.content_digest), members: decode(row.members_json), complete: !!row.complete })); }
  putScope(scope: PersistedScope) { this.db.prepare("INSERT INTO scopes(id,definition_json,definition_hash,revision,content_digest,members_json,complete) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,content_digest=excluded.content_digest,members_json=excluded.members_json,complete=excluded.complete").run(scope.id, canonicalJson(scope.definition), scope.definitionHash, scope.revision, scope.contentDigest, canonicalJson(scope.members), Number(scope.complete)); }
  ledger(id: string): RequestLedger | null { const row = this.db.prepare("SELECT visible_evidence_json FROM request_ledgers WHERE ledger_id=?").get(id); return row ? decode(row.visible_evidence_json) : null; }
  createLedger(ledger: RequestLedger) { this.db.prepare("INSERT INTO request_ledgers(ledger_id,request_id,attempt_id,owner_json,basis_json,visible_evidence_json,expires_at) VALUES (?,?,?,?,?,?,?)").run(ledger.ledgerId, ledger.requestId, ledger.attemptId, canonicalJson(ledger.owner), canonicalJson(ledger.basis), canonicalJson(ledger), ledger.expiresAt); }
  putLedger(ledger: RequestLedger) {
    const result = this.db.prepare("UPDATE request_ledgers SET basis_json=?,visible_evidence_json=? WHERE ledger_id=? AND request_id=? AND attempt_id=? AND owner_json=? AND expires_at=? AND expires_at>?").run(canonicalJson(ledger.basis), canonicalJson(ledger), ledger.ledgerId, ledger.requestId, ledger.attemptId, canonicalJson(ledger.owner), ledger.expiresAt, Date.now());
    requireIndex(result.changes === 1, "SNAPSHOT_EXPIRED", "证据读取尝试已撤销或到期。");
  }
  deleteLedger(id: string) { this.db.prepare("DELETE FROM request_ledgers WHERE ledger_id=?").run(id); }
  submission(requestId: string): Submission | null { const row = this.db.prepare("SELECT * FROM submissions WHERE request_id=?").get(requestId); return row ? { requestId, proposalDigest: String(row.proposal_digest), owner: decode(row.owner_json), outcome: decode(row.outcome_json), committedAt: Number(row.committed_at) } : null; }
  putSubmission(submission: Submission) { this.db.prepare("INSERT INTO submissions(request_id,proposal_digest,owner_json,outcome_json,committed_at) VALUES (?,?,?,?,?)").run(submission.requestId, submission.proposalDigest, canonicalJson(submission.owner), canonicalJson(submission.outcome), submission.committedAt); this.setMeta("last_committed_at", String(submission.committedAt)); }
  change(paths: string[], source: "tool" | "watcher" | "reconcile", runId: string | null) {
    this.transaction(() => { const epoch = this.advance("observed"); this.advance("semantic"); this.setMeta("reconciled", "false");
      for (const name of new Set(paths)) this.db.prepare("INSERT INTO change_events(path,source,run_id,observed_epoch) VALUES (?,?,?,?)").run(name, source, runId, epoch);
    });
  }
  changes(limit = 10_001) { return this.db.prepare("SELECT id,path,source,run_id AS runId,observed_epoch AS observedEpoch FROM change_events WHERE consumed_by IS NULL ORDER BY id LIMIT ?").all(limit) as { id: number; path: string; source: string; runId: string | null; observedEpoch: number }[]; }
  consumeChanges(through: number, jobId: string) { this.db.prepare("UPDATE change_events SET consumed_by=? WHERE id<=? AND consumed_by IS NULL").run(jobId, through); }
  putTerms(objectId: string, terms: { term: string; weight: number }[]) { this.db.prepare("DELETE FROM search_terms WHERE object_id=?").run(objectId); for (const term of terms) this.db.prepare("INSERT INTO search_terms(object_id,term,weight) VALUES (?,?,?)").run(objectId, term.term, term.weight); }
  terms(words: string[], limit = 128): { id: string; score: number }[] {
    if (!words.length) return [];
    return this.db.prepare(`SELECT object_id AS id,SUM(weight) AS score FROM search_terms WHERE term IN (${words.slice(0, 128).map(() => "?").join(",")}) GROUP BY object_id ORDER BY score DESC,object_id LIMIT ?`).all(...words.slice(0, 128), limit) as { id: string; score: number }[];
  }
  cache(key: string): { selection: unknown; basis: BasisItem[] } | null {
    const epochs = this.epochs(), row = this.db.prepare("SELECT payload_json,basis_json FROM query_cache WHERE key=? AND workspace_epoch=? AND semantic_epoch=?").get(key, epochs.observedEpoch, epochs.semanticEpoch);
    if (!row) return null;
    this.db.prepare("UPDATE query_cache SET last_access=? WHERE key=?").run(Date.now(), key);
    return { selection: decode(row.payload_json), basis: decode(row.basis_json) };
  }
  putCache(key: string, selection: unknown, basis: BasisItem[]) {
    const payload = canonicalJson(selection); if (Buffer.byteLength(payload) > 64 * 1024) return;
    const epochs = this.epochs();
    this.db.prepare("INSERT OR REPLACE INTO query_cache(key,workspace_epoch,semantic_epoch,payload_json,basis_json,last_access) VALUES (?,?,?,?,?,?)").run(key, epochs.observedEpoch, epochs.semanticEpoch, payload, canonicalJson(basis), Date.now());
    this.db.exec("DELETE FROM query_cache WHERE key NOT IN (SELECT key FROM query_cache ORDER BY last_access DESC,key LIMIT 200)");
  }
  usages(requestId?: string): UsageEvent[] {
    const rows = requestId ? this.db.prepare("SELECT * FROM usage_events WHERE request_id=? ORDER BY created_at,id").all(requestId) : this.db.prepare("SELECT * FROM usage_events ORDER BY created_at,id").all();
    return rows.map(row => ({ id: String(row.id), modelRequestId: String(row.model_request_id), requestId: String(row.request_id), attemptId: String(row.attempt_id), owner: decode(row.owner_json), provider: String(row.provider), model: String(row.model), revision: Number(row.revision), accountingState: row.accounting_state as UsageEvent["accountingState"], reservedInput: Number(row.reserved_input), reservedOutput: Number(row.reserved_output), createdAt: Number(row.created_at),
      ...(row.measurement_state === "reported" ? { measurementState: "reported" as const, usage: decode(row.usage_json), reason: null } : row.measurement_state === "pending" ? { measurementState: "pending" as const, usage: null, reason: null } : { measurementState: "unknown" as const, usage: null, reason: String(row.measurement_reason) }) })) as UsageEvent[];
  }
  putUsage(event: UsageEvent) { this.db.prepare("INSERT INTO usage_events(id,model_request_id,request_id,attempt_id,owner_json,provider,model,revision,measurement_state,measurement_reason,usage_json,accounting_state,reserved_input,reserved_output,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,measurement_state=excluded.measurement_state,measurement_reason=excluded.measurement_reason,usage_json=excluded.usage_json,accounting_state=excluded.accounting_state WHERE excluded.revision>usage_events.revision").run(event.id, event.modelRequestId, event.requestId, event.attemptId, canonicalJson(event.owner), event.provider, event.model, event.revision, event.measurementState, event.reason, event.usage ? canonicalJson(event.usage) : null, event.accountingState, event.reservedInput, event.reservedOutput, event.createdAt); }
  putDelivery(delivery: ContextDelivery) { this.db.prepare("INSERT INTO deliveries(delivery_id,model_request_id,package_id,session_id,run_id,context_generation,body_hash,manifest_json,state,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(delivery_id) DO UPDATE SET model_request_id=excluded.model_request_id,manifest_json=excluded.manifest_json,state=excluded.state,updated_at=excluded.updated_at").run(delivery.deliveryId, delivery.modelRequestId, delivery.packageId, delivery.sessionId, delivery.runId, delivery.contextGeneration, delivery.bodyHash, canonicalJson(delivery), delivery.state, Date.now()); }
  deliveries(sessionId: string) { return this.db.prepare("SELECT manifest_json,state FROM deliveries WHERE session_id=? ORDER BY updated_at DESC LIMIT 64").all(sessionId).map(row => ({ ...decode<ContextDelivery>(row.manifest_json), state: row.state as ContextDelivery["state"] })); }
  checkpoint() { requireIndex(!this.inTransaction, "STORE_BUSY", "索引正在提交。"); this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); }
  backup(destination: string) { requireIndex(path.resolve(destination) !== path.resolve(this.filename), "INVALID_INPUT", "备份必须使用新文件。"); this.db.prepare("VACUUM INTO ?").run(destination); return { path: destination, indexKey: this.indexKey, schemaVersion }; }
  doctor() { return { integrity: this.db.prepare("PRAGMA integrity_check").all(), foreignKeys: this.db.prepare("PRAGMA foreign_key_check").all(), schemaVersion: Number(this.meta("schema_version")), indexKey: this.indexKey }; }
  close() { if (this.closed) return; this.checkpoint(); this.db.close(); this.closed = true; }
}
