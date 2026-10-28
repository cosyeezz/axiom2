import { createHash, randomUUID } from "node:crypto";
import { constants, realpathSync } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { nativeCompactionAttemptKind, costParts, emptyCostTotals, type CostCategory, type CostTotals } from "../shared/costs.js";
import type { Compression } from "../shared/compression.js";
import { kiroCompactionAttemptKind } from "../shared/kiro-usage.js";
import type { UsageRecord, UsageRecordFilter, UsageRecordPage, UsageSessionDirectory } from "../shared/model-usage.js";
import { AppError } from "../shared/protocol.js";
import { compressionCost } from "./costs.js";
import { usageModelNames } from "./model-metadata.js";
import type { Store } from "./storage.js";
import { usageCost } from "./usage-cost.js";
import { nativeCompactionCost } from "./native-compaction-usage.js";

type Json = Record<string, any>;
const object = (v: unknown): Json => v && typeof v === "object" && !Array.isArray(v) ? v as Json : {};
const text = (v: unknown, max = 160): string | null => typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
const label = (v: unknown, fallback: string) => typeof v === "string" && v.trim() ? v.trim().slice(0, 160) : fallback;
const at = (v: unknown): number | undefined => {
  const value = typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(value) && value >= 0 && value <= 8.64e15 ? value : undefined;
};
function filter(input: unknown): UsageRecordFilter {
  const data = object(input), result: UsageRecordFilter = {};
  for (const key of ["workspaceId", "snapshot", "rootSessionId"] as const) if (data[key] !== undefined) {
    const value = text(data[key]); if (!value) throw new AppError("INVALID_INPUT", "用量筛选参数无效。");
    result[key] = value;
  }
  if (data.agentRole !== undefined) {
    if (data.agentRole !== "main" && data.agentRole !== "subagent") throw new AppError("INVALID_INPUT", "代理类型筛选无效。");
    result.agentRole = data.agentRole;
  }
  if (data.providerId !== undefined) {
    if (data.providerId !== null && !text(data.providerId)) throw new AppError("INVALID_INPUT", "供应商筛选无效。");
    result.providerId = data.providerId;
  }
  if (data.query !== undefined) {
    if (typeof data.query !== "string" || data.query.length > 200) throw new AppError("INVALID_INPUT", "搜索条件最多200字符。");
    result.query = data.query.trim();
  }
  for (const key of ["from", "to"] as const) if (data[key] !== undefined) {
    if (typeof data[key] !== "number" || at(data[key]) === undefined) throw new AppError("INVALID_INPUT", "用量日期范围无效。");
    result[key] = data[key];
  }
  if (result.from !== undefined && result.to !== undefined && result.from > result.to) throw new AppError("INVALID_INPUT", "开始日期不能晚于结束日期。");
  for (const [key, fallback, maximum] of [["page", 1, 1_000_000], ["pageSize", 20, 100]] as const) {
    const value = data[key] ?? fallback;
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new AppError("INVALID_INPUT", "分页参数无效。");
    result[key] = value;
  }
  for (const key of ["refresh", "continue"] as const) {
    if (data[key] !== undefined && typeof data[key] !== "boolean") throw new AppError("INVALID_INPUT", "扫描参数无效。");
    result[key] = data[key] === true;
  }
  return result;
}
type Snapshot = { db: DatabaseSync; id: string; updatedAt: number; partial: boolean; warnings: string[]; scannedRoots: number; processedRoots: number; totalRoots: number; building: boolean };
type Cached = Snapshot & { scan?: AsyncGenerator<Snapshot, Snapshot>; timer?: ReturnType<typeof setTimeout> };
type Limits = { roots: number; bytes: number; rows: number; milliseconds: number; databaseRows: number; lineBytes: number; ttl: number; fileBytes: number; sourceRows: number };
const defaults: Limits = { roots: 1000, bytes: 32 * 1024 * 1024, rows: 20_000, milliseconds: 3000, databaseRows: 5000, lineBytes: 1024 * 1024, ttl: 5 * 60_000,
  fileBytes: 512 * 1024 * 1024, sourceRows: 5000 };

/** Disposable, bounded per-entry ledger. No transcript bodies or credentials enter the index. */
export class ModelUsageLedger {
  private cache = new Map<string, Cached>();
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private readonly limits: Limits;
  constructor(private readonly store: Store, private readonly modelsDir: string, limits: Partial<Limits> = {}) { this.limits = { ...defaults, ...limits }; }
  workspaces() {
    return this.store.db.prepare("SELECT id,substr(name,1,160) AS name FROM workspaces WHERE archived=0 AND length(CAST(id AS BLOB))<=160 ORDER BY name,id LIMIT 1000").all()
      .map(row => ({ id: String(row.id), name: String(row.name) }));
  }
  /** Metadata only: never opens histories or starts a ledger scan. */
  sessions(input: unknown = {}): UsageSessionDirectory {
    const { workspaceId } = filter(input);
    if (workspaceId && !this.store.db.prepare("SELECT 1 FROM workspaces WHERE id=? AND archived=0").get(workspaceId)) throw new AppError("NOT_FOUND", "工作空间不存在或已归档。");
    const rows = this.store.db.prepare(`SELECT s.id,substr(s.title,1,160) AS title,w.id AS workspaceId,substr(w.name,1,160) AS workspaceName
      FROM sessions s JOIN workspaces w ON w.id=s.workspaceId WHERE w.archived=0 AND s.deletedAt IS NULL
      AND length(CAST(s.id AS BLOB))<=160 AND length(CAST(w.id AS BLOB))<=160
      AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.workspaceId=s.workspaceId AND t.sessionId=s.id)
      ${workspaceId ? "AND w.id=?" : ""} ORDER BY w.name,s.updatedAt DESC,s.id LIMIT 1001`).all(...(workspaceId ? [workspaceId] : []));
    return { sessions: rows.slice(0, 1000).map(row => ({ id: String(row.id), title: label(row.title, "未命名会话"), workspaceId: String(row.workspaceId), workspaceName: String(row.workspaceName) })), truncated: rows.length > 1000 };
  }
  read(input: unknown = {}): Promise<UsageRecordPage> {
    const params = filter(input);
    if (this.closed) throw new AppError("INVALID_INPUT", "用量统计已关闭。");
    const result = this.tail.then(() => this.page(params));
    this.tail = result.catch(() => {});
    return result;
  }
  async close() {
    this.closed = true; await this.tail;
    const snapshots = [...this.cache.values()]; this.cache.clear();
    await Promise.all(snapshots.map(value => this.dispose(value)));
  }
  private async dispose(value: Cached) {
    clearTimeout(value.timer);
    try { await value.scan?.return(value); } finally { try { value.db.close(); } catch { /* Builder already closed after an error. */ } }
  }
  private remember(key: string, value: Cached) {
    clearTimeout(this.cache.get(key)?.timer);
    this.cache.delete(key); this.cache.set(key, value);
    value.timer = setTimeout(() => {
      const expiry = this.tail.then(async () => {
        if (this.cache.get(key) !== value) return;
        this.cache.delete(key); await this.dispose(value);
      });
      this.tail = expiry.catch(() => {});
    }, this.limits.ttl); value.timer.unref();
  }
  private async page(params: UsageRecordFilter): Promise<UsageRecordPage> {
    const key = JSON.stringify(params.workspaceId ?? null);
    if (params.workspaceId && !this.store.db.prepare("SELECT 1 FROM workspaces WHERE id=? AND archived=0").get(params.workspaceId)) throw new AppError("NOT_FOUND", "工作空间不存在或已归档。");
    if (params.rootSessionId && !this.store.db.prepare(`SELECT 1 FROM sessions s JOIN workspaces w ON w.id=s.workspaceId
      WHERE s.id=? AND s.deletedAt IS NULL AND w.archived=0
      AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.workspaceId=s.workspaceId AND t.sessionId=s.id)
      ${params.workspaceId ? "AND w.id=?" : ""}`).get(params.rootSessionId, ...(params.workspaceId ? [params.workspaceId] : [])))
      throw new AppError("NOT_FOUND", "会话不存在、已删除或不在所选工作空间。");
    let snapshot = this.cache.get(key);
    if (!snapshot || params.refresh || Date.now() - snapshot.updatedAt >= this.limits.ttl) {
      if (snapshot) { this.cache.delete(key); await this.dispose(snapshot); }
      const scan = this.build(params.workspaceId), next = await scan.next();
      snapshot = { ...next.value, ...(!next.done ? { scan } : {}) }; this.remember(key, snapshot);
      while (this.cache.size > 2) { const oldest = this.cache.keys().next().value!; const value = this.cache.get(oldest)!; this.cache.delete(oldest); await this.dispose(value); }
    } else if (params.continue && snapshot.scan) {
      const scan = snapshot.scan;
      try { const next = await scan.next(); snapshot = { ...next.value, ...(!next.done ? { scan } : {}) }; this.remember(key, snapshot); }
      catch (error) { this.cache.delete(key); await this.dispose(snapshot); throw error; }
    }
    const reset = !!params.snapshot && params.snapshot !== snapshot.id;
    const where: string[] = [], values: (number | string | null)[] = [];
    if (params.providerId !== undefined) { where.push("provider IS ?"); values.push(params.providerId); }
    if (params.rootSessionId) { where.push("json_extract(data,'$.rootSessionId')=?"); values.push(params.rootSessionId); }
    // Identity belongs to the session, not its accounting category (tool/compression/memory).
    if (params.agentRole) where.push(`json_extract(data,'$.sessionId') ${params.agentRole === "main" ? "=" : "<>"} json_extract(data,'$.rootSessionId')`);
    if (params.query) { where.push("search LIKE ? ESCAPE '\\'"); values.push(`%${params.query.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`); }
    if (params.from !== undefined) { where.push("timestamp>=?"); values.push(params.from); }
    if (params.to !== undefined) { where.push("timestamp<=?"); values.push(params.to); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const count = Number(snapshot.db.prepare(`SELECT count(*) AS count FROM records ${clause}`).get(...values)!.count);
    const pageSize = params.pageSize!, page = Math.min(reset ? 1 : params.page!, Math.max(1, Math.ceil(count / pageSize)));
    const rows = snapshot.db.prepare(`SELECT data FROM records ${clause} ORDER BY timestamp IS NULL,timestamp DESC,id ASC LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize)
      .map(row => JSON.parse(String(row.data)) as UsageRecord);
    const fields = ["records", "knownCost", "unknownCost", "unknownTokens", "unknownParts", "estimatedCost", "estimatedRecords", ...costParts.map(p => `tokens.${p}`), ...costParts.map(p => `parts.${p}`)];
    const sums = snapshot.db.prepare(`SELECT ${fields.map((field, index) => `coalesce(sum(json_extract(data,'$.${field}')),0) AS f${index}`).join(",")} FROM records ${clause}`).get(...values)!;
    const total = emptyCostTotals();
    for (let i = 0; i < fields.length; i++) {
      const [parent, child] = fields[i].split("."), value = Number(sums[`f${i}`]);
      if (child) total[parent as "tokens" | "parts"][child as typeof costParts[number]] = value;
      else if (!parent.startsWith("estimated") || value) (total as unknown as Record<string, number>)[parent] = value;
    }
    if (total.estimatedRecords) total.estimateSources = snapshot.db.prepare(`SELECT DISTINCT json_each.value AS source FROM records, json_each(records.data,'$.estimateSources') ${clause}${clause ? " AND" : " WHERE"} json_each.type='text' AND length(json_each.value)<=1024 ORDER BY source LIMIT 64`).all(...values).map(row => String(row.source));
    return { rows, total, count, page, pageSize, snapshot: snapshot.id, updatedAt: snapshot.updatedAt, scannedRoots: snapshot.scannedRoots, totalRoots: snapshot.totalRoots,
      processedRoots: snapshot.processedRoots, building: snapshot.building,
      partial: snapshot.partial, warnings: [...snapshot.warnings, ...(reset ? ["用量快照已更新，已返回第一页。"] : [])],
      providers: snapshot.db.prepare("SELECT DISTINCT provider FROM records ORDER BY provider").all().map(row => row.provider === null ? null : String(row.provider)) };
  }
  private async *build(workspaceId?: string): AsyncGenerator<Snapshot, Snapshot> {
    const db = new DatabaseSync(":memory:"), source = this.store.db, limits = this.limits;
    db.exec("CREATE TABLE records(id TEXT PRIMARY KEY,provider TEXT,timestamp REAL,search TEXT NOT NULL,data TEXT NOT NULL); CREATE INDEX record_order ON records(timestamp DESC,id); CREATE TABLE staging AS SELECT * FROM records WHERE 0; CREATE UNIQUE INDEX staging_id ON staging(id);");
    const insert = db.prepare("INSERT OR IGNORE INTO records VALUES(?,?,?,?,?)"), stage = db.prepare("INSERT OR IGNORE INTO staging VALUES(?,?,?,?,?)");
    const exists = db.prepare("SELECT 1 FROM records WHERE id=?");
    const warnings = new Set<string>(); let bytes = 0, databaseRows = 0, count = 0, partial = false, scannedRoots = 0, processedRoots = 0, staging = false, familyComplete = true, started = performance.now();
    const warn = (message: string) => { partial = true; familyComplete = false; if (warnings.size < 20) warnings.add(message); };
    const exhausted = () => count >= limits.rows;
    const paused = () => bytes >= limits.bytes || databaseRows >= limits.databaseRows || performance.now() - started >= limits.milliseconds;
    const resume = () => { bytes = 0; databaseRows = 0; started = performance.now(); };
    const base = `FROM sessions s JOIN workspaces w ON w.id=s.workspaceId WHERE w.archived=0 AND s.deletedAt IS NULL
      AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.workspaceId=s.workspaceId AND t.sessionId=s.id) ${workspaceId ? "AND w.id=?" : ""}`;
    const parameters = workspaceId ? [workspaceId] : [];
    const totalRoots = Number(this.store.db.prepare(`SELECT count(*) AS count ${base}`).get(...parameters)!.count);
    const candidates = this.store.db.prepare(`SELECT CASE WHEN length(CAST(s.id AS BLOB))<=160 THEN s.id END AS id,
      CASE WHEN length(CAST(w.id AS BLOB))<=160 THEN w.id END AS workspaceId,substr(w.name,1,160) AS name,
      CASE WHEN length(CAST(s.forkParentSessionId AS BLOB))<=160 THEN s.forkParentSessionId END AS forkParentSessionId,
      CASE WHEN length(CAST(w.path AS BLOB))<=4096 THEN w.path END AS path ${base} ORDER BY s.forkParentSessionId IS NOT NULL,w.id,s.id LIMIT ?`).all(...parameters, this.limits.roots);
    // Ancestors precede descendants within the same bounded candidate set, even when
    // a grandchild's random UUID sorts before its parent. Do not narrow the scan by filter.
    const byId = new Map(candidates.filter(row => row.id).map(row => [String(row.id), row]));
    const descendants = new Map<(typeof candidates)[number], typeof candidates>();
    const roots = candidates.filter(root => {
      const parent = root.forkParentSessionId ? byId.get(String(root.forkParentSessionId)) : undefined;
      if (!parent || parent.workspaceId !== root.workspaceId) return true;
      const children = descendants.get(parent) ?? []; children.push(root); descendants.set(parent, children); return false;
    });
    for (let index = 0; index < roots.length; index++) roots.push(...(descendants.get(roots[index]) ?? []));
    const ordered = new Set(roots); roots.push(...candidates.filter(root => !ordered.has(root))); // Cycles fail closed during lineage validation.
    const tables = new Set(this.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('compressions','memory_usage')").all().map(row => row.name));
    const memoryHasTime = tables.has("memory_usage") && this.store.db.prepare("PRAGMA table_info(memory_usage)").all().some(row => row.name === "createdAt");
    const lineageCache = new Map<string, string>();
    const lineage = (workspace: string, sessionId: string): string | null => {
      const key = (id: string) => JSON.stringify([workspace, id]), start = key(sessionId);
      const verified = (origin: string) => { lineageCache.set(start, origin); return origin; };
      let id = sessionId; const visited = new Set<string>();
      for (let depth = 0; ; depth++) {
        const known = lineageCache.get(key(id)); if (known !== undefined) return verified(known);
        if (depth >= 64 || visited.has(id) || exhausted()) break;
        visited.add(id); databaseRows++;
        const row = this.store.db.prepare("SELECT CASE WHEN length(CAST(forkParentSessionId AS BLOB))<=160 THEN forkParentSessionId END AS parent,forkParentSessionId IS NOT NULL AS hasParent FROM sessions WHERE workspaceId=? AND id=?").get(workspace, id);
        if (!row) break;
        if (!row.hasParent) return verified(id);
        if (!text(row.parent)) break;
        id = String(row.parent);
      }
      warn("部分分支来源超过谱系上限或无法完整核对，无法确认去重身份的继承调用未计入。");
      return null; // Never turn an unverified intermediate ancestor into a new billing identity.
    };
    // Project accounting only: summaries/snapshots do not consume the ledger's byte budget.
    // Each source row and result are bounded before crossing the SQLite/JS boundary.
    const field = (path: string, maximum = 160) => `CASE WHEN length(CAST(json_extract(body,'$.${path}') AS BLOB))<=${maximum} THEN json_extract(body,'$.${path}') END`;
    const jsonField = (path: string, maximum: number) => `json(CASE WHEN json_type(body,'$.${path}')='object' AND length(CAST(json_extract(body,'$.${path}') AS BLOB))<=${maximum} THEN json_extract(body,'$.${path}') ELSE 'null' END)`;
    const compression = `CASE WHEN length(CAST(body AS BLOB))<=16777216 AND json_valid(body) THEN CASE WHEN json_type(body,'$.selection')='object' THEN json_object('id',substr(id,1,161),
      'selection',json_object('provider',${field("selection.provider")},'id',${field("selection.id")}),
      'state',${field("state")},'phase',${field("phase")},'trigger',${field("trigger")},'startedAt',${field("startedAt")},
      'usage',${jsonField("usage", 8192)},'billing',${jsonField("billing", 8192)}) END END AS body`;
    const invalidCompression = `CASE WHEN length(CAST(body AS BLOB))>16777216 OR NOT json_valid(body) THEN 1 ELSE
      coalesce(length(CAST(json_extract(body,'$.billing') AS BLOB))>8192,0) OR
      (coalesce(json_type(body,'$.billing'),'null')='null' AND coalesce(length(CAST(json_extract(body,'$.usage') AS BLOB))>8192,0)) END AS unverified`;
    const bounded = (column: string, maximum: number) => `CASE WHEN length(CAST(${column} AS BLOB))<=${maximum} THEN ${column} END AS ${column}`;
    const readRows = function* (table: "compressions" | "memory_usage", sessionId: string) {
      if (!tables.has(table)) return;
      const columns = table === "compressions" ? [bounded("id", 160), compression, invalidCompression] : [bounded("id", 160), bounded("kind", 160), bounded("provider", 160), bounded("model", 160), bounded("usage", 16384), "usage IS NOT NULL AS hasUsage", ...(memoryHasTime ? ["createdAt"] : [])];
      let cursor = 0, seen = 0;
      while (!exhausted()) {
        const rows = source.prepare(`SELECT rowid AS cursor,${columns.join(",")} FROM ${table} WHERE sessionId=? AND rowid>? ORDER BY rowid LIMIT ?`).all(sessionId, cursor, Math.min(8, Math.max(1, limits.sourceRows - seen + 1)));
        databaseRows++;
        if (!rows.length) return;
        for (const row of rows) {
          if (seen++ >= limits.sourceRows) { warn("部分数据库调用超过单来源账务上限，未计入。"); return; }
          databaseRows++; bytes += Buffer.byteLength(JSON.stringify(row)) * 2; cursor = Number(row.cursor); yield row;
        }
      }
    };
    const publish = (building: boolean): Snapshot => {
      const identities = db.prepare("SELECT DISTINCT json_extract(data,'$.provider') AS provider,json_extract(data,'$.model') AS model FROM records LIMIT 1000").all()
        .map(row => ({ provider: row.provider === null ? null : String(row.provider), model: row.model === null ? null : String(row.model) }));
      const names = new Map(usageModelNames(this.modelsDir, identities).filter(row => row.name).map(row => [JSON.stringify([row.provider, row.model]), row.name!]));
      const rename = db.prepare("UPDATE records SET data=?,search=search||' '||? WHERE id=?");
      for (const stored of db.prepare("SELECT id,data FROM records").all()) {
        const row = JSON.parse(String(stored.data)) as UsageRecord, name = names.get(JSON.stringify([row.provider, row.model]));
        if (name && row.name !== name) rename.run(JSON.stringify({ ...row, name }), name.toLowerCase(), String(stored.id));
      }
      return { db, id: randomUUID(), updatedAt: Date.now(), partial: partial || building, warnings: [...warnings,
        ...(building ? ["正在分批核对其余会话；当前统计仅包含已验证来源。"] : [])], scannedRoots, processedRoots, totalRoots, building };
    };
    try {
      for (let index = 0; index < roots.length; index++) {
        if (index && index % 4 === 0) await yieldTurn();
        if (exhausted()) break;
        if (paused()) { yield publish(true); resume(); }
        const root = roots[index]; familyComplete = true;
        if (!root.id || !root.workspaceId || !root.path) { warn("部分会话标识无效，未计入。"); processedRoots++; continue; }
        const children = this.store.db.prepare("SELECT substr(s.id,1,161) AS id,substr(s.title,1,160) AS title FROM tasks t JOIN sessions s ON s.id=t.sessionId AND s.workspaceId=t.workspaceId WHERE t.workspaceId=? AND t.parentSessionId=? ORDER BY t.id LIMIT 513").all(String(root.workspaceId), String(root.id));
        databaseRows += children.length + 1;
        if (children.length >= 512 || children.some(row => !text(row.id))) { warn("部分会话家族超过扫描预算，未计入。"); processedRoots++; continue; }
        const parent = this.store.db.prepare("SELECT substr(title,1,160) AS title FROM sessions WHERE id=?").get(String(root.id))!;
        const sessions = [{ id: String(root.id), title: parent.title, child: false }, ...children.map(row => ({ id: String(row.id), title: row.title, child: true }))];
        for (const session of sessions) {
          if (exhausted()) { familyComplete = false; break; }
          if (paused()) { yield publish(true); resume(); }
          const origin = lineage(String(root.workspaceId), session.id);
          const put = (sourceId: string, category: CostCategory, source: string, totals: CostTotals, provider: unknown = null, model: unknown = null, timestamp?: number, status?: string, kind: UsageRecord["kind"] = "call") => {
            if (exhausted() || sourceId.startsWith("entry:") && origin === null) return;
            const valid = [totals.records, totals.knownCost, totals.unknownCost, totals.unknownParts, totals.unknownTokens,
              ...costParts.map(p => totals.tokens?.[p]), ...costParts.map(p => totals.parts?.[p])].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0);
            if (!valid) { totals = usageCost(null); warn("部分账务字段无法核对，仅保留未知记录。"); }
            const identity = sourceId.startsWith("entry:") ? [origin, sourceId, timestamp ?? null, provider, model, totals]
              : sourceId.startsWith("compression:") ? [sourceId] : [session.id, sourceId];
            const id = createHash("sha256").update(JSON.stringify([root.workspaceId, ...identity])).digest("hex");
            const row: UsageRecord = { id, category, sessionId: session.id, source: label(source, "模型调用"), provider: text(provider), model: text(model),
              workspaceId: String(root.workspaceId), workspaceName: String(root.name), rootSessionId: String(root.id), sessionTitle: label(session.title, "未命名会话"),
              ...(timestamp !== undefined ? { timestamp } : {}), ...(status ? { status: status.slice(0, 80) } : {}), kind: totals.records > 1 ? "aggregate" : kind, ...totals };
            const search = [row.workspaceName, row.sessionTitle, row.source, row.model, row.provider].join(" ").toLowerCase();
            if (staging && exists.get(id)) return;
            const result = (staging ? stage : insert).run(id, row.provider, row.timestamp ?? null, search, JSON.stringify(row)); count += Number(result.changes);
          };
          const jobs = new Map<string, Compression>(), applied = new Set<string>();
          for (const value of readRows("compressions", session.id)) {
            if (paused()) { yield publish(true); resume(); }
            try {
              const job = JSON.parse(String(value.body)) as Compression; if (!job?.selection || !text(value.id)) throw Error();
              if (value.unverified) warn("部分压缩账务超过单行上限，仅计入可核对字段。");
              jobs.set(String(value.id), job);
            }
            catch { warn("部分压缩账务记录无法核对或超过单行上限。"); }
          }
          const stored = this.store.db.prepare("SELECT CASE WHEN length(CAST(file AS BLOB))<=4096 THEN file END AS file,file IS NOT NULL AS hasFile,usage IS NOT NULL AS hasUsage FROM agent_sessions WHERE sessionId=?").get(session.id);
          databaseRows++;
          if (stored?.file) {
            db.exec("DELETE FROM staging"); staging = true;
            try {
              // O_NOFOLLOW alone does not reject links on every platform. Check
              // the path without following it, then bind it to the open handle.
              const pathBefore = await lstat(String(stored.file));
              if (!pathBefore.isFile() || pathBefore.nlink !== 1) throw Error();
              const handle = await open(String(stored.file), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
              try {
                const before = await handle.stat();
                if (!before.isFile() || before.nlink !== 1 || before.size > limits.fileBytes ||
                  pathBefore.dev !== before.dev || pathBefore.ino !== before.ino || pathBefore.birthtimeMs !== before.birthtimeMs ||
                  pathBefore.size !== before.size || pathBefore.mtimeMs !== before.mtimeMs) throw Error();
                let position = 0, carry = Buffer.alloc(0), dropping = false, line = 0, headerValid = false;
                const consume = (buffer: Buffer) => {
                  line++; if (!buffer.length || exhausted()) return;
                  try {
                    const entry = object(JSON.parse(buffer.toString("utf8").replace(/^\uFEFF/, ""))), message = object(entry.message);
                    if (line === 1) {
                      if (buffer.length > 64 * 1024 || entry.type !== "session" || !text(entry.id) || !text(entry.cwd, 4096) ||
                        resolve(entry.cwd) !== resolve(String(root.path)) && realpathSync.native(entry.cwd) !== realpathSync.native(String(root.path))) throw new Error("ownership");
                      headerValid = true; return;
                    }
                    if (!headerValid) throw Error("header");
                    const sourceId = `entry:${text(entry.id) ?? `line-${line}`}`;
                    const timestamp = at(message.timestamp) ?? at(entry.timestamp);
                    if (entry.type === "message" && message.role === "assistant") {
                      const status = message.stopReason === "error" ? "失败" : message.stopReason === "aborted" ? "已取消" : message.stopReason === "toolUse" ? "调用工具" : message.stopReason ? "已完成" : "状态未记录";
                      put(sourceId, session.child ? "subagent" : "main", label(session.title, "模型调用"), usageCost(message.usage, message.responseModel ?? message.model), message.provider, message.responseModel ?? message.model, timestamp, status);
                    } else if (entry.type === "message" && message.role === "toolResult" && message.usage) {
                      put(sourceId, "tool", label(message.toolName, "工具内部调用"), usageCost(message.usage), null, null, timestamp);
                    } else if (entry.type === "usage") {
                      const kind = typeof entry.kind === "string" ? entry.kind : "其他模型调用", tool = kind.startsWith("tool:");
                      const summaryAttempt = kind === kiroCompactionAttemptKind || kind === nativeCompactionAttemptKind;
                      put(sourceId, summaryAttempt ? "compression" : tool ? "tool" : "other", summaryAttempt ? "原生压缩未合并请求" : tool ? kind.slice(5) : kind, usageCost(entry.usage, entry.model), entry.provider, entry.model, timestamp);
                    } else if (entry.type === "compaction" || entry.type === "branch_summary") {
                      const jobId = text(object(entry.details).axiomCompressionId);
                      if (jobId && applied.has(jobId)) return;
                      if (jobId) applied.add(jobId);
                      const job = jobId ? jobs.get(jobId) : undefined, native = entry.type === "compaction" ? nativeCompactionCost(entry.usage, entry.details) : undefined;
                      const totals = job?.billing ?? (entry.usage ? job ? usageCost(entry.usage, job.selection.id) : native?.totals ?? usageCost(entry.usage) : job ? compressionCost(job) : usageCost(null));
                      put(jobId ? `compression:${jobId}` : sourceId, "compression", job ? job.trigger === "auto" ? "自动压缩" : "后台压缩" : "原生摘要", totals, job?.selection.provider ?? native?.provider, job?.selection.id ?? native?.model, at(job?.startedAt) ?? timestamp, "已应用");
                    }
                  } catch (error) { if (line === 1) throw error; warn("部分原始调用记录损坏，未计入。"); }
                };
                while (position < before.size && !exhausted()) {
                  if (paused()) { yield publish(true); resume(); }
                  const chunk = Buffer.alloc(Math.min(64 * 1024, before.size - position, Math.max(1, limits.bytes - bytes))), read = await handle.read(chunk, 0, chunk.length, position);
                  if (!read.bytesRead) break;
                  position += read.bytesRead; bytes += read.bytesRead;
                  const buffer = Buffer.concat([carry, chunk.subarray(0, read.bytesRead)]); let offset = 0, end: number;
                  while ((end = buffer.indexOf(10, offset)) !== -1) {
                    if (!dropping && end - offset <= this.limits.lineBytes) consume(buffer.subarray(offset, end)); else { line++; warn("部分历史记录单行过大，未计入。"); }
                    dropping = false; offset = end + 1;
                  }
                  carry = buffer.subarray(offset);
                  if (line === 0 && carry.length > 64 * 1024) throw Error("header");
                  if (carry.length > this.limits.lineBytes) { dropping = true; carry = Buffer.alloc(0); }
                }
                if (carry.length && !dropping && !exhausted()) consume(carry);
                if (dropping) warn("部分历史记录单行过大，未计入。");
                if (!headerValid) throw Error("header");
                if (position < before.size || exhausted()) familyComplete = false;
                const after = await handle.stat(), current = await lstat(String(stored.file));
                if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.nlink !== 1 ||
                  !current.isFile() || current.nlink !== 1 || current.size !== before.size || current.mtimeMs !== before.mtimeMs ||
                  current.dev !== before.dev || current.ino !== before.ino || current.birthtimeMs !== before.birthtimeMs) throw Error("changed");
              } finally { await handle.close(); }
              db.exec("INSERT OR IGNORE INTO records SELECT * FROM staging; DELETE FROM staging"); staging = false;
              count = Number(db.prepare("SELECT count(*) AS count FROM records").get()!.count);
            } catch {
              // Deduplication belongs to the validated file, just like staged rows.
              // If the file changes, independent database jobs must remain billable.
              applied.clear();
              db.exec("DELETE FROM staging"); staging = false; count = Number(db.prepare("SELECT count(*) AS count FROM records").get()!.count);
              warn("部分历史文件无法读取、发生变化或超过单文件上限，未能核对全部调用。");
              put("unavailable", session.child ? "subagent" : "main", "原始记录不可读取", usageCost(null), null, null, undefined, undefined, "unavailable");
            } finally { staging = false; }
          } else if (stored?.hasFile || stored?.hasUsage) {
            warn("部分会话仅有累计值或缺少原始记录，不能拆成具体调用。");
            put("unavailable", session.child ? "subagent" : "main", "缺少原始记录", usageCost(null), null, null, undefined, undefined, "unavailable");
          }
          if (tables.has("memory_usage")) for (const value of readRows("memory_usage", session.id)) {
            if (paused()) { yield publish(true); resume(); }
            try {
              if (!text(value.id)) throw Error();
              const query = value.kind === "query";
              let usage: unknown = null;
              try { usage = value.usage ? JSON.parse(String(value.usage)) : null; } catch { warn("部分后台调用账务无法核对，仅保留未知记录。"); }
              if (value.hasUsage && !value.usage) warn("部分后台调用账务超过单行上限，仅保留未知记录。");
              put(`memory:${String(value.id)}`, query ? "tool" : "other", value.kind === "title" ? "会话标题" : query ? "记忆查询" : "后台记忆整理", usageCost(usage, value.model), value.provider, value.model, at(value.createdAt));
            } catch { warn("部分后台调用账务无法核对。"); }
          }
          for (const [id, job] of jobs) {
            if (paused()) { yield publish(true); resume(); }
            if (applied.has(id) || !job.usage && !job.billing && job.phase === "snapshot") continue;
            const states = { running: "进行中", completed: "已应用", failed: "失败 · 未应用", cancelled: "取消 · 未应用", interrupted: "中断 · 未应用" };
            put(`compression:${id}`, "compression", job.trigger === "auto" ? "自动压缩" : "后台压缩", compressionCost(job), job.selection.provider, job.selection.id, at(job.startedAt), job.state === "running" && job.phase === "applying" ? "等待应用" : states[job.state]);
          }
        }
        processedRoots++;
        if (familyComplete && !exhausted()) scannedRoots++;
      }
      if (exhausted()) warn("已达到本次派生账务条数上限；可按单个工作空间核对，当前不是全部历史。");
      if (processedRoots < totalRoots) warn(`已处理 ${processedRoots} / ${totalRoots} 个主会话家族，部分来源超过本次索引上限。`);
      return publish(false);
    } catch (error) { db.close(); throw error; }
  }
}
