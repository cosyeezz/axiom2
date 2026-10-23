import { randomUUID } from "node:crypto";
import type { Store } from "./storage.js";
import { AppError, object, text, type Command, type Scope } from "../shared/protocol.js";
import type { Selection } from "../shared/agent.js";
import { processingKinds, processingStates, type ProcessingCall, type ProcessingKind, type ProcessingList, type ProcessingPayload, type ProcessingRecord, type ProcessingState, type ProcessingSummary } from "../shared/processing.js";

const instances = new WeakMap<Store, ProcessingRecords>();
const secretKey = /^(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|headers)$/i;
function redact(value: string): string {
  // Prompts often contain a serialized document. Sanitize its string values before
  // the enclosing payload escapes quotation marks again.
  try { const parsed = JSON.parse(value); if (parsed && typeof parsed === "object") return JSON.stringify(sanitize(parsed)); } catch { /* Ordinary text. */ }
  return value.replace(/\bBearer\s+[^\s"'<>]+/gi, "Bearer [已隐藏]")
    .replace(/\b(sk-[a-zA-Z0-9_-]{16,})\b/g, "[已隐藏]")
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1"[已隐藏]"');
}
function sanitize(value: unknown): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, secretKey.test(key) ? "[已隐藏]" : sanitize(val)]));
  return value;
}
export function processingError(error: unknown): string { return redact(error instanceof Error ? error.message : String(error ?? "处理失败")); }
function payload(value: unknown): ProcessingPayload {
  const clean = typeof value === "string" ? redact(value) : JSON.stringify(sanitize(value), null, 2) ?? "", limit = 2_000_000;
  return { text: clean.slice(0, limit), truncated: clean.length > limit };
}
export class ProcessingRecords {
  static for(store: Store) { let value = instances.get(store); if (!value) { value = new ProcessingRecords(store); instances.set(store, value); } return value; }
  private constructor(private store: Store) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS processing_records(id TEXT PRIMARY KEY, workspaceId TEXT NOT NULL, sessionId TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL, startedAt INTEGER NOT NULL, summary TEXT NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS processing_records_workspace ON processing_records(workspaceId,startedAt DESC);
      CREATE INDEX IF NOT EXISTS processing_records_session ON processing_records(sessionId);`);
    for (const row of store.db.prepare("SELECT body FROM processing_records WHERE state IN ('running','cancelling')").all()) {
      const record = JSON.parse(String(row.body)) as ProcessingRecord;
      this.finish(record.id, "interrupted", "服务已重启，未自动重新发起请求");
    }
  }
  private write(record: ProcessingRecord) {
    const { calls, stages, result, ...summary } = record;
    this.store.db.prepare("INSERT INTO processing_records VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,summary=excluded.summary,body=excluded.body")
      .run(record.id, record.workspaceId, record.sessionId, record.kind, record.state, record.startedAt, JSON.stringify(summary), JSON.stringify(record));
  }
  private read(id: string) { const row = this.store.db.prepare("SELECT body FROM processing_records WHERE id=?").get(id); return row ? JSON.parse(String(row.body)) as ProcessingRecord : undefined; }
  start(scope: Scope, kind: ProcessingKind, title: string, id: string = randomUUID(), startedAt = Date.now(), legacy = false) {
    if (!this.read(id)) this.write({ workspaceId: scope.workspaceId, sessionId: scope.sessionId, id, kind, title: redact(title), startedAt, legacy, endedAt: null, state: "running", stage: "准备", error: null, stages: legacy ? [] : [{ name: "准备", at: startedAt }], calls: [] });
    return id;
  }
  stage(id: string, stage: string, selection?: Selection) {
    const record = this.read(id); if (!record || !["running", "cancelling"].includes(record.state)) return;
    if (record.stage !== stage) record.stages.push({ name: stage, at: Date.now() });
    record.stage = stage; if (selection) record.selection = selection; this.write(record);
  }
  cancelling(id: string, error?: string) { const record = this.read(id); if (record && record.state === "running") { record.state = "cancelling"; if (error) record.error = processingError(error); this.write(record); } }
  finish(id: string, state: ProcessingState, error?: unknown, result?: unknown) {
    const record = this.read(id); if (!record) return;
    // Preserve the first terminal outcome. Explicit compression recovery can reconcile application separately.
    if (!["running", "cancelling"].includes(record.state)) return;
    record.state = state; record.endedAt = Date.now(); record.error = error == null ? null : processingError(error);
    if (result !== undefined) record.result = payload(result);
    for (const call of record.calls) if (call.state === "running" || call.state === "cancelling") { call.state = state === "completed" ? "interrupted" : state; call.endedAt = record.endedAt; call.error = record.error ?? "未收到完整模型响应"; }
    this.write(record);
  }
  failure(id: string, error: unknown, signal?: AbortSignal) {
    const code = (error as { code?: string })?.code;
    this.finish(id, code === "REVISION_CONFLICT" ? "invalidated" : code === "MEMORY_CANCELLED" || (error as Error)?.name === "AbortError" || signal?.aborted && signal.reason?.name !== "TimeoutError" ? "cancelled" : "failed", signal?.aborted ? signal.reason ?? error : error);
  }
  callStart(id: string, stage: string, input: unknown, selection?: Selection, callId: string = randomUUID()) {
    const record = this.read(id); if (!record || !["running", "cancelling"].includes(record.state)) return callId;
    if (record.calls.some((call) => call.id === callId)) return callId;
    record.calls.push({ id: callId, stage, state: "running", startedAt: Date.now(), endedAt: null, selection, input: payload(input) });
    this.write(record); return callId;
  }
  callSent(id: string, callId: string) {
    const record = this.read(id), call = record?.calls.find((item) => item.id === callId);
    if (record && call && !call.sentAt) { call.sentAt = Date.now(); this.write(record); }
  }
  callFinish(id: string, callId: string, output?: unknown, error?: unknown, usage?: unknown) {
    const record = this.read(id), call = record?.calls.find((call) => call.id === callId); if (!record || !call) return;
    if (output !== undefined && !call.output) call.output = payload(output);
    if (usage !== undefined) call.usage = sanitize(usage);
    if (call.state === "running") { call.state = error == null ? "completed" : (error as { code?: string })?.code === "MEMORY_CANCELLED" || (error as Error)?.name === "AbortError" ? "cancelled" : "failed"; call.endedAt = Date.now(); if (error != null) call.error = processingError(error); }
    this.write(record);
  }
  syncCompression(scope: Scope, job: { id: string; state: string; phase: string; startedAt: number; endedAt: number | null; error: string | null; summary: string; selection: { provider: string; id: string } }) {
    const absent = !this.read(job.id);
    this.start(scope, "compression", "上下文压缩", job.id, job.startedAt, absent);
    const record = this.read(job.id)!;
    const stage = ({ snapshot: "读取上下文", summarizing: "生成摘要", applying: "应用摘要", done: "完成" } as Record<string, string>)[job.phase] ?? job.phase;
    // Legacy jobs have no per-stage timestamps; discard synthetic import times too.
    if (record.legacy) record.stages = [];
    else if (record.stage !== stage) record.stages.push({ name: stage, at: Date.now() });
    record.stage = stage; record.selection = job.selection as Selection;
    if (job.error) record.error = processingError(job.error);
    if (job.state !== "running") {
      record.state = job.state as ProcessingState; record.endedAt = job.endedAt; record.error = job.error && processingError(job.error);
      if (job.summary) record.result = payload(job.summary);
      for (const call of record.calls) if (call.state === "running") { call.state = job.state === "completed" ? "interrupted" : record.state; call.endedAt = job.endedAt; call.error = record.error ?? "未收到完整模型响应"; }
    }
    this.write(record);
  }
  private authorize(workspaceId: string, sessionId?: string) {
    if (!this.store.workspace(workspaceId).authorized) throw new AppError("AUTHORIZATION_REQUIRED", "请先授权工作空间访问");
    if (sessionId && !this.store.db.prepare("SELECT id FROM sessions WHERE id=? AND workspaceId=?").get(sessionId, workspaceId)) throw new AppError("NOT_FOUND", "来源会话不可用");
  }
  command(c: Command): ProcessingList | ProcessingRecord {
    const workspaceId = text(c.workspaceId, "工作空间"), p = object(c.params ?? {}); this.authorize(workspaceId);
    if (c.op === "processing.get") {
      const record = this.read(text(p.id, "处理记录"));
      if (!record || record.workspaceId !== workspaceId) throw new AppError("NOT_FOUND", "处理记录不存在或不属于当前工作空间");
      this.authorize(workspaceId, record.sessionId); return record;
    }
    if (c.op !== "processing.list") throw new AppError("UNKNOWN_OPERATION", "不支持的处理记录操作");
    const kind = p.kind ? text(p.kind, "类型") : "", state = p.state ? text(p.state, "状态") : "";
    if (kind && !Object.hasOwn(processingKinds, kind) || state && !Object.hasOwn(processingStates, state)) throw new AppError("INVALID_INPUT", "处理记录筛选无效");
    const sessionId = p.sessionId ? text(p.sessionId, "会话") : "", query = typeof p.query === "string" ? p.query.trim().slice(0, 200) : "";
    const before = p.before === undefined ? Number.MAX_SAFE_INTEGER : Number(p.before), since = p.since === undefined ? 0 : Number(p.since);
    if (!Number.isSafeInteger(before) || before < 0 || !Number.isSafeInteger(since) || since < 0) throw new AppError("INVALID_INPUT", "记录分页参数无效");
    const rows = this.store.db.prepare(`SELECT r.rowid AS cursor,r.summary FROM processing_records r JOIN sessions s ON s.id=r.sessionId AND s.workspaceId=r.workspaceId
      WHERE r.workspaceId=? AND r.rowid<? AND r.startedAt>=? AND (?='' OR r.kind=?) AND (?='' OR r.state=?) AND (?='' OR r.sessionId=?) AND (?='' OR instr(lower(r.summary),lower(?))>0) ORDER BY r.rowid DESC LIMIT 51`)
      .all(workspaceId, before, since, kind, kind, state, state, sessionId, sessionId, query, query);
    const items = rows.slice(0, 50).map((row) => JSON.parse(String(row.summary)) as ProcessingSummary);
    return { items, next: rows.length > 50 ? Number(rows[49]!.cursor) : null };
  }
}
