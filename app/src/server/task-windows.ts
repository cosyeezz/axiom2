import { AppError, type Reply, type Scope } from "../shared/protocol.js";
import { taskWindowScope } from "../shared/task-window.js";
import { validRequestId, WindowFrameBudgetError, windowFieldErrorReceipt } from "../shared/window-frame-budget.js";
import type { Store } from "./storage.js";
import { TaskWindow } from "./task-window.js";
import { captureTaskWindow } from "./task-window-source.js";
import { readTaskWindowReport } from "./task-window-report.js";

type TaskStore = Pick<Store, "db" | "session" | "workspace">;
const scopeKey = (scope: Scope) => JSON.stringify([scope.workspaceId, scope.sessionId]);
/** Invalidation-only routes; never call legacy Tasks.list or scan SQL task bodies.
 * Direct parent changes cost O(1); workspace changes fan out to observed scopes.
 * These cursors are refresh hints, NOT task/transcript cut or readiness proofs. */
export function taskWindowInvalidations(changed: string, observed: () => Iterable<string>): string[] {
  const parts = changed.split(":");
  if (parts.length === 3 && ["tasks", "agent", "thread", "session"].includes(parts[0]))
    return [taskWindowScope({ workspaceId: parts[1], sessionId: parts[2] })];
  if (changed !== "workspaces" && !(parts.length === 2 && parts[0] === "sessions")) return [];
  const prefix = changed === "workspaces" ? "task-window:" : `task-window:${parts[1]}:`;
  return [...new Set([...observed()].filter(key => key.startsWith(prefix) && key.split(":").length === 3))];
}

/** Four scope readers, each retaining at most two immutable SQL cuts. An entry
 * bound is not a byte bound. HMAC seeds come from the same authorized host owner
 * as transcript windows, never a parallel namespace or a wire-visible secret. */
export class TaskWindows {
  private closed = false;
  private readonly entries = new Map<string, { scope: Scope; reader: TaskWindow }>();
  constructor(private readonly store: TaskStore, private readonly seed: (scope: Scope) => string) {}
  private retire(key: string) { this.entries.get(key)?.reader.close(); this.entries.delete(key); }
  check(scope: Scope) {
    try {
      if (this.closed) throw new WindowFrameBudgetError("STALE");
      this.store.session(scope.workspaceId, scope.sessionId);
      if (!this.store.workspace(scope.workspaceId).authorized) throw new AppError("AUTHORIZATION_REQUIRED", "请先授权工作空间文件访问");
    } catch (error) { this.retire(scopeKey(scope)); throw error; }
  }
  /** Preserve valid old cuts on ordinary task changes. Observe explicit owner
   * invalidations even without a read, so delete/restore cannot revive old refs. */
  changed(changed: string) {
    for (const [key, entry] of this.entries) {
      if (changed !== "workspaces" && changed !== `sessions:${entry.scope.workspaceId}` && changed !== `session:${entry.scope.workspaceId}:${entry.scope.sessionId}`) continue;
      try { this.check(entry.scope); } catch { this.retire(key); }
    }
  }
  read(scope: Scope, requestId: unknown, query: unknown, signal?: AbortSignal): Reply {
    if (!validRequestId(requestId)) return windowFieldErrorReceipt(requestId, "INVALID_REQUEST_ID").frame;
    if (signal?.aborted) return windowFieldErrorReceipt(requestId, "STALE").frame;
    const owned = { workspaceId: scope.workspaceId, sessionId: scope.sessionId }, key = scopeKey(owned);
    try {
      this.check(owned);
      let entry = this.entries.get(key);
      if (!entry) {
        const reader: TaskWindow = new TaskWindow(() => captureTaskWindow(this.store, owned), () => {
          this.check(owned);
          return this.entries.get(key)?.reader === reader;
        }, this.seed(owned), task => {
          // Resolve against CURRENT ownership, not a possibly old SQL cut. Never
          // authorize navigation solely by an ordinal, HMAC key or cached ID.
          const row = this.store.db.prepare("SELECT id,sessionId,initialInputId FROM tasks WHERE id=? AND workspaceId=? AND parentSessionId=?")
            .get(task.id, owned.workspaceId, owned.sessionId);
          if (!row || row.sessionId !== task.sessionId) throw new WindowFrameBudgetError("UNAVAILABLE");
          this.store.session(owned.workspaceId, String(row.sessionId));
          this.check(owned);
          return { taskId: String(row.id), sessionId: String(row.sessionId), initialInputId: row.initialInputId === null ? null : String(row.initialInputId) };
        }, (task, result) => readTaskWindowReport(this.store, owned, task, result));
        entry = { scope: owned, reader };
      }
      this.entries.delete(key); this.entries.set(key, entry);
      while (this.entries.size > 4) this.retire(this.entries.keys().next().value!);
      const frame = entry.reader.read(requestId, query);
      if (signal?.aborted) return windowFieldErrorReceipt(requestId, "STALE").frame;
      this.check(owned);
      return frame;
    } catch (error) {
      return windowFieldErrorReceipt(requestId, error instanceof WindowFrameBudgetError ? error.code : "UNAVAILABLE").frame;
    }
  }
  close() { this.closed = true; for (const entry of this.entries.values()) entry.reader.close(); this.entries.clear(); }
}
