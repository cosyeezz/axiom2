import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { costCategories, emptyCostTotals, sumCosts } from "../shared/costs.js";
import type { ModelUsageStatistics, UsageBackground, UsageRecordFilter, UsageRecordPage } from "../shared/model-usage.js";
import { AppError } from "../shared/protocol.js";
import { ModelUsageLedger, usageRecordFilter } from "./model-usage-ledger.js";
import { UsageMaterializedStore, type PublicationMeta, type UsageView, type UsageViewValue, type UsageSubject } from "./usage-materialized-store.js";

export type UsageSidecarOptions = { pollMs?: number; cooldownMs?: number; pauseMs?: number; initialDelayMs?: number };
export function usageView(input: unknown, kind: UsageView["kind"] = "ledger"): UsageView {
  const { snapshot: _snapshot, refresh: _refresh, continue: _continue, ...params } = usageRecordFilter(input);
  if (!params.query) delete params.query;
  if (!params.analytics) { delete params.analytics; delete params.timeZone; }
  else params.timeZone ??= "UTC";
  const scope = JSON.stringify(params.workspaceId ?? null);
  return { key: JSON.stringify([kind, params]), scope, kind, params };
}
export function emptyUsagePage(input: unknown = {}, state: UsageBackground["state"] = "preparing"): UsageRecordPage {
  const params = usageRecordFilter(input);
  return { rows: [], count: 0, total: emptyCostTotals(), page: params.page!, pageSize: params.pageSize!, snapshot: "pending", updatedAt: 0,
    scannedRoots: 0, totalRoots: 0, processedRoots: 0, building: true, partial: true, warnings: [], providers: [],
    background: { state, verifiedThrough: 0, ...(state === "error" ? { message: "后台统计暂不可用，将自动重试。" } : {}) } };
}
export function emptyUsageStatistics(state: UsageBackground["state"] = "preparing"): ModelUsageStatistics {
  return { updatedAt: 0, total: emptyCostTotals(), models: [], providers: [], categories: costCategories.map(category => ({ category, total: emptyCostTotals() })),
    workspaces: [], byWorkspace: [], scannedRoots: 0, totalRoots: 0, partial: true, warnings: [], background: { state, verifiedThrough: 0 } };
}
/** Runs only in the low-priority child. Reads return persisted views; all derivation runs in tick(). */
export class UsageSidecarEngine {
  readonly source: DatabaseSync;
  readonly materialized: UsageMaterializedStore;
  private readonly ledger: ModelUsageLedger;
  private readonly options: Required<UsageSidecarOptions>;
  private wanted = new Map<string, number>();
  private dirty = new Set<string>();
  private building = new Set<string>();
  private requested = false;
  private attempted = new Map<string, number>();
  private failures = new Map<string, { message: string; retryAt: number; count: number }>();
  private viewFailures = new Map<string, { message: string; retryAt: number; count: number; generation: string }>();
  private signatures = new Map<string, { version: number; selector: string; value: string }>();
  private fileStamps = new Map<string, string>();
  private sourceVersion = -1;
  private lastWatch = 0;
  private fileOffset = 0;
  private running?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private started = false;
  private controller = new AbortController();
  constructor(root: string, private readonly modelsDir: string, options: UsageSidecarOptions = {}) {
    this.options = { pollMs: options.pollMs ?? 10_000, cooldownMs: options.cooldownMs ?? 30_000, pauseMs: options.pauseMs ?? 50, initialDelayMs: options.initialDelayMs ?? 1000 };
    this.source = new DatabaseSync(join(root, "axiom.sqlite"), { readOnly: true });
    this.source.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=0");
    try { this.materialized = new UsageMaterializedStore(join(root, "cache", "usage", "v1.sqlite")); }
    catch (error) { this.source.close(); throw error; }
    this.ledger = new ModelUsageLedger({ db: this.source }, modelsDir, { bytes: 256 * 1024, indexBytes: 32 * 1024 * 1024, databaseRows: 250, milliseconds: 15 });
    this.touch(JSON.stringify(null));
    // Prepare the common first page independently of whether the dashboard is open.
    this.materialized.register(usageView({ analytics: true, timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone }));
  }
  start() { if (!this.started && !this.closed) { this.started = true; this.wake(this.options.initialDelayMs); } }
  private wake(delay = 0) {
    if (!this.started || this.closed || this.running) return;
    if (this.timer) { if (delay) return; clearTimeout(this.timer); }
    this.timer = setTimeout(() => { this.timer = undefined; void this.tick().catch(() => {}).finally(() => this.wake(this.requested ? 0 : this.options.pollMs)); }, delay);
    this.timer.unref();
  }
  private touch(scope: string) {
    this.wanted.delete(scope); this.wanted.set(scope, Date.now());
    while (this.wanted.size > 2) {
      const oldest = this.wanted.keys().next().value!; this.wanted.delete(oldest); this.dirty.delete(oldest);
      this.failures.delete(oldest); this.attempted.delete(oldest); this.signatures.delete(oldest);
    }
  }
  private workspace(scope: string): string | undefined { return JSON.parse(scope) ?? undefined; }
  private version() { return Number(this.source.prepare("PRAGMA data_version").get()!.data_version); }
  private subjects(subjects: UsageSubject[]) {
    if (!subjects.length) return [];
    const rows = this.source.prepare(`SELECT s.id,s.workspaceId,s.deletedAt,w.archived,t.parentSessionId FROM sessions s JOIN workspaces w ON w.id=s.workspaceId
      LEFT JOIN tasks t ON t.sessionId=s.id AND t.workspaceId=s.workspaceId WHERE s.id IN(SELECT value FROM json_each(?)) ORDER BY s.id,t.parentSessionId LIMIT 40001`)
      .all(JSON.stringify(subjects.map(subject => subject[0])));
    if (rows.length > 40000) throw Error("usage visibility exceeds budget");
    return rows;
  }
  private visibility(scope: string, subjects: UsageSubject[] = []): string {
    const version = this.version(), selector = JSON.stringify(subjects), cached = this.signatures.get(scope);
    if (cached?.version === version && cached.selector === selector) return cached.value;
    const workspace = this.workspace(scope), args = workspace ? [workspace] : [];
    const base = `FROM sessions s JOIN workspaces w ON w.id=s.workspaceId WHERE w.archived=0 AND s.deletedAt IS NULL
      AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.workspaceId=s.workspaceId AND t.sessionId=s.id) ${workspace ? "AND w.id=?" : ""}`;
    const roots = this.source.prepare(`SELECT s.id,s.workspaceId,s.forkParentSessionId,substr(s.title,1,160) AS title,substr(w.name,1,160) AS name,substr(w.path,1,4096) AS path
      ${base} ORDER BY s.forkParentSessionId IS NOT NULL,w.id,s.id LIMIT 1000`).all(...args);
    const value = createHash("sha256").update(JSON.stringify([roots, this.subjects(subjects)])).digest("hex");
    this.signatures.set(scope, { version, selector, value }); return value;
  }
  private eligible(params: UsageRecordFilter) {
    if (params.workspaceId && !this.source.prepare("SELECT 1 FROM workspaces WHERE id=? AND archived=0").get(params.workspaceId))
      throw new AppError("NOT_FOUND", "工作空间不存在或已归档。");
    if (params.rootSessionId && !this.source.prepare(`SELECT 1 FROM sessions s JOIN workspaces w ON w.id=s.workspaceId WHERE s.id=? AND s.deletedAt IS NULL AND w.archived=0
      AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.workspaceId=s.workspaceId AND t.sessionId=s.id) ${params.workspaceId ? "AND w.id=?" : ""}`)
      .get(params.rootSessionId, ...(params.workspaceId ? [params.workspaceId] : []))) throw new AppError("NOT_FOUND", "会话不存在、已删除或不在所选工作空间。");
  }
  read(input: unknown = {}, kind: UsageView["kind"] = "ledger"): UsageViewValue {
    const params = usageRecordFilter(input); this.eligible(params);
    const view = usageView(params, kind); this.touch(view.scope); this.materialized.register(view);
    const meta = this.materialized.head(view.scope), visibility = this.visibility(view.scope, meta?.subjects), cached = this.materialized.cached(view.key);
    if (params.refresh || !meta || meta.visibility !== visibility) this.dirty.add(view.scope);
    const valid = cached?.visibility === visibility;
    if (!valid || cached?.generation !== meta?.id) { this.requested = true; this.wake(); }
    if (this.dirty.has(view.scope)) this.wake();
    const viewFailure = this.viewFailures.get(view.key);
    const failure = (viewFailure?.generation === meta?.id ? viewFailure : undefined) ?? this.failures.get(view.scope);
    const updating = this.dirty.has(view.scope) || this.building.has(view.scope) || !!failure || !valid || cached?.generation !== meta?.id;
    if (!valid) return kind === "ledger" ? emptyUsagePage(params, failure ? "error" : "preparing") : emptyUsageStatistics(failure ? "error" : "preparing");
    if (kind === "ledger" && params.page! > 1 && params.snapshot && params.snapshot !== (cached!.value as UsageRecordPage).snapshot)
      return this.read({ ...params, page: 1, snapshot: undefined, refresh: false }, kind);
    const result = cached!.value;
    result.background = { state: failure ? "error" : updating ? "updating" : "ready", verifiedThrough: result.updatedAt,
      ...(cached?.generation === meta?.id ? { publishedAt: meta!.publishedAt } : {}), ...(failure ? { message: failure.message } : {}) };
    return result;
  }
  tick(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.running) return this.running;
    this.requested = false;
    const run = this.update(); this.running = run;
    void run.finally(() => { if (this.running === run) this.running = undefined; }).catch(() => {});
    return run;
  }
  private async pause() { if (this.closed) throw Error("usage sidecar closed"); await sleep(this.options.pauseMs, undefined, { signal: this.controller.signal }); }
  private async watch() {
    const now = Date.now(); if (now - this.lastWatch < this.options.pollMs) return;
    this.lastWatch = now;
    const version = this.version(); let changed = version !== this.sourceVersion; this.sourceVersion = version;
    // Bounded rotating stat checks detect append/replacement even without a source-DB update.
    const files = this.source.prepare(`SELECT substr(a.file,1,4096) AS file FROM agent_sessions a JOIN sessions s ON s.id=a.sessionId JOIN workspaces w ON w.id=s.workspaceId
      WHERE w.archived=0 AND s.deletedAt IS NULL AND a.file IS NOT NULL ORDER BY a.sessionId LIMIT 128 OFFSET ?`).all(this.fileOffset);
    this.fileOffset = files.length < 128 || this.fileOffset >= 10_000 ? 0 : this.fileOffset + 128;
    for (let index = 0; index < files.length; index++) {
      const file = String(files[index].file); let stamp = "missing";
      try { const info = await stat(file, { bigint: true }); stamp = `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`; } catch { /* Deletion also invalidates. */ }
      if (this.fileStamps.get(file) !== stamp) { changed = true; this.fileStamps.delete(file); this.fileStamps.set(file, stamp); }
      while (this.fileStamps.size > 4096) this.fileStamps.delete(this.fileStamps.keys().next().value!);
      if (index % 16 === 15) await this.pause();
    }
    for (const file of [join(this.modelsDir, "models.json"), join(this.modelsDir, "auth.json")]) {
      let stamp = "missing"; try { const value = await stat(file, { bigint: true }); stamp = `${value.ino}:${value.size}:${value.mtimeNs}`; } catch { /* No configuration. */ }
      if (this.fileStamps.get(file) !== stamp) { changed = true; this.fileStamps.set(file, stamp); }
    }
    for (const scope of this.wanted.keys()) {
      const meta = this.materialized.head(scope);
      if (changed || !meta || now - meta.publishedAt >= 5 * 60_000) this.dirty.add(scope);
    }
  }
  private async update() {
    while (!this.closed && this.materialized.cleanup()) await this.pause();
    try { await this.watch(); }
    catch { for (const scope of this.wanted.keys()) this.fail(scope); return; }
    for (const scope of [...this.wanted.keys()]) {
      if (this.closed) return;
      try {
        const retry = this.failures.get(scope), now = Date.now();
        if (retry && now < retry.retryAt) continue;
        if (this.dirty.has(scope) && now - (this.attempted.get(scope) ?? -Infinity) >= this.options.cooldownMs) {
          this.attempted.set(scope, now); this.dirty.delete(scope);
          this.building.add(scope);
          try { await this.rebuild(scope); this.failures.delete(scope); }
          catch (error) { this.dirty.add(scope); throw error; }
          finally { this.building.delete(scope); }
        }
        const meta = this.materialized.head(scope); if (!meta) continue;
        for (const view of this.materialized.views(scope)) {
          if (this.closed) return;
          if (this.materialized.prepared(view.key, meta.id)) continue;
          const failed = this.viewFailures.get(view.key);
          if (failed?.generation === meta.id && Date.now() < failed.retryAt) continue;
          try {
            const publication = this.materialized.publication(scope, meta);
            const result = view.kind === "ledger" ? this.ledger.queryPublished(view.params, publication) : this.statistics(meta);
            this.materialized.save(view, meta, result); this.viewFailures.delete(view.key);
          } catch {
            const count = (failed?.count ?? 0) + 1;
            this.viewFailures.delete(view.key);
            this.viewFailures.set(view.key, { count, generation: meta.id, message: "此统计视图暂不可用，将自动重试。", retryAt: Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(count, 6)) });
            while (this.viewFailures.size > 32) this.viewFailures.delete(this.viewFailures.keys().next().value!);
          }
          await this.pause();
        }
        if (!this.dirty.has(scope)) this.failures.delete(scope);
      } catch { if (!this.closed) this.fail(scope); }
    }
    while (!this.closed && this.materialized.cleanup()) await this.pause();
  }
  private fail(scope: string) {
    const count = (this.failures.get(scope)?.count ?? 0) + 1;
    this.failures.set(scope, { count, message: "后台统计暂不可用，将自动重试。", retryAt: Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(count, 6)) });
  }
  private async rebuild(scope: string) {
    const workspaceId = this.workspace(scope), started = Date.now(), visibility = this.visibility(scope);
    let page = await this.ledger.read({ workspaceId, pageSize: 100, refresh: true });
    while (page.building) { await this.pause(); page = await this.ledger.read({ workspaceId, pageSize: 100, continue: true }); }
    const stage = this.materialized.begin(scope);
    try {
      let complete = true;
      const owners = new Map<string, UsageSubject>();
      for (let index = 1; index <= Math.max(1, Math.ceil(page.count / 100)); index++) {
        if (index > 1) page = await this.ledger.read({ workspaceId, page: index, pageSize: 100, snapshot: page.snapshot });
        for (const row of page.rows) owners.set(row.sessionId, [row.sessionId, row.workspaceId, row.rootSessionId]);
        if (!this.materialized.append(stage, page.rows)) { complete = false; break; }
        await this.pause();
      }
      const subjects = [...owners.values()].sort((a, b) => a[0].localeCompare(b[0]));
      let verifiedVisibility: string;
      // Only short metadata checks share this read transaction: no file reads, writes or sleeps.
      // Eligibility and the published manifest must describe the SAME source snapshot.
      this.source.exec("BEGIN");
      try {
        this.signatures.delete(scope);
        if (visibility !== this.visibility(scope)) throw Error("usage visibility changed while building");
        const eligible = new Set(this.subjects(subjects).filter(row => row.deletedAt === null && row.archived === 0).map(row => JSON.stringify([row.id, row.workspaceId, row.parentSessionId ?? row.id])));
        if (subjects.some(subject => !eligible.has(JSON.stringify(subject)))) throw Error("usage subjects changed while building");
        verifiedVisibility = this.visibility(scope, subjects); this.source.exec("COMMIT");
      } catch (error) { this.source.exec("ROLLBACK"); throw error; }
      const meta: PublicationMeta = { id: stage.id, updatedAt: started, publishedAt: Date.now(), visibility: verifiedVisibility, subjects, building: false,
        scannedRoots: page.scannedRoots, processedRoots: page.processedRoots ?? page.scannedRoots, totalRoots: page.totalRoots,
        partial: page.partial || !complete, warnings: [...page.warnings, ...(!complete ? ["后台账务达到存储预算，仅显示已核对记录。"] : [])] };
      this.materialized.publish(stage, meta);
    } catch (error) { this.materialized.discard(stage); throw error; }
  }
  private statistics(meta: PublicationMeta): ModelUsageStatistics {
    const result: ModelUsageStatistics = { ...emptyUsageStatistics(), updatedAt: meta.updatedAt, partial: meta.partial, warnings: [...meta.warnings],
      scannedRoots: meta.scannedRoots, totalRoots: meta.totalRoots, workspaces: this.ledger.workspaces() };
    delete result.background;
    const roots = new Map<string, Set<string>>(), providerRoots = new Map<string, Set<string>>();
    const models = new Map<string, ModelUsageStatistics["models"][number]>(), workspaces = new Map<string, ModelUsageStatistics["byWorkspace"][number]>();
    const providers = new Map<string | null, ModelUsageStatistics["providers"][number]>(), providerWorkspaces = new Map<string, ModelUsageStatistics["byWorkspace"][number]>();
    for (const row of this.materialized.rows()) {
      result.total = sumCosts([result.total, row]);
      const modelKey = JSON.stringify([row.provider, row.model]); let model = models.get(modelKey);
      if (!model) { model = { provider: row.provider, model: row.model, ...(row.name ? { name: row.name } : {}), total: emptyCostTotals() }; models.set(modelKey, model); result.models.push(model); }
      model.total = sumCosts([model.total, row]);
      const category = result.categories.find(item => item.category === row.category)!; category.total = sumCosts([category.total, row]);
      let workspace = workspaces.get(row.workspaceId);
      if (!workspace) { workspace = { id: row.workspaceId, name: row.workspaceName, roots: 0, total: emptyCostTotals() }; workspaces.set(row.workspaceId, workspace); result.byWorkspace.push(workspace); }
      workspace.total = sumCosts([workspace.total, row]);
      const ids = roots.get(row.workspaceId) ?? new Set<string>(); ids.add(row.rootSessionId); roots.set(row.workspaceId, ids); workspace.roots = ids.size;
      let provider = providers.get(row.provider);
      if (!provider) { provider = { provider: row.provider, total: emptyCostTotals(), byWorkspace: [], categories: costCategories.map(category => ({ category, total: emptyCostTotals() })) }; providers.set(row.provider, provider); result.providers.push(provider); }
      provider.total = sumCosts([provider.total, row]);
      const byCategory = provider.categories.find(item => item.category === row.category)!; byCategory.total = sumCosts([byCategory.total, row]);
      const key = JSON.stringify([row.provider, row.workspaceId]); let byWorkspace = providerWorkspaces.get(key);
      if (!byWorkspace) { byWorkspace = { id: row.workspaceId, name: row.workspaceName, roots: 0, total: emptyCostTotals() }; providerWorkspaces.set(key, byWorkspace); provider.byWorkspace.push(byWorkspace); }
      byWorkspace.total = sumCosts([byWorkspace.total, row]);
      const included = providerRoots.get(key) ?? new Set<string>();
      included.add(row.rootSessionId); providerRoots.set(key, included); byWorkspace.roots = included.size;
    }
    result.models.sort((a, b) => b.total.knownCost - a.total.knownCost); return result;
  }
  async close() {
    this.closed = true; clearTimeout(this.timer); this.controller.abort();
    await this.running?.catch(() => {}); await this.ledger.close(); this.materialized.close(); this.source.close();
  }
}
