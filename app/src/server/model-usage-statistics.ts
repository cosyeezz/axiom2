import { statSync } from "node:fs";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { costCategories, sumCosts, type CostCategory, type CostReport, type CostTotals } from "../shared/costs.js";
import { Lru } from "../shared/lru.js";
import type { ModelUsageStatistics as Statistics } from "../shared/model-usage.js";
import { AppError, type Scope } from "../shared/protocol.js";
import type { Costs } from "./costs.js";
import type { Store } from "./storage.js";

type Family = { total: CostTotals; models: Statistics["models"]; categories: Statistics["categories"]; warnings: string[];
  providers: Omit<Statistics["providers"][number], "byWorkspace">[] };
type ScanLimits = { roots: number; bytes: number; milliseconds: number; databaseRows?: number; familySessions?: number };
type FamilyBudget = { valid: boolean; rows: number; databaseBytes: number; fileBytes: number };
function summarize(report: CostReport): Family {
  const models = new Map<string, Statistics["models"][number]>();
  for (const row of report.rows) {
    const key = JSON.stringify([row.provider, row.model]), previous = models.get(key);
    models.set(key, { provider: row.provider, model: row.model, total: sumCosts(previous ? [previous.total, row] : [row]) });
  }
  const providers = [...new Set(report.rows.map(row => row.provider))].map(provider => {
    const rows = report.rows.filter(row => row.provider === provider);
    return { provider, total: sumCosts(rows), categories: costCategories.map(category => ({ category, total: sumCosts(rows.filter(row => row.category === category)) })) };
  });
  return { total: sumCosts(report.rows), models: [...models.values()], providers, warnings: report.warnings,
    categories: costCategories.map(category => ({ category, total: sumCosts(report.rows.filter(row => row.category === category)) })) };
}
/** On-demand, bounded statistics over retained, active root-session families. Never add child reports again. */
export class ModelUsageStatistics {
  private cache = new Lru<string, { version: string; value: Family }>(512);
  private pending = new Map<string, Promise<Statistics>>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly store: Store, private readonly costs: Costs,
    private readonly limits: ScanLimits = { roots: 1000, bytes: 32 * 1024 * 1024, milliseconds: 3000 }) {}
  read(workspaceId?: string): Promise<Statistics> {
    if (workspaceId && !this.store.db.prepare("SELECT 1 FROM workspaces WHERE id=? AND archived=0").get(workspaceId))
      throw new AppError("NOT_FOUND", "工作空间不存在");
    const key = workspaceId ?? "*", existing = this.pending.get(key);
    if (existing) return existing;
    const result = this.tail.then(() => this.scan(workspaceId));
    this.tail = result.catch(() => {});
    this.pending.set(key, result);
    void result.finally(() => { if (this.pending.get(key) === result) this.pending.delete(key); }).catch(() => {});
    return result;
  }
  /** Inspect all materialized columns, returning only numeric sizes and capped identifiers/paths. */
  private familyBudget(scope: Scope, budget: FamilyBudget, remainingRows: number, remainingBytes: number,
    expressions: Map<string, string>, hasMemory: boolean) {
    const sessionLimit = this.limits.familySessions ?? 512;
    const size = (columns: string[]) => columns.map(name => `coalesce(length(CAST("${name.replaceAll('"', '""')}" AS BLOB)),0)`).join("+") || "0";
    const read = (table: string, where: string, parameters: (string | number)[], options: { fields?: string; columns?: string[]; limit?: number; multiplier?: number } = {}) => {
      const limit = Math.min(remainingRows - budget.rows, options.limit ?? Infinity);
      if (limit <= 0 || budget.databaseBytes > remainingBytes) return;
      if (!expressions.has(table)) expressions.set(table, size(this.store.db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name))));
      const rows = this.store.db.prepare(`SELECT ${options.fields ? options.fields + "," : ""}${options.columns ? size(options.columns) : expressions.get(table)} AS bytes FROM ${table} WHERE ${where} LIMIT ?`)
        .all(...parameters, limit);
      // Charge failed/rejected preflights too, including a later SQL/stat exception.
      budget.rows += rows.length;
      budget.databaseBytes += rows.reduce((sum, row) => sum + Number(row.bytes ?? 0), 0) * (options.multiplier ?? 4);
      // At a full LIMIT, conservatively skip instead of reading an extra sentinel beyond the global budget.
      if (rows.length === limit || budget.databaseBytes > remainingBytes) return;
      return rows;
    };
    const workspace = read("workspaces", "id=?", [scope.workspaceId], { multiplier: 16 });
    if (!workspace?.length) return;
    const children = read("tasks", "workspaceId=? AND parentSessionId=?", [scope.workspaceId, scope.sessionId], {
      columns: ["id", "sessionId", "title", "status"], limit: sessionLimit,
      fields: "CASE WHEN length(CAST(sessionId AS BLOB))<=160 THEN sessionId END AS sessionId",
    });
    if (!children || children.some(row => !row.sessionId)) return;
    const ids = [scope.sessionId, ...children.map(row => String(row.sessionId))], slots = ids.map(() => "?").join(",");
    // get() reads the workspace per transcript and session metadata several times through owner/version.
    budget.databaseBytes += Number(workspace[0].bytes) * 4 * children.length;
    if (!read("sessions", `id IN (${slots})`, ids, { multiplier: 16 })) return;
    const metadata = read("agent_sessions", `sessionId IN (${slots})`, ids, { columns: ["file", "usage"],
      fields: "CASE WHEN length(CAST(file AS BLOB))<=4096 THEN file END AS file,length(CAST(file AS BLOB))>4096 AS invalidPath" });
    if (!metadata || metadata.some(row => row.invalidPath)) return;
    for (const row of metadata) {
      try { if (row.file) budget.fileBytes += statSync(String(row.file)).size; } catch { /* Costs reports unreadable history as unknown. */ }
    }
    for (const table of hasMemory ? ["compressions", "memory_usage"] : ["compressions"]) {
      if (!read(table, `sessionId IN (${slots})`, ids, table === "compressions" ? { columns: ["id", "body"] } : {})) return;
    }
    budget.valid = true;
  }
  private async scan(workspaceId?: string): Promise<Statistics> {
    const started = performance.now();
    const workspaces = this.store.db.prepare("SELECT id,substr(name,1,1024) AS name FROM workspaces WHERE archived=0 AND length(CAST(id AS BLOB))<=160 ORDER BY rowid LIMIT 1001").all()
      .map(row => ({ id: String(row.id), name: String(row.name) }));
    const base = `FROM sessions s JOIN workspaces w ON w.id=s.workspaceId WHERE w.archived=0 AND s.deletedAt IS NULL
      AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.workspaceId=s.workspaceId AND t.sessionId=s.id)
      ${workspaceId ? "AND s.workspaceId=?" : ""}`;
    const parameters = workspaceId ? [workspaceId] : [];
    const totalRoots = Number(this.store.db.prepare(`SELECT count(*) AS count ${base}`).get(...parameters)!.count);
    const roots = this.store.db.prepare(`SELECT CASE WHEN length(CAST(s.workspaceId AS BLOB))<=160 THEN s.workspaceId END AS workspaceId,
      CASE WHEN length(CAST(s.id AS BLOB))<=160 THEN s.id END AS id,substr(w.name,1,1024) AS workspaceName ${base} ORDER BY s.workspaceId,s.id LIMIT ?`)
      .all(...parameters, this.limits.roots);
    const hasMemory = !!this.store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_usage'").get();
    const models = new Map<string, Statistics["models"][number]>(), categories = new Map<CostCategory, CostTotals>();
    const byWorkspace = new Map<string, Statistics["byWorkspace"][number]>(), totals: CostTotals[] = [], warnings = new Set<string>();
    const providers = new Map<string | null, Statistics["providers"][number]>();
    const expressions = new Map<string, string>();
    let scannedRoots = 0, bytes = 0, databaseRows = 0, changed = false;
    if (workspaces.length > 1000) { workspaces.length = 1000; warnings.add("项目筛选列表仅显示前 1000 个未归档项目；累计统计仍按当前范围扫描。"); }
    for (let index = 0; index < roots.length; index++) {
      // Yield before the body: rejected families must not bypass event-loop fairness.
      if (index > 0 && index % 4 === 0) await yieldTurn();
      if (performance.now() - started > this.limits.milliseconds || databaseRows >= (this.limits.databaseRows ?? 5000) || bytes >= this.limits.bytes) break;
      if (!roots[index].workspaceId || !roots[index].id) continue;
      const scope = { workspaceId: String(roots[index].workspaceId), sessionId: String(roots[index].id) }, key = JSON.stringify(scope);
      let value: Family;
      try {
        const budget: FamilyBudget = { valid: false, rows: 0, databaseBytes: 0, fileBytes: 0 };
        try { this.familyBudget(scope, budget, (this.limits.databaseRows ?? 5000) - databaseRows, this.limits.bytes - bytes, expressions, hasMemory); }
        finally { databaseRows += budget.rows; bytes += budget.databaseBytes; }
        if (!budget.valid) continue;
        if (performance.now() - started > this.limits.milliseconds) break;
        const version = this.costs.version(scope), cached = this.cache.get(key);
        if (cached?.version === version) value = cached.value;
        else {
          if (bytes + budget.fileBytes > this.limits.bytes) continue;
          bytes += budget.fileBytes;
          value = summarize(this.costs.get(scope));
          if (this.costs.version(scope) === version) this.cache.set(key, { version, value });
          else changed = true;
        }
      } catch {
        // A concurrently removed session or malformed source must not hide other families.
        warnings.add("部分会话的用量记录无法核对，未计入统计；请刷新重试。");
        continue;
      }
      scannedRoots++;
      totals.push(value.total);
      for (const warning of value.warnings) { if (warnings.size < 30) warnings.add(warning); }
      for (const row of value.models) {
        const id = JSON.stringify([row.provider, row.model]), previous = models.get(id);
        models.set(id, { ...row, total: sumCosts(previous ? [previous.total, row.total] : [row.total]) });
      }
      for (const row of value.categories) categories.set(row.category, sumCosts([categories.get(row.category), row.total].filter((v): v is CostTotals => !!v)));
      for (const row of value.providers) {
        const current = providers.get(row.provider) ?? { provider: row.provider, total: sumCosts([]), categories: costCategories.map(category => ({ category, total: sumCosts([]) })), byWorkspace: [] };
        current.total = sumCosts([current.total, row.total]);
        current.categories = current.categories.map(item => ({ ...item, total: sumCosts([item.total, row.categories.find(c => c.category === item.category)!.total]) }));
        const previous = current.byWorkspace.find(item => item.id === scope.workspaceId);
        if (previous) { previous.total = sumCosts([previous.total, row.total]); previous.roots++; }
        else current.byWorkspace.push({ id: scope.workspaceId, name: String(roots[index].workspaceName), roots: 1, total: sumCosts([row.total]) });
        providers.set(row.provider, current);
      }
      const previous = byWorkspace.get(scope.workspaceId);
      byWorkspace.set(scope.workspaceId, { id: scope.workspaceId, name: String(roots[index].workspaceName),
        roots: (previous?.roots ?? 0) + 1, total: sumCosts(previous ? [previous.total, value.total] : [value.total]) });
      // SQLite statements and one file parse remain synchronous: time is a soft, not hard real-time, budget.
    }
    const partial = scannedRoots < totalRoots || changed;
    if (scannedRoots < totalRoots) warnings.add(`当前已统计 ${scannedRoots} / ${totalRoots} 个主会话家族；其余记录未计入，可能受扫描预算或源记录异常影响。可按项目缩小范围。`);
    if (changed) warnings.add("统计期间部分用量仍在更新，当前不是原子账单快照；请刷新核对。");
    return { updatedAt: Date.now(), total: sumCosts(totals), models: [...models.values()].sort((a, b) => b.total.knownCost - a.total.knownCost),
      categories: costCategories.map(category => ({ category, total: categories.get(category) ?? sumCosts([]) })), providers: [...providers.values()], workspaces,
      byWorkspace: [...byWorkspace.values()], totalRoots, scannedRoots, partial, warnings: [...warnings] };
  }
}
