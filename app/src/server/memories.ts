import { ProcessingRecords } from "./processing-records.js";
import { processingScope, type ProcessingContext } from "../shared/processing.js";
import { MemoryPipeline } from "./memory-pipeline.js";
import { emptyMemoryTree, memoryTopicBlock, memoryTreeScope, type MemoryTopicSnapshot } from "../shared/memory-tree.js";
import { thinkingLevels } from "../shared/agent.js";
import type { LeaseRef } from "./execution-protocol.js";
import { statSync, lstatSync, mkdirSync, watch, existsSync, type FSWatcher } from "node:fs";
import { join, resolve, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type { Store } from "./storage.js";
import type { Selection } from "../shared/agent.js";
import { AppError, object, text, type Scope, type Command } from "../shared/protocol.js";
import { emptyMemoryView, emptyMemoryDocument, memoryScope, memoryCatalogScope, memoryExcerpt, parseMemory, type MemoryView, type MemoryCatalogEntry, type MemoryDocument, type MemoryQueryResult, type MemoryReason } from "../shared/memory.js";
import { guardMemoryWrite } from "./memory-write-guard.js";
import { memoryPurposes } from "../shared/memory-purposes.js";
import { MemoryValidationError } from "../shared/memory-detail-paths.js";
import { digest, memoryDirectory, memoryFiles, memoryPath, MemoryLinkCache, MemoryReadEvidence, MemoryTextCache, textFile, referencedPaths, within, readMemoryBytes, readMemoryTextSnapshot, replaceMemoryFile } from "./memory-files.js";
import { memoryRoot, legacyMemoryRoot } from "./memory-storage.js";
import { realpathSync } from "node:fs";
import { openMemoryFile, type OpenMemoryFile } from "./memory-open.js";

import { defaultMemoryPreferences, memoryBudgetLimits, memoryIncompleteMessages, type MemoryPreferences, type MemoryExecutionResult } from "../shared/memory.js";
export { defaultMemoryPreferences, type MemoryPreferences } from "../shared/memory.js";
export interface MemoryExecution {
  processingId?: string; processingCallId?: string;
  scope: Scope; selection: Selection; prompt: string; systemPrompt?: string; signal?: AbortSignal; parentLease?: LeaseRef;
  /** A caller-owned total deadline. Runners consume only the remaining time. */
  deadlineAt?: number;
  /** Organizer-only document allowance after charging its prompt. Queries have no read budget. */
  readChars?: number;
  read: (sessionId: string, path: string, offset?: number, limit?: number, options?: { includeImage?: boolean }) => MemoryDocument;
  /** 仅探测原始字节修订，供执行器在结束前验证实际读取的依据。 */
  revision?: (sessionId: string, path: string) => string;
  kind: "query" | "organize" | "title";
}
export interface MemoryRunner { execute(input: MemoryExecution): Promise<MemoryExecutionResult>; stopProviders?(providers: string[], confirmed: boolean): Promise<void>; close(): Promise<void> }
/** 持久目录的内部字段不属于前端目录协议。 */
type StoredMemoryCatalogEntry = MemoryCatalogEntry & {
  sourceTitle?: string;
  treeVersion?: number;
  summaryVersion?: number;
  dependencies?: { sessionId: string; path: string; revision: string }[];
};
type ScanWorkerResult = { kind: "scan"; files: MemoryView["files"]; entry: string };
type OrganizationWork = { controller: AbortController; done?: Promise<void>; active?: { workspaceId: string; processingId: string; purposeIds: string[]; sessionIds: string[] } };
export class Memories {
  private timer: ReturnType<typeof setInterval>;
  private watcher?: FSWatcher;
  private scanner?: Worker;
  private scanRequest = 0;
  private scanRequests = new Map<number, { resolve: (value: ScanWorkerResult) => void; reject: (reason: Error) => void }>();
  private queuedScopes = new Map<string, Scope>();
  private queueAll = false;
  private scanTask?: Promise<void>;
  private scanDelay?: ReturnType<typeof setTimeout>;
  private lastSafetySweep = 0;
  private cachedViews = new Map<string, MemoryView>();
  private generations = new Map<string, number>();
  private completedGenerations = new Map<string, number>();
  private scanWaiters = new Map<string, Map<number, Set<{ resolve: () => void; reject: (error: Error) => void }>>>();
  private scannerRetry?: ReturnType<typeof setTimeout>;
  private organizationWork?: OrganizationWork;
  private organizerScheduled?: ReturnType<typeof setImmediate>;
  private closed = false;
  private controller = new AbortController();
  runner?: MemoryRunner;
  private opening = false;
  readonly records: ProcessingRecords;
  readonly pipeline: MemoryPipeline;
  private stopRecordObservation: () => void;
  tree(workspaceId: string) {
    this.organizationOwner(workspaceId);
    const active = this.organizationWork?.active, batch = active?.workspaceId === workspaceId ? active : undefined;
    return { ...this.pipeline.tree.tree(workspaceId, Date.now(), batch?.purposeIds),
      ...(batch ? { activeBatch: { processingId: batch.processingId, purposeIds: batch.purposeIds, sessionIds: batch.sessionIds } } : {}) };
  }
  topicSnapshot(workspaceId: string): MemoryTopicSnapshot {
    return { version: 2, workspaceId, text: memoryTopicBlock(this.tree(workspaceId).roots) };
  }
  publishTree(workspaceId: string) {
    // Revocation can happen while a model is in flight. Clear subscribers rather
    // than throwing from failure handling or exposing an unauthorized snapshot.
    this.publish(memoryTreeScope(workspaceId), this.store.workspace(workspaceId).authorized ? this.tree(workspaceId) : emptyMemoryTree());
    // The catalog projects classification errors too; update it with the tree
    // so failures and successful retries do not require reopening the page.
    this.publishCatalog(workspaceId);
  }
  constructor(
    readonly store: Store,
    readonly publish: (scope: string, data?: unknown) => void,
    private readonly openFile: OpenMemoryFile = openMemoryFile,
    private readonly replaceFile: typeof replaceMemoryFile = replaceMemoryFile,
    // 仅供旧测试注入受控读取；纠正实际使用单次原始字节快照，不能将旧正文与新 CAS 混用。
    readCorrectionFile: typeof textFile = textFile,
    // 发布层准确知道当前 scope 是否有订阅者；无订阅时仍维护缓存和持久目录。
    private readonly observed: (scope: string) => boolean = () => true,
    private readonly readCorrectionSnapshot: typeof readMemoryTextSnapshot = readMemoryTextSnapshot,
  ) {
    // 保留旧注入位置，避免集成方构造参数错位；纠正流程已改用原子快照。
    void readCorrectionFile;
    store.db.exec(`CREATE TABLE IF NOT EXISTS memory_sources(sessionId TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,revision TEXT NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_preferences(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_corrections(id TEXT PRIMARY KEY,workspaceId TEXT NOT NULL,target TEXT NOT NULL,createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_usage(id TEXT PRIMARY KEY,sessionId TEXT NOT NULL,kind TEXT NOT NULL,provider TEXT,model TEXT,usage TEXT,createdAt INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS memory_usage_session ON memory_usage(sessionId);`);
    this.records = ProcessingRecords.for(store);
    this.stopRecordObservation = this.records.observe(workspaceId => {
      if (this.closed) return;
      let data: unknown = null;
      try { data = this.records.invalidation(workspaceId); } catch { /* Revocation clears shared client caches. */ }
      this.publish(processingScope(workspaceId), data);
    });
    this.pipeline = new MemoryPipeline(this);
    const root = memoryRoot(store.root);
    try { mkdirSync(root, { recursive: true, mode: 0o700 }); }
    catch { /* Memory storage is optional; background reads can retry later. */ }
    // Store alone initializes entries. Reads never recreate missing memory.
    this.lastSafetySweep = Date.now();
    this.startScanner();
    this.watchSources(root);
    // 首次目录读取可能包含大量资料；后台扫描完成前不占用服务事件循环。
    this.scheduleScan();
    this.timer = setInterval(() => {
      // 监视器覆盖受管理目录。外部引用不一定在该目录下，因此保留低频校验。
      if (Date.now() - this.lastSafetySweep >= 60_000) {
        this.lastSafetySweep = Date.now();
        this.scheduleScan();
      }
      // Fallback for runner availability and bounded failure retries, not a
      // waiting period for newly completed or revised sources.
      this.scheduleOrganization();
    }, 1500);
    this.timer.unref();
  }

  private startScanner() {
    if (this.closed || this.scanner) return;
    try {
      // tsx 开发模式需要 .ts 入口，发布产物则由 tsc 输出同名 .js 文件。
      const source = import.meta.url.endsWith(".ts");
      const workerUrl = new URL(source ? "./memory-scan-worker.ts" : "./memory-scan-worker.js", import.meta.url);
      // Older supported Node versions do not register inherited tsx hooks in
      // worker threads. Bootstrap the hook inside this worker before importing.
      const entry = source ? new URL(`data:text/javascript,${encodeURIComponent(
        `import { register } from ${JSON.stringify(import.meta.resolve("tsx/esm/api"))}; register(); await import(${JSON.stringify(workerUrl.href)});`,
      )}`) : workerUrl;
      // --input-type only applies to node -e/STDIN, not file workers.
      const inherited = process.execArgv;
      const execArgv = inherited.some((value) => value.startsWith("--input-type"))
        ? inherited.filter((value) => !value.startsWith("--input-type"))
        : undefined;
      const worker = new Worker(entry, execArgv ? { execArgv } : undefined);
      worker.on("message", (value: { id: number; ok: boolean; kind?: ScanWorkerResult["kind"]; files?: MemoryView["files"]; entry?: string; error?: string; code?: string }) => {
        const request = this.scanRequests.get(value.id);
        if (!request) return;
        this.scanRequests.delete(value.id);
        if (value.ok && value.kind === "scan" && value.files && value.entry !== undefined) request.resolve({ kind: "scan", files: value.files, entry: value.entry });
        else {
          const error = Error(value.error ?? "记忆读取失败");
          if (value.code) Object.assign(error, { code: value.code });
          request.reject(error);
        }
      });
      const failed = (error: Error) => {
        if (this.scanner !== worker) return;
        this.scanner = undefined;
        for (const request of this.scanRequests.values()) request.reject(error);
        this.scanRequests.clear();
        // 绝不退回主线程全量扫描；短暂重试保证异常 worker 不会永久留下旧缓存。
        if (!this.closed && !this.scannerRetry) {
          this.scannerRetry = setTimeout(() => {
            this.scannerRetry = undefined;
            this.scheduleScan();
          }, 1000);
          this.scannerRetry.unref();
        }
      };
      worker.once("error", failed);
      worker.once("exit", (code) => { if (!this.closed) failed(Error(`记忆扫描工作线程已退出 (${code})`)); });
      this.scanner = worker;
    } catch {
      // 构建或运行时暂不可创建 worker 时保留现有缓存，下一次校验再尝试恢复。
    }
  }

  private scannerRequest(request: { kind: "scan"; directory: string }) {
    this.startScanner();
    const worker = this.scanner;
    if (!worker) return Promise.reject(Error("记忆扫描工作线程不可用"));
    return new Promise<ScanWorkerResult>((resolve, reject) => {
      const id = ++this.scanRequest;
      this.scanRequests.set(id, { resolve, reject });
      try { worker.postMessage({ id, ...request }); }
      catch (error) {
        this.scanRequests.delete(id);
        reject(error instanceof Error ? error : Error("记忆扫描请求未发送"));
      }
    });
  }
  private async scanDirectory(directory: string) {
    const result = await this.scannerRequest({ kind: "scan", directory });
    if (result.kind !== "scan") throw Error("记忆扫描响应类型无效");
    return result;
  }

  private watchSources(root: string) {
    try {
      // libuv on Windows requires the native long spelling for watcher paths.
      this.watcher = watch(realpathSync.native(root), { recursive: true, persistent: false }, (_event, name) => {
        this.handleWatchEvent(root, name);
      });
      this.watcher.on("error", () => {
        this.watcher?.close();
        this.watcher = undefined;
        this.invalidate();
      });
    } catch {
      // 某些文件系统不支持递归监视，低频校验仍会保证最终一致。
    }
  }
  /** 普通事件只用其 sessionId 定位一条归属，避免在去抖之前枚举全部会话。 */
  private handleWatchEvent(root: string, name: string | Buffer | null | undefined) {
    if (!this.watcher) return;
    // Windows may keep issuing rename notifications after a watched root
    // disappears. Stop that watcher so failed reads can settle as empty.
    if (!existsSync(root)) {
      this.watcher.close(); this.watcher = undefined;
      this.invalidate();
      return;
    }
    const sessionId = String(name ?? "").split(/[\\/]/)[0];
    if (!/^[a-zA-Z0-9-]+$/.test(sessionId)) return;
    const row = this.store.db.prepare("SELECT s.id,s.workspaceId FROM sessions s JOIN workspaces w ON w.id=s.workspaceId WHERE s.id=? AND w.archived=0 AND NOT EXISTS(SELECT 1 FROM tasks WHERE tasks.sessionId=s.id)").get(sessionId);
    if (row) this.invalidate({ workspaceId: String(row.workspaceId), sessionId: String(row.id) });
  }

  /** Worker 完成后才发布，避免同一会话的高频写入触发并发全量扫描。 */
  private scheduleScan(scope?: Scope) {
    if (this.closed) return;
    if (scope) this.queuedScopes.set(scope.sessionId, scope);
    else this.queueAll = true;
    if (this.scanTask || this.scanDelay) return;
    this.scanDelay = setTimeout(() => {
      this.scanDelay = undefined;
      void this.drainScans().catch(() => {});
    }, 80);
    this.scanDelay.unref();
  }

  private generation(scope: Scope) { return this.generations.get(scope.sessionId) ?? 0; }
  /** 写入或外部文件事件提升版本，已在途的旧 worker 结果只能丢弃并重试。 */
  private invalidate(scope?: Scope) {
    if (scope) this.generations.set(scope.sessionId, this.generation(scope) + 1);
    else for (const item of this.scopes()) this.generations.set(item.sessionId, this.generation(item) + 1);
    this.scheduleScan(scope);
  }

  private async drainScans() {
    if (this.scanTask) return this.scanTask;
    const changedCatalogs = new Set<string>();
    const task = (async () => {
      try {
        while (!this.closed && (this.queueAll || this.queuedScopes.size)) {
          const scopes = this.queueAll ? this.scopes() : [...this.queuedScopes.values()];
          this.queueAll = false;
          this.queuedScopes.clear();
          for (let index = 0; index < scopes.length; index++) {
            const scope = scopes[index];
            if (this.closed) return;
            const generation = this.generation(scope);
            try {
              const view = await this.readViewInWorker(scope);
              if (this.closed) return;
              if (generation !== this.generation(scope)) {
                // 读取期间写入的新内容优先，旧结果不得覆盖缓存或 catalog。
                this.queuedScopes.set(scope.sessionId, scope);
                continue;
              }
              this.applyScan(scope, view, changedCatalogs);
            } catch {
              // An invalid source must neither retain usable stale content nor
              // reject another source's scan. Never replace a foreign cache entry.
              const cached = this.cachedViews.get(scope.sessionId);
              if (cached?.workspaceId === scope.workspaceId) this.cachedViews.delete(scope.sessionId);
              this.publishMemory(memoryScope(scope), this.unavailableView(scope, new AppError("MEMORY_UNAVAILABLE", "记忆扫描不可用")));
            }
            this.completeGeneration(scope, generation);
            // 大量会话首次建索引时，数据库写入和发布也要周期性让出事件循环。
            if (index % 16 === 15) await new Promise<void>((resolve) => setImmediate(resolve));
          }
        }
      } finally {
        this.publishCatalogs(changedCatalogs);
      }
    })();
    this.scanTask = task;
    void task.finally(() => {
      if (this.scanTask !== task) return;
      this.scanTask = undefined;
      // 处理 finally 窗口中新入队的请求，避免遗留待扫 scope。
      if (!this.closed && (this.queueAll || this.queuedScopes.size)) void this.drainScans().catch(() => {});
    }).catch(() => {});
    return task;
  }

  private completeGeneration(scope: Scope, generation: number) {
    const completed = Math.max(this.completedGenerations.get(scope.sessionId) ?? -1, generation);
    this.completedGenerations.set(scope.sessionId, completed);
    const byGeneration = this.scanWaiters.get(scope.sessionId);
    if (!byGeneration) return;
    for (const [target, waiters] of byGeneration) {
      if (target > completed) continue;
      byGeneration.delete(target);
      for (const waiter of waiters) waiter.resolve();
    }
    if (!byGeneration.size) this.scanWaiters.delete(scope.sessionId);
  }
  /** 等待指定来源的既定代次。取消调用方不会取消共享的目录扫描。 */
  private waitForGeneration(scope: Scope, target: number, signal?: AbortSignal) {
    if ((this.completedGenerations.get(scope.sessionId) ?? -1) >= target) return Promise.resolve();
    signal?.throwIfAborted();
    return new Promise<void>((resolve, reject) => {
      const waiter = { resolve: () => finish(resolve), reject: (error: Error) => finish(() => reject(error)) };
      const finish = (settle: () => void) => {
        signal?.removeEventListener("abort", abort);
        const byGeneration = this.scanWaiters.get(scope.sessionId), waiters = byGeneration?.get(target);
        waiters?.delete(waiter);
        if (waiters && !waiters.size) byGeneration?.delete(target);
        if (byGeneration && !byGeneration.size) this.scanWaiters.delete(scope.sessionId);
        settle();
      };
      const abort = () => waiter.reject(signal?.reason instanceof Error ? signal.reason : new AppError("MEMORY_UNAVAILABLE", "记忆扫描已取消"));
      const byGeneration = this.scanWaiters.get(scope.sessionId) ?? new Map<number, Set<typeof waiter>>();
      this.scanWaiters.set(scope.sessionId, byGeneration);
      const waiters = byGeneration.get(target) ?? new Set<typeof waiter>();
      byGeneration.set(target, waiters); waiters.add(waiter);
      signal?.addEventListener("abort", abort, { once: true });
      // 事件循环内完成扫描时，注册与检查之间不留下一次性丢失通知的窗口。
      if ((this.completedGenerations.get(scope.sessionId) ?? -1) >= target) waiter.resolve();
    });
  }
  /** 取消调用者的等待，但不取消共享或已经发出的文件读取。 */
  private awaitWithSignal<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return work;
    signal.throwIfAborted();
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true; signal.removeEventListener("abort", abort); callback();
      };
      const abort = () => finish(() => reject(signal.reason instanceof Error ? signal.reason : new AppError("MEMORY_UNAVAILABLE", "记忆扫描已取消")));
      signal.addEventListener("abort", abort, { once: true });
      work.then((value) => finish(() => resolve(value)), (error) => finish(() => reject(error)));
      if (signal.aborted) abort();
    });
  }
  /** 指定来源在本次调用时冻结；全局后台队列不会延长它们的等待。 */
  private async scanTargetsAsync(scopes: Scope[], signal?: AbortSignal) {
    const targets = [...new Map(scopes.filter((scope) => this.readableOwner(scope)).map((scope) => [scope.sessionId, scope])).values()];
    if (!targets.length) return;
    const requested = targets.map((scope) => {
      const generation = this.generation(scope) + 1;
      this.generations.set(scope.sessionId, generation);
      this.queuedScopes.set(scope.sessionId, scope);
      return { scope, generation };
    });
    if (this.scanDelay) { clearTimeout(this.scanDelay); this.scanDelay = undefined; }
    // 共享 drain 继续服务其他调用者；本调用只等待自己的 generation waiter。
    void this.drainScans().catch(() => {});
    await Promise.all(requested.map(({ scope, generation }) => this.waitForGeneration(scope, generation, signal)));
  }
  /** 正常服务入口使用此方法等待新快照，测试仍可使用同步 scan() 验证严格即时语义。 */
  async scanAsync(scope?: Scope, signal?: AbortSignal) {
    if (this.closed) return;
    await this.scanTargetsAsync(scope ? [scope] : this.scopes(), signal);
  }
  private readableOwner(scope: Scope) {
    try { return this.owner(scope); } catch { return undefined; }
  }
  /** Public optional-memory states are short and never include a filesystem path. */
  private memoryReason(error: unknown): MemoryReason {
    if (typeof error === "string" && ["missing", "unavailable", "correction_pending", "timeout", "revision_conflict", "read_failed"].includes(error))
      return error as MemoryReason;
    if (error instanceof AppError) {
      if (error.code === "MEMORY_CORRECTION_PENDING") return "correction_pending";
      if (error.code === "REVISION_CONFLICT") return "revision_conflict";
      if (error.code === "MEMORY_UNAVAILABLE" || error.code === "SCOPE_MISMATCH" || error.code === "AUTHORIZATION_REQUIRED" || error.code === "MEMORY_PATH" || error.code === "NOT_FOUND") return "unavailable";
      return "read_failed";
    }
    const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
    // Windows reports an inaccessible descendant below a regular `memory`
    // file as ENOENT. That is a storage failure, unlike a missing entry file.
    if (code === "ENOENT") {
      const storageRootBlocked = (() => { try { return [memoryRoot(this.store.root), join(this.store.root, "memory")].some((path) => { try { return lstatSync(path).isFile(); } catch { return false; } }); } catch { return true; } })();
      return storageRootBlocked ? "read_failed" : "missing";
    }
    if (code === "MEMORY_CORRECTION_PENDING") return "correction_pending";
    if (code === "REVISION_CONFLICT") return "revision_conflict";
    if (["MEMORY_UNAVAILABLE", "SCOPE_MISMATCH", "AUTHORIZATION_REQUIRED", "MEMORY_PATH", "NOT_FOUND"].includes(code)) return "unavailable";
    return "read_failed";
  }
  private unavailableView(scope: Scope, error: unknown): MemoryView {
    return { ...emptyMemoryView(scope), reason: this.memoryReason(error) };
  }
  private unavailableDocument(path: string, error: unknown): MemoryDocument {
    return { ...emptyMemoryDocument(path), reason: this.memoryReason(error) };
  }
  owner(scope: Scope) {
    if (!this.store.workspace(scope.workspaceId).authorized) throw new AppError("AUTHORIZATION_REQUIRED", "请先授权工作空间文件访问");
    const row = this.store.db.prepare("SELECT id,title,deletedAt FROM sessions WHERE workspaceId=? AND id=? AND NOT EXISTS(SELECT 1 FROM tasks WHERE tasks.sessionId=sessions.id)").get(scope.workspaceId, scope.sessionId);
    if (!row) throw new AppError("SCOPE_MISMATCH", "记忆不属于该工作空间的主会话");
    return row;
  }
  preferences(): MemoryPreferences {
    const row = this.store.db.prepare("SELECT body FROM memory_preferences WHERE id=1").get();
    const saved = row ? JSON.parse(String(row.body)) : {};
    return Object.fromEntries(Object.entries(defaultMemoryPreferences).map(([key, fallback]) => [key, saved[key] ?? fallback])) as unknown as MemoryPreferences;
  }
  scopes(): Scope[] {
    return this.store.db.prepare("SELECT s.id,s.workspaceId FROM sessions s JOIN workspaces w ON w.id=s.workspaceId WHERE w.archived=0 AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.sessionId=s.id)").all().map((r) => ({ workspaceId: String(r.workspaceId), sessionId: String(r.id) }));
  }
  view(scope: Scope): MemoryView {
    if (!this.readableOwner(scope)) return this.unavailableView(scope, new AppError("SCOPE_MISMATCH", "记忆来源不可用"));
    const view = this.readView(scope);
    return view.error ? this.unavailableView(scope, view.reason ?? new AppError("MEMORY_READ_FAILED", "记忆读取失败")) : view;
  }
  private readView(scope: Scope): MemoryView {
    const owner = this.owner(scope), directory = memoryDirectory(this.store.root, scope.sessionId);
    try {
      const files = memoryFiles(directory), entry = textFile(memoryPath(directory, "MEMORY.md"));
      const corrections = this.store.db.prepare("SELECT id,target FROM memory_corrections WHERE workspaceId=? ORDER BY id").all(scope.workspaceId);
      const blocked = corrections.some((c) => entry.includes(String(c.target)));
      // 对外仍是不可用快照；内部保留已验证的文件清单，以便纠正器能清理重现的原文。
      // Scope callers may pass a catalog entry carrying a previous organizer error.
      // Only identity belongs in the fresh file snapshot.
      const view = { workspaceId: scope.workspaceId, sessionId: scope.sessionId, revision: digest(JSON.stringify([files, corrections.map((c) => c.id)])), entry, progress: parseMemory(entry), files, deleted: owner.deletedAt !== null,
        ...(blocked ? { error: "记忆等待纠正", reason: "correction_pending" as const } : {}) };
      this.cachedViews.set(scope.sessionId, view);
      return view;
    } catch (error) {
      const view = { ...scope, revision: "error", entry: "", progress: parseMemory(""), files: [], deleted: owner.deletedAt !== null, error: "记忆读取失败", reason: this.memoryReason(error) };
      this.cachedViews.set(scope.sessionId, view);
      return view;
    }
  }
  private async readViewInWorker(scope: Scope): Promise<MemoryView> {
    const owner = this.owner(scope), directory = memoryDirectory(this.store.root, scope.sessionId);
    try {
      const { files, entry } = await this.scanDirectory(directory);
      const corrections = this.store.db.prepare("SELECT id,target FROM memory_corrections WHERE workspaceId=? ORDER BY id").all(scope.workspaceId);
      const blocked = corrections.some((c) => entry.includes(String(c.target)));
      // 扫描完成后的清理清单只驻留服务端缓存，snapshot/view 仍会屏蔽旧内容。
      return { workspaceId: scope.workspaceId, sessionId: scope.sessionId, revision: digest(JSON.stringify([files, corrections.map((c) => c.id)])), entry, progress: parseMemory(entry), files, deleted: owner.deletedAt !== null,
        ...(blocked ? { error: "记忆等待纠正", reason: "correction_pending" as const } : {}) };
    } catch (error) {
      return { ...scope, revision: "error", entry: "", progress: parseMemory(""), files: [], deleted: owner.deletedAt !== null, error: "记忆读取失败", reason: this.memoryReason(error) };
    }
  }
  private publishCatalogs(workspaces: Iterable<string>) {
    for (const workspaceId of new Set(workspaces)) this.publishCatalog(workspaceId);
  }
  /** 不订阅的客户端会在订阅建立时主动读取快照，因此后台可省去无接收者的推送。 */
  private publishMemory(scope: string, data?: unknown) {
    if (this.observed(scope)) this.publish(scope, data);
  }
  private publishCatalog(workspaceId: string) {
    const scope = memoryCatalogScope(workspaceId);
    // catalog() 会读完整持久目录；没有接收者时延后到订阅的首次 snapshot。
    if (this.observed(scope)) this.publish(scope, this.catalog(workspaceId));
  }
  private applyScan(scope: Scope, view: MemoryView, changedCatalogs?: Set<string>) {
    const cached = this.cachedViews.get(scope.sessionId);
    this.cachedViews.set(scope.sessionId, view);
    if (!view.error && this.pipeline.tree.enqueue(scope, view.entry)) this.publishTree(scope.workspaceId);
    this.scheduleOrganization();
    const sourceTitle = view.progress.title || String(this.owner(scope).title);
    const old = this.store.db.prepare("SELECT revision,body FROM memory_sources WHERE sessionId=?").get(scope.sessionId);
    const previous = old ? JSON.parse(String(old.body)) as StoredMemoryCatalogEntry : undefined;
    // Source catalog tracks raw revisions only. Purpose classification status
    // and retry timing live exclusively in the persistent purpose queue.
    const sourceStable = old?.revision === view.revision && previous?.deleted === view.deleted;
    const unchanged = sourceStable && previous?.error === view.error;
    const excerpt = memoryExcerpt(view.entry) || memoryPurposes(view.entry)[0]?.title || "", hasContent = !!excerpt || view.files.some((file) => file.path !== "MEMORY.md" && file.size > 0);
    const entryChars = view.error ? null : [...view.entry].length;
    if (unchanged && previous?.hasContent === hasContent && previous?.excerpt === excerpt && previous?.entryChars === entryChars) {
      if (previous.sourceTitle !== sourceTitle)
        this.store.db.prepare("UPDATE memory_sources SET body=? WHERE sessionId=?").run(JSON.stringify({ ...previous, sourceTitle }), scope.sessionId);
      // A restarted service still owes subscribers the first completed view,
      // even if its persistent catalog already contains this exact revision.
      if (!cached || cached.workspaceId !== scope.workspaceId || cached.revision !== view.revision || cached.error !== view.error)
        this.publishMemory(memoryScope(scope), view.error ? this.unavailableView(scope, view.reason ?? new AppError("MEMORY_READ_FAILED", "记忆读取失败")) : view);
      return;
    }
    const entry: StoredMemoryCatalogEntry = unchanged && previous ? { ...previous, sourceTitle, excerpt, hasContent, entryChars, reason: view.reason } : { ...scope, id: scope.sessionId, title: sourceTitle, sourceTitle, summary: "", excerpt, hasContent, entryChars, keywords: [],
      revision: view.revision, updatedAt: sourceStable && previous ? previous.updatedAt : Date.now(), indexedAt: null, status: view.error ? "error" : "pending", deleted: view.deleted, error: view.error, reason: view.reason };
    // Every changed source invalidates old semantic content immediately, including deletions.
    this.store.db.prepare("INSERT INTO memory_sources(sessionId,revision,body) VALUES(?,?,?) ON CONFLICT(sessionId) DO UPDATE SET revision=excluded.revision,body=excluded.body")
      .run(scope.sessionId, view.revision, JSON.stringify(entry));
    // Persist first; the coalesced scheduler runs after this scan yields.
    this.publishMemory(memoryScope(scope), view.error ? this.unavailableView(scope, view.reason ?? new AppError("MEMORY_READ_FAILED", "记忆读取失败")) : view);
    if (changedCatalogs) changedCatalogs.add(scope.workspaceId);
    else this.publishCatalogs([scope.workspaceId]);
  }
  /** 仅供需要严格即时语义的测试和内部迁移使用；正常服务入口调用 scanAsync。 */
  scan(scope?: Scope) {
    if (this.closed) return;
    const changedCatalogs = new Set<string>();
    for (const current of scope ? [scope] : this.scopes()) {
      if (!this.readableOwner(current)) continue;
      this.generations.set(current.sessionId, this.generation(current) + 1);
      const view = this.readView(current);
      this.applyScan(current, view, changedCatalogs);
      this.completeGeneration(current, this.generation(current));
    }
    this.publishCatalogs(changedCatalogs);
  }
  /** 订阅只能读取缓存，首次扫描期间返回 null 以保持客户端加载状态。 */
  snapshot(scope: Scope): MemoryView | null {
    if (!this.readableOwner(scope)) return this.unavailableView(scope, new AppError("SCOPE_MISMATCH", "记忆来源不可用"));
    const cached = this.cachedViews.get(scope.sessionId);
    if (cached?.workspaceId === scope.workspaceId) return cached.error ? this.unavailableView(scope, cached.reason ?? new AppError("MEMORY_READ_FAILED", "记忆读取失败")) : cached;
    this.scheduleScan(scope);
    return null;
  }
  /** 运行结算和会话变更触发定向后台更新，永不在请求路径全量扫描。 */
  refresh(scope?: Scope) {
    // Execution settlement includes child sessions, which have no session memory.
    if (scope && this.store.db.prepare("SELECT 1 FROM tasks WHERE workspaceId=? AND sessionId=?").get(scope.workspaceId, scope.sessionId)) return;
    this.invalidate(scope);
  }
  /** 会话改名只更新 catalog 投影，不读取或哈希任何记忆文件。 */
  rename(scope: Scope) {
    const row = this.store.db.prepare("SELECT body FROM memory_sources WHERE sessionId=?").get(scope.sessionId);
    if (!row) return;
    const entry = JSON.parse(String(row.body)) as StoredMemoryCatalogEntry, sourceTitle = this.cachedViews.get(scope.sessionId)?.progress.title || String(this.owner(scope).title);
    const title = sourceTitle;
    if (entry.title === title && entry.sourceTitle === sourceTitle) return;
    this.store.db.prepare("UPDATE memory_sources SET body=? WHERE sessionId=?").run(JSON.stringify({ ...entry, title, sourceTitle }), scope.sessionId);
    this.publishCatalog(scope.workspaceId);
  }
  /** 原始来源目录；旧语义生成字段仅保留在磁盘，不参与新索引。 */
  private storedCatalog(workspaceId: string): StoredMemoryCatalogEntry[] {
    try {
      if (!this.store.workspace(workspaceId).authorized) return [];
      return this.store.db.prepare("SELECT m.body FROM memory_sources m JOIN sessions s ON s.id=m.sessionId WHERE s.workspaceId=? ORDER BY s.updatedAt DESC").all(workspaceId)
        .flatMap((row) => {
          try { return [JSON.parse(String(row.body)) as StoredMemoryCatalogEntry]; } catch { return []; }
        });
    } catch { return []; }
  }
  /** Public catalog hides empty templates; scheduler must retain their state. */
  private catalogEntries(workspaceId: string) {
    return this.storedCatalog(workspaceId).filter((entry) => entry && (entry.hasContent || entry.status === "error"));
  }
  /** 前端目录与订阅只发布既有公共字段，绝不泄露服务端整理元数据。 */
  catalog(workspaceId: string): MemoryCatalogEntry[] {
    const purposes = this.pipeline.tree.entries(workspaceId);
    return this.catalogEntries(workspaceId).map(({ dependencies: _dependencies, treeVersion: _treeVersion, summaryVersion: _summaryVersion, ...entry }) => {
      const source = purposes.filter(purpose => purpose.source.sessionId === entry.sessionId && !purpose.blocked);
      const failed = source.find(purpose => purpose.error), pending = source.some(purpose => purpose.processedAt === null);
      return { ...entry, title: entry.sourceTitle ?? entry.title, summary: "", keywords: [],
        status: entry.reason || failed ? "error" as const : pending ? "pending" as const : "ready" as const,
        error: entry.reason ? entry.error : failed?.error, organizationError: failed?.error,
        indexedAt: pending ? null : Math.max(0, ...source.map(purpose => purpose.processedAt ?? 0)) || null };
    });
  }
  private localPath(scope: Scope, input: string, links?: MemoryLinkCache): string {
    this.owner(scope);
    const directory = memoryDirectory(this.store.root, scope.sessionId);
    let path: string;
    try { path = memoryPath(directory, input); }
    catch (failure) {
      // External files require an actual explicit link from this source and current workspace ownership.
      const candidate = resolve(directory, input), workspace = realpathSync(this.store.workspace(scope.workspaceId).path);
      const actual = realpathSync(candidate);
      const managedAttachment = [scope.sessionId, ...this.store.db.prepare("SELECT sessionId FROM tasks WHERE workspaceId=? AND parentSessionId=?").all(scope.workspaceId, scope.sessionId).map((r) => String(r.sessionId))]
        .some((id) => within(resolve(this.store.root, "attachments", scope.workspaceId, id), actual));
      const picked = this.store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='picked_images'").get()
        ? !!this.store.db.prepare("SELECT 1 FROM picked_images WHERE sessionId=? AND path=?").get(scope.sessionId, process.platform === "win32" ? actual.toLowerCase() : actual) : false;
      if (extname(actual).toLowerCase() === ".jsonl" || !(managedAttachment || picked || within(workspace, actual) && !within(realpathSync(this.store.root), actual) && !within(memoryRoot(this.store.root), actual) && !within(legacyMemoryRoot(this.store.root), actual))) throw failure;
      const files = memoryFiles(directory).filter((f) => /\.(md|txt)$/i.test(f.path));
      // Re-hash every link declaration before reusing parsed links: an edit,
      // deletion or replacement cannot retain external-file authority.
      const sourceRevision = digest(JSON.stringify(files.map((f) => [f.path, f.revision])));
      const explicit = () => files.flatMap((f) => referencedPaths(join(directory, f.path), textFile(memoryPath(directory, f.path))));
      const allowed = links?.links(scope.sessionId, sourceRevision, explicit) ?? explicit();
      if (!allowed.some((link) => { try { return realpathSync(link) === actual; } catch { return false; } })) throw failure;
      path = actual;
    }
    return path;
  }
  read(scope: Scope, input = "MEMORY.md", offset = 0, limit = 16000, options: { includeImage?: boolean } = {}): MemoryDocument {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 16000) throw new AppError("INVALID_INPUT", "读取分页范围无效");
    const path = this.localPath(scope, input), directory = memoryDirectory(this.store.root, scope.sessionId);
    const stat = statSync(path);
    if (/\.(png|jpg|jpeg|gif|webp)$/i.test(path)) {
      if (stat.size > 5 * 1024 * 1024) throw new AppError("MEMORY_LIMIT", "图片超过 5 MiB 预览预算");
      const data = readMemoryBytes(path, 5 * 1024 * 1024), mime = extname(path).slice(1).replace("jpg", "jpeg");
      return { path: input, revision: digest(data), size: stat.size, updatedAt: stat.mtimeMs, content: "图片产物", offset: 0, nextOffset: null,
        ...(options.includeImage === false ? {} : { image: `data:image/${mime};base64,${data.toString("base64")}` }) };
    }
    const data = readMemoryBytes(path), content = new TextDecoder("utf-8", { fatal: true }).decode(data);
    if (within(directory, path) && this.store.db.prepare("SELECT target FROM memory_corrections WHERE workspaceId=?").all(scope.workspaceId).some((c) => content.includes(String(c.target))))
      throw new AppError("MEMORY_CORRECTION_PENDING", "资料包含待清理的明确否定条目，旧内容暂不可查询");
    return { path: input, revision: digest(data), size: stat.size, updatedAt: stat.mtimeMs, content: content.slice(offset, offset + limit), offset,
      nextOffset: content.length > offset + limit ? offset + limit : null };
  }
  private readCached(scope: Scope, input: string, offset: number | undefined, limit: number | undefined, cache: MemoryTextCache, links: MemoryLinkCache): MemoryDocument {
    const pageOffset = offset ?? 0, pageLimit = limit ?? 16000;
    const path = this.localPath(scope, input, links);
    if (/\.(png|jpg|jpeg|gif|webp)$/i.test(path)) return this.read(scope, input, pageOffset, pageLimit, { includeImage: false });
    const key = `${scope.workspaceId}\u0000${scope.sessionId}\u0000${input}`;
    const snapshot = () => {
      const actual = this.localPath(scope, input, links), bytes = readMemoryBytes(actual), content = new TextDecoder("utf-8", { fatal: true }).decode(bytes), stat = statSync(actual);
      const directory = memoryDirectory(this.store.root, scope.sessionId);
      if (within(directory, actual) && this.store.db.prepare("SELECT target FROM memory_corrections WHERE workspaceId=?").all(scope.workspaceId).some((c) => content.includes(String(c.target))))
        throw new AppError("MEMORY_CORRECTION_PENDING", "资料包含待清理的明确否定条目，旧内容暂不可查询");
      return { revision: digest(bytes), content, size: stat.size, updatedAt: stat.mtimeMs };
    };
    return { path: input, ...cache.read(key, pageOffset, pageLimit, () => digest(readMemoryBytes(this.localPath(scope, input, links))), snapshot) };
  }
  async open(scope: Scope, input: string, revision: string, signal?: AbortSignal) {
    if (this.closed) throw new AppError("MEMORY_UNAVAILABLE", "服务正在退出");
    if (this.opening) throw new AppError("LIMIT", "正在打开本地文件，请稍候");
    signal?.throwIfAborted();
    const document = this.read(scope, input);
    if (document.revision !== revision) throw new AppError("REVISION_CONFLICT", "文件已更新，请重新读取后打开本地文件");
    const path = this.localPath(scope, input);
    if (!/\.(md|txt)$/i.test(path) || process.platform !== "win32" && (statSync(path).mode & 0o111))
      throw new AppError("MEMORY_PATH", "仅支持打开非可执行的 Markdown 或文本资料，脚本请在界面中查看");
    this.opening = true;
    try { await this.openFile(path, signal); return { requested: true }; }
    finally { this.opening = false; }
  }
  save(scope: Scope, path: string, revision: string, content: string) {
    this.owner(scope);
    if (typeof content !== "string" || Buffer.byteLength(content) > 180000) throw new AppError("MEMORY_LIMIT", "编辑内容超过 180 KB");
    if (path !== "MEMORY.md" && !/^(?:references|details)\/.+\.(md|txt)$/i.test(path)) throw new AppError("MEMORY_PATH", "只能编辑入口或详细文档");
    const target = memoryPath(memoryDirectory(this.store.root, scope.sessionId), path);
    if (digest(readMemoryBytes(target)) !== revision) throw new AppError("REVISION_CONFLICT", "资料已被修改；保留当前编辑，请重新读取后合并");
    try { guardMemoryWrite(join(memoryDirectory(this.store.root, scope.sessionId), "MEMORY.md"), target, content); }
    catch (error) {
      if (error instanceof MemoryValidationError) throw new AppError("MEMORY_STRUCTURE", error.message);
      throw error;
    }
    // Synchronous compare/write: no server task can interleave between them.
    this.generations.set(scope.sessionId, this.generation(scope) + 1);
    this.replaceFile(target, revision, content);
    this.scheduleScan(scope);
    return this.read(scope, path);
  }
  async correct(workspaceId: string, target: string) {
    const authorize = () => {
      if (!this.store.workspace(workspaceId).authorized) throw new AppError("AUTHORIZATION_REQUIRED", "请先授权工作空间文件访问");
    };
    authorize();
    // 先取得未屏蔽的文件清单，再登记纠正项；登记后旧条目不会短暂重新发布。
    await this.scanAsync();
    authorize();
    const id = randomUUID();
    for (const scope of this.scopes().filter((item) => item.workspaceId === workspaceId))
      this.generations.set(scope.sessionId, this.generation(scope) + 1);
    this.store.db.prepare("INSERT INTO memory_corrections VALUES(?,?,?,?)").run(id, workspaceId, target, Date.now());
    const failures = await this.applyCorrections(workspaceId);
    if (failures.length) throw new AppError("MEMORY_CORRECTION_PENDING", `部分记忆资料尚未清理：${failures.join("；")}`);
    return { id };
  }
  private async applyCorrections(workspaceId: string, organizationSignal?: AbortSignal) {
    const signal = organizationSignal ? AbortSignal.any([this.controller.signal, organizationSignal]) : this.controller.signal;
    signal.throwIfAborted();
    if (!this.store.workspace(workspaceId).authorized) return [] as string[];
    const targets = this.store.db.prepare("SELECT target FROM memory_corrections WHERE workspaceId=?").all(workspaceId).map((r) => String(r.target));
    // 没有待办纠正时不读取任何入口或详情，避免后台周期性同步 I/O。
    if (!targets.length) return [] as string[];
    // 首次恢复或刚写入纠正时缓存可能为空；只刷新当前工作空间，随后才用已验证的
    // 文件清单清理，不能让单个纠正升级为全局扫描。
    const scopes = this.scopes().filter((scope) => scope.workspaceId === workspaceId);
    await this.scanTargetsAsync(scopes, signal);
    signal.throwIfAborted();
    const failures: string[] = [];
    const changed = new Map<string, Scope>();
    for (const scope of scopes) {
      const files = this.cachedViews.get(scope.sessionId)?.files ?? [];
      for (const file of files.filter((f) => f.path === "MEMORY.md" || /^(?:references|details)\/.*\.(md|txt)$/i.test(f.path))) {
        signal.throwIfAborted();
        try {
          this.owner(scope);
          const path = memoryPath(memoryDirectory(this.store.root, scope.sessionId), file.path);
          // 保存竞争时重读一次再重试，且只影响当前文件，不拖住其他来源。
          for (let attempt = 0; attempt < 2; attempt++) {
            signal.throwIfAborted();
            const snapshot = this.readCorrectionSnapshot(path);
            const next = targets.reduce((body, target) => body.split(target).join(""), snapshot.content);
            if (next === snapshot.content) break;
            try {
              signal.throwIfAborted();
              this.generations.set(scope.sessionId, this.generation(scope) + 1);
              const main = file.path === "MEMORY.md" ? snapshot.content : readMemoryTextSnapshot(memoryPath(memoryDirectory(this.store.root, scope.sessionId), "MEMORY.md")).content;
              const headings = memoryPurposes(main);
              const keys = file.path === "MEMORY.md" ? headings.filter(heading => targets.some(target => heading.content.includes(target))).map(heading => heading.key)
                : file.path.startsWith("details/") ? headings.filter(heading => heading.detailPaths.includes(file.path)).map(heading => heading.key) : undefined;
              // Revoke before writing: if the process exits between these two
              // operations, no stale derived leaf can survive the correction.
              this.pipeline.tree.revoke(scope.sessionId, keys);
              this.replaceFile(path, snapshot.revision, next);
              this.publishTree(workspaceId);
              changed.set(scope.sessionId, scope);
              break;
            } catch (error) {
              if (!(error instanceof AppError) || error.code !== "REVISION_CONFLICT" || attempt === 1) throw error;
            }
          }
        } catch (error) {
          signal.throwIfAborted();
          // 纠正记录保留；下一轮会只重试当前失败资料，其他来源继续推进。
          failures.push(`${scope.sessionId}:${file.path}: ${error instanceof Error ? error.message : "清理失败"}`);
        }
        // 纠正可能涉及很多资料；让出后必须重新确认取消，不能继续写下一文件。
        await new Promise<void>((resolve) => setImmediate(resolve));
        signal.throwIfAborted();
      }
    }
    // 只有实际写入的来源再入队复扫；失败或未命中的资料不扩大本轮 I/O。
    if (changed.size) await this.scanTargetsAsync([...changed.values()], signal);
    return failures;
  }
  async query(scope: Scope, question: string, signal?: AbortSignal, parentLease?: LeaseRef, context: Pick<ProcessingContext, "runId" | "toolCallId"> = {}): Promise<MemoryQueryResult> {
    const timeoutMs = this.preferences().timeoutMs;
    const deadlineAt = Date.now() + timeoutMs;
    const timeout = AbortSignal.timeout(timeoutMs);
    const querySignal = AbortSignal.any([this.controller.signal, timeout, ...(signal ? [signal] : [])]);
    this.owner(scope);
    const processingId = this.records.start(scope, "memory.query", `记忆查询：${question.slice(0, 160)}`, undefined, undefined, false, context);
    try {
      querySignal.throwIfAborted();
      if (!question.trim()) throw new AppError("INVALID_INPUT", "请提供查询问题");
      const result = await this.awaitWithSignal(this.pipeline.query(scope, question, this.preferences().queryModel ?? this.selection(scope), querySignal, deadlineAt, parentLease, processingId), querySignal);
      this.records.finish(processingId, result.incomplete ? "failed" : "completed", result.incomplete ? "查询结果不完整" : undefined, result);
      return { ...result, processingId };
    } catch (error) {
      this.records.failure(processingId, error, querySignal);
      // Cancellation still belongs to the caller; every unavailable memory
      // result is otherwise optional and must not fail the agent's tool call.
      signal?.throwIfAborted();
      const code = error instanceof AppError ? error.code : "";
      const reason: MemoryQueryResult["reason"] = timeout.aborted ? "timeout"
        : code === "REVISION_CONFLICT" ? "revision_conflict"
        : code === "MEMORY_LOCATOR_INVALID" ? "locator_invalid"
        : code === "MEMORY_READ_FAILED" ? "read_failed" : "unavailable";
      return { answer: "", scope, incomplete: true, sources: [], reason, processingId };
    }
  }
  private selection(scope: Scope): Selection {
    const row = this.store.db.prepare("SELECT selection FROM agent_sessions WHERE sessionId=?").get(scope.sessionId);
    if (!row?.selection) throw new AppError("MODEL_REQUIRED", "请先选择记忆模型或来源会话模型");
    return JSON.parse(String(row.selection));
  }
  private scheduleOrganization() {
    if (this.closed || this.organizationWork || this.organizerScheduled || !this.runner) return;
    this.organizerScheduled = setImmediate(() => {
      this.organizerScheduled = undefined;
      void this.organize().catch(() => {});
    });
    this.organizerScheduled.unref();
  }
  async organize() {
    if (this.closed || this.organizationWork || !this.runner) return;
    // Count and timer triggers share this slot, reserved synchronously before
    // the first await. A running batch stays pending until atomic publication,
    // so a restart needs no recovery of model-owned or half-published state.
    const work: OrganizationWork = { controller: new AbortController() };
    this.organizationWork = work;
    work.done = (async () => {
      for (const workspace of this.store.workspaces()) {
        work.controller.signal.throwIfAborted();
        if (!workspace.authorized) continue;
        await this.applyCorrections(workspace.id, work.controller.signal);
        const batch = this.pipeline.tree.batch(workspace.id);
        if (!batch.length) continue;
        const scope = { workspaceId: workspace.id, sessionId: batch[0].source.sessionId }, processingId = this.pipeline.startOrganization(batch);
        work.active = { workspaceId: workspace.id, processingId, purposeIds: batch.map(purpose => purpose.id), sessionIds: [...new Set(batch.map(purpose => purpose.source.sessionId))] };
        this.publishTree(workspace.id);
        try {
          this.records.stage(processingId, "选择分类模型");
          await this.pipeline.organize(batch, this.preferences().organizerModel ?? this.selection(scope), work.controller.signal, processingId);
        } catch (error) {
          this.records.failure(processingId, error, work.controller.signal);
          this.pipeline.tree.failure(batch, error);
          this.publishTree(workspace.id);
          if (work.controller.signal.aborted) break;
        } finally {
          work.active = undefined;
          this.publishTree(workspace.id);
        }
      }
    })().finally(() => {
      if (this.organizationWork === work) this.organizationWork = undefined;
      // Never drain a sub-threshold fresh queue immediately: its oldest enqueue
      // time (persisted across restart), not last edit or last model call, is the clock.
      if (!this.closed && this.store.workspaces().some(workspace => workspace.authorized && this.pipeline.tree.batch(workspace.id).length)) this.scheduleOrganization();
    });
    await work.done;
  }
  private organizationOwner(workspaceId: string) {
    if (!this.store.workspace(workspaceId).authorized) throw new AppError("AUTHORIZATION_REQUIRED", "请先授权工作空间文件访问");
  }
  async command(c: Command, signal?: AbortSignal) {
    const p = object(c.params ?? {}), workspaceId = text(c.workspaceId, "工作空间");
    if (c.op === "memory.tree") return this.tree(workspaceId);
    if (c.op === "memory.catalog") {
      try { await this.scanAsync(undefined, signal); return this.catalog(workspaceId); }
      catch { signal?.throwIfAborted(); return []; }
    }
    if (c.op === "memory.get" || c.op === "memory.read") {
      const scope = { workspaceId, sessionId: text(c.sessionId, "会话") };
      if (c.op === "memory.get") {
        if (!this.readableOwner(scope)) return this.unavailableView(scope, new AppError("SCOPE_MISMATCH", "记忆来源不可用"));
        try { await this.scanAsync(scope, signal); return this.snapshot(scope) ?? emptyMemoryView(scope); }
        catch (error) { signal?.throwIfAborted(); return this.unavailableView(scope, error); }
      }
      const path = p.path === undefined ? "MEMORY.md" : text(p.path, "路径", 4096);
      if (!this.readableOwner(scope)) return this.unavailableDocument(path, new AppError("SCOPE_MISMATCH", "记忆来源不可用"));
      try { signal?.throwIfAborted(); return this.read(scope, path, p.offset as number | undefined, p.limit as number | undefined); }
      catch (error) { signal?.throwIfAborted(); return this.unavailableDocument(path, error); }
    }
    this.store.workspace(workspaceId);
    if (c.op === "memory.preferences") return this.preferences();
    if (c.op === "memory.configure") {
      if (Object.keys(p).some(key => !(key in defaultMemoryPreferences))) throw new AppError("INVALID_INPUT", "未知记忆设置");
      const value = { ...this.preferences(), ...p };
      for (const key of ["queryModel", "organizerModel"] as const) if (value[key] !== null) {
        const model = object(value[key]); text(model.provider, "供应商"); text(model.id, "模型");
        if (!thinkingLevels.includes(model.thinking as Selection["thinking"])) throw Error("思考等级无效");
      }
      for (const [key, min, max] of [["timeoutMs", memoryBudgetLimits.timeoutMs.min, memoryBudgetLimits.timeoutMs.max], ["readChars", memoryBudgetLimits.readChars.min, memoryBudgetLimits.readChars.max], ["maxTurns", memoryBudgetLimits.maxTurns.min, memoryBudgetLimits.maxTurns.max], ["concurrency", 1, 32], ["queue", 0, 128]] as const)
        if (!Number.isSafeInteger(value[key]) || value[key] < min || value[key] > max) throw new AppError("INVALID_INPUT", `${key} 超出范围`);
      this.store.db.prepare("INSERT INTO memory_preferences VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(JSON.stringify(value));
      return this.preferences();
    }
    if (c.op === "memory.correct") {
      if (p.confirmed !== true) throw new AppError("CONFIRMATION_REQUIRED", "请明确指定要从当前工作空间记忆删除的原文");
      return this.correct(workspaceId, text(p.target, "纠正原文", 4000));
    }
    const scope = { workspaceId, sessionId: text(c.sessionId, "会话") };
    if (c.op === "memory.resolve") {
      signal?.throwIfAborted();
      text(p.path, "路径", 4096);
      return this.localPath(scope, p.path as string);
    }
    if (c.op === "memory.open") return this.open(scope, text(p.path, "路径", 4096), text(p.revision, "修订"), signal);
    if (c.op === "memory.save") return this.save(scope, text(p.path, "路径", 4096), text(p.revision, "修订"), p.content as string);
    throw new AppError("UNKNOWN_OPERATION", "未知记忆操作");
  }
  async close() {
    this.closed = true;
    this.stopRecordObservation();
    clearInterval(this.timer);
    if (this.organizerScheduled) clearImmediate(this.organizerScheduled);
    if (this.scanDelay) clearTimeout(this.scanDelay);
    if (this.scannerRetry) clearTimeout(this.scannerRetry);
    this.watcher?.close();
    for (const request of this.scanRequests.values()) request.reject(Error("记忆服务正在退出"));
    this.scanRequests.clear();
    const scanner = this.scanner;
    this.scanner = undefined;
    this.controller.abort();
    const organization = this.organizationWork;
    organization?.controller.abort();
    await Promise.all([scanner?.terminate().catch(() => {}), this.runner?.close(), organization?.done?.catch(() => {})]);
  }
}
