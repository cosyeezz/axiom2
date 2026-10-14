import { AppError, type Scope } from "../shared/protocol.js";
import { isAutoTopSession } from "../shared/session-attention.js";
import type { Store } from "./storage.js";

/** Foreground presence belongs to a connection; cooling belongs to the persisted session. */
export class SessionAttention {
  private readonly viewers = new Map<object, Scope>();
  private readonly timer: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(private readonly store: Store, private readonly publish: (scope: string) => void) {
    this.timer = setInterval(() => this.expire(), 1000);
    this.timer.unref();
    this.expire();
  }

  view(owner: object, scope: Scope, active: unknown) {
    if (typeof active !== "boolean") throw new AppError("INVALID_INPUT", "查看状态必须为布尔值");
    this.store.session(scope.workspaceId, scope.sessionId);
    const previous = this.viewers.get(owner);
    if (!active) {
      // A delayed departure from A cannot clear a connection already viewing B.
      if (previous?.workspaceId === scope.workspaceId && previous.sessionId === scope.sessionId)
        this.disconnect(owner);
      return;
    }
    if (previous && (previous.workspaceId !== scope.workspaceId || previous.sessionId !== scope.sessionId))
      this.disconnect(owner);
    this.store.viewSession(scope);
    this.viewers.set(owner, scope);
    this.publish(`sessions:${scope.workspaceId}`);
  }

  disconnect(owner: object) {
    const scope = this.viewers.get(owner);
    this.viewers.delete(owner);
    if (this.closed || !scope || this.viewed(scope.sessionId)) return;
    if (this.store.leaveSession(scope)) this.publishVisible(scope.workspaceId);
  }

  /** Foreground presence protects cooling only; rendering acknowledgement owns reading. */
  observe(workspaceId: string) {
    if (this.closed || ![...this.viewers.values()].some((scope) => scope.workspaceId === workspaceId)) return;
    const visible = this.store.workspaces().some((w) => w.id === workspaceId);
    if (!visible) return;
    for (const session of this.store.sessions(workspaceId)) {
      if (this.viewed(session.id) && session.autoPinUntil == null && isAutoTopSession(session))
        this.store.viewSession({ workspaceId, sessionId: session.id });
    }
  }

  /** Public for deterministic clock-based tests; production calls this once per second. */
  expire(now = Date.now()) {
    if (this.closed) return;
    const workspaces = new Set<string>();
    const due = this.store.db.prepare("SELECT id,workspaceId FROM sessions WHERE autoPinUntil>0 AND autoPinUntil<=? AND unread=0").all(now);
    for (const row of due) {
      if (this.viewed(String(row.id))) continue;
      this.store.db.prepare("UPDATE sessions SET autoPinUntil=0 WHERE id=?").run(row.id);
      workspaces.add(String(row.workspaceId));
    }
    for (const workspaceId of workspaces) this.publishVisible(workspaceId);
  }

  private viewed(sessionId: string) {
    return [...this.viewers.values()].some((scope) => scope.sessionId === sessionId);
  }

  private publishVisible(workspaceId: string) {
    if (this.store.workspaces().some((w) => w.id === workspaceId)) this.publish(`sessions:${workspaceId}`);
  }

  close() {
    if (this.closed) return;
    // Persist a full grace period for sessions still open when the service stops.
    for (const scope of this.viewers.values()) this.store.leaveSession(scope);
    this.closed = true;
    this.viewers.clear();
    clearInterval(this.timer);
  }
}
