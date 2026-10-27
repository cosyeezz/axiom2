import { statSync } from "node:fs";
import { Lru } from "../shared/lru.js";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Scope } from "../shared/protocol.js";
import type { Compression } from "../shared/compression.js";
import { nativeCompactionAttemptKind, sumCosts, type CostCategory, type CostReport, type CostRow, type CostTotals } from "../shared/costs.js";
import type { Store } from "./storage.js";
import { openTranscript } from "./transcript.js";
import { usageCost } from "./usage-cost.js";
import { nativeCompactionCost } from "./native-compaction-usage.js";
import { kiroCompactionAttemptKind } from "../shared/kiro-usage.js";

/** Read-only accounting over native history; independent from current context projection. */
export class Costs {
  private readonly versions = new Lru<string, string>(256);
  constructor(private readonly store: Store) {}
  /** File metadata and accounting rows only: progress notifications never parse history. */
  private sourceVersion(scope: Scope): string {
    const root = this.store.session(scope.workspaceId, scope.sessionId);
    const children = this.store.db.prepare("SELECT t.id,t.sessionId,t.title,t.status FROM tasks t JOIN sessions s ON s.id=t.sessionId AND s.workspaceId=t.workspaceId WHERE t.workspaceId=? AND t.parentSessionId=? ORDER BY t.createdAt,t.id").all(scope.workspaceId, scope.sessionId);
    const hasMemory = !!this.store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_usage'").get();
    const sources = [root.id, ...children.map((row) => String(row.sessionId))].map((id) => {
      const stored = this.store.db.prepare("SELECT file,usage FROM agent_sessions WHERE sessionId=?").get(id);
      let file: unknown = null;
      if (stored?.file) {
        try {
          const stat = statSync(String(stored.file), { bigint: true });
          file = [stored.file, ...[stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.mode].map(String)];
        } catch (error) { file = [stored.file, (error as NodeJS.ErrnoException).code ?? "unreadable"]; }
      }
      const jobs = this.store.db.prepare("SELECT body FROM compressions WHERE sessionId=? ORDER BY rowid").all(id).map((row) => {
        const job = JSON.parse(String(row.body)) as Compression;
        return [job.id, job.state, job.phase === "snapshot", job.phase === "applying", job.trigger, job.startedAt, job.selection, job.usage, job.billing];
      });
      const memory = hasMemory ? this.store.db.prepare("SELECT id,kind,provider,model,usage FROM memory_usage WHERE sessionId=? ORDER BY id").all(id) : [];
      return [id, file, stored?.file ? null : stored?.usage, jobs, memory];
    });
    return JSON.stringify([root.title, children, sources]);
  }
  /** Non-consuming cache fingerprint; independent from live per-session invalidations. */
  version(requested: Scope): string { return this.sourceVersion(this.owner(requested)); }
  changed(requested: Scope): boolean {
    const scope = this.owner(requested), key = JSON.stringify(scope);
    const version = this.sourceVersion(scope), previous = this.versions.get(key);
    this.versions.set(key, version);
    return previous !== version;
  }
  owner(scope: Scope): Scope {
    this.store.session(scope.workspaceId, scope.sessionId);
    const task = this.store.db.prepare("SELECT parentSessionId FROM tasks WHERE workspaceId=? AND sessionId=?").get(scope.workspaceId, scope.sessionId);
    const root = { ...scope, sessionId: task ? String(task.parentSessionId) : scope.sessionId };
    this.store.session(root.workspaceId, root.sessionId);
    return root;
  }
  get(requested: Scope): CostReport {
    const scope = this.owner(requested), root = this.store.session(scope.workspaceId, scope.sessionId);
    // A direct read must not consume an invalidation still owed to other views.
    const key = JSON.stringify(scope);
    if (this.versions.get(key) === undefined) this.versions.set(key, this.sourceVersion(scope));
    const children = this.store.db.prepare("SELECT t.id,t.sessionId,t.title,t.status FROM tasks t JOIN sessions s ON s.id=t.sessionId AND s.workspaceId=t.workspaceId WHERE t.workspaceId=? AND t.parentSessionId=? ORDER BY t.createdAt,t.id").all(scope.workspaceId, scope.sessionId);
    const sessions: CostReport["sessions"] = [{ id: root.id, title: root.title, taskId: null, status: null },
      ...children.map((row) => ({ id: String(row.sessionId), title: typeof row.title === "string" && row.title.trim() ? row.title : "子任务", taskId: String(row.id), status: String(row.status) }))];
    const rows = new Map<string, CostRow>(), warnings: string[] = [];
    for (const session of sessions) {
      const add = (category: CostCategory, sourceId: string, source: string, totals: CostTotals,
        provider: string | null = null, model: string | null = null, status?: string, timestamp?: number) => {
        const id = JSON.stringify([session.id, category, sourceId, provider, model]);
        const previous = rows.get(id);
        rows.set(id, { id, category, sessionId: session.id, source, provider, model, ...(status ? { status } : {}),
          ...(timestamp != null && Number.isFinite(timestamp) ? { timestamp } : {}),
          ...sumCosts(previous ? [previous, totals] : [totals]) });
      };
      const stored = this.store.db.prepare("SELECT file,usage FROM agent_sessions WHERE sessionId=?").get(session.id);
      const jobs = new Map<string, Compression>(this.store.db.prepare("SELECT id,body FROM compressions WHERE sessionId=? ORDER BY rowid").all(session.id)
        .map((row) => [String(row.id), JSON.parse(String(row.body)) as Compression]));
      const applied = new Set<string>();
      let entries: SessionEntry[] = [];
      if (stored?.file) {
        try { entries = openTranscript(String(stored.file), this.store.workspace(scope.workspaceId).path, { readOnly: true }).getEntries(); }
        catch {
          warnings.push(`${session.title}：原始用量记录不可读取，费用不完整。`);
          add(session.taskId ? "subagent" : "main", "unavailable", "记录不可读取", usageCost(null));
        }
      } else if (stored?.usage) {
        // A cached session sum cannot be separated safely from compression/tool charges.
        warnings.push(`${session.title}：仅有历史累计值，缺少可核对的原始记录。`);
        add(session.taskId ? "subagent" : "main", "unavailable", "缺少原始记录", usageCost(null));
      }
      for (const entry of entries) {
        if (entry.type === "message") {
          const message = entry.message;
          if (message.role === "assistant") {
            add(session.taskId ? "subagent" : "main", "agent", session.title, usageCost(message.usage, message.responseModel ?? message.model), message.provider ?? null, message.responseModel ?? message.model ?? null);
          } else if (message.role === "toolResult" && message.usage) {
            // Tool usage is independent from the parent assistant request. Never infer
            // a tool's model from the main agent's selected model.
            add("tool", message.toolName, message.toolName, usageCost(message.usage));
          }
        } else if (entry.type === "compaction" || entry.type === "branch_summary") {
          const details = entry.details as { axiomCompressionId?: unknown } | undefined;
          const jobId = typeof details?.axiomCompressionId === "string" ? details.axiomCompressionId : null;
          if (jobId && applied.has(jobId)) continue;
          if (jobId) applied.add(jobId);
          const job = jobId ? jobs.get(jobId) : undefined, native = entry.type === "compaction" ? nativeCompactionCost(entry.usage, details) : undefined;
          const model = job?.selection.id ?? native?.model, provider = job?.selection.provider ?? native?.provider;
          const totals = job?.billing ?? (entry.usage ? job ? usageCost(entry.usage, model) : native?.totals ?? usageCost(entry.usage) : job ? this.jobUsage(job) : usageCost(null));
          add("compression", jobId ?? entry.id, job ? this.jobLabel(job) : entry.type === "branch_summary" ? "分支摘要" : "原生压缩",
            totals, provider ?? null, model ?? null, "已应用", job?.startedAt ?? Date.parse(entry.timestamp));
        } else if (entry.type === "usage") {
          const tool = entry.kind.startsWith("tool:") ? entry.kind.slice(5) : null;
          const summaryAttempt = entry.kind === kiroCompactionAttemptKind || entry.kind === nativeCompactionAttemptKind;
          add(summaryAttempt ? "compression" : tool ? "tool" : "other", entry.kind,
            summaryAttempt ? "原生压缩未合并请求" : tool || entry.kind, usageCost(entry.usage, entry.model), entry.provider, entry.model);
        }
      }
      if (this.store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_usage'").get()) {
        for (const row of this.store.db.prepare("SELECT * FROM memory_usage WHERE sessionId=?").all(session.id)) {
          const query = row.kind === "query";
          add(query ? "tool" : "other", row.kind === "title" ? "session_title" : query ? "memory_query" : "memory_organize", row.kind === "title" ? "会话标题" : query ? "记忆查询" : "后台记忆整理", usageCost(row.usage ? JSON.parse(String(row.usage)) : null, row.model), row.provider ? String(row.provider) : null, row.model ? String(row.model) : null);
        }
      }
      for (const [id, job] of jobs) {
        if (applied.has(id)) continue;
        // Snapshot-only cancellation/startup rejection never requested a model.
        if (!job.usage && !job.billing && job.phase === "snapshot") continue;
        const states = { running: "进行中", completed: "已应用", failed: "失败 · 未应用", cancelled: "取消 · 未应用", interrupted: "中断 · 未应用" };
        add("compression", id, this.jobLabel(job), this.jobUsage(job), job.selection.provider, job.selection.id,
          job.state === "running" && job.phase === "applying" ? "等待应用" : states[job.state], job.startedAt);
      }
    }
    const result = [...rows.values()];
    return { scope, requestedSessionId: requested.sessionId, title: root.title, updatedAt: Date.now(), sessions,
      rows: result, total: sumCosts(result), warnings };
  }
  private jobLabel(job: Compression) {
    return job.trigger === "auto" ? "自动压缩" : "后台压缩";
  }
  private jobUsage(job: Compression): CostTotals { return compressionCost(job); }
}
/** Shared by session accounting and the per-entry usage ledger; never reprice history. */
export function compressionCost(job: Compression): CostTotals {
    if (job.billing) return job.billing;
    if (!job.usage) return usageCost(null);
    // New Kiro projections retain measurement provenance even for zero/unknown.
    // Never infer missing cache parts on old jobs or reprice historical requests.
    if (job.selection.provider === "kiro" && job.usage.axiomKiro)
      return usageCost({ input: job.usage.input, output: job.usage.output, cacheRead: job.usage.cacheRead,
        cacheWrite: job.usage.cacheWrite, axiomKiro: job.usage.axiomKiro, cost: job.usage.costParts ?? { total: job.usage.cost } });
    // Old jobs retained input/output and total cost, but not cache components.
    return usageCost({ input: job.usage.input, output: job.usage.output, cost: { total: job.usage.cost } });
}
