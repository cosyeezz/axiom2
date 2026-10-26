import { AppError } from "../shared/protocol.js";
import { isActiveSession, isAutoTopSession } from "../shared/session-attention.js";
/** Foreground presence belongs to a connection; cooling belongs to the persisted session. */
export class SessionAttention {
    store;
    publish;
    viewers = new Map();
    timer;
    closed = false;
    constructor(store, publish) {
        this.store = store;
        this.publish = publish;
        this.timer = setInterval(() => this.expire(), 1000);
        this.timer.unref();
        this.expire();
    }
    view(owner, scope, active) {
        if (typeof active !== "boolean")
            throw new AppError("INVALID_INPUT", "查看状态必须为布尔值");
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
    disconnect(owner) {
        const scope = this.viewers.get(owner);
        this.viewers.delete(owner);
        if (this.closed || !scope || this.viewed(scope.sessionId))
            return;
        if (this.store.leaveSession(scope))
            this.publishVisible(scope.workspaceId);
    }
    /** Foreground presence protects cooling only; rendering acknowledgement owns reading. */
    observe(workspaceId) {
        if (this.closed)
            return;
        const visible = this.store.workspaces().some((w) => w.id === workspaceId);
        if (!visible)
            return;
        for (const session of this.store.sessions(workspaceId)) {
            if (isActiveSession(session)) {
                if (session.autoPinUntil != null)
                    this.store.db.prepare("UPDATE sessions SET autoPinUntil=NULL WHERE id=?").run(session.id);
            }
            else if (this.viewed(session.id) && session.autoPinUntil == null && isAutoTopSession(session))
                this.store.viewSession({ workspaceId, sessionId: session.id });
        }
    }
    /** Public for deterministic clock-based tests; production calls this once per second. */
    expire(now = Date.now()) {
        if (this.closed)
            return;
        const workspaces = new Set();
        const due = this.store.db.prepare("SELECT id,workspaceId FROM sessions WHERE autoPinUntil>0 AND autoPinUntil<=? AND unread=0").all(now);
        const active = new Set(due.length ? this.store.pinnedSessions().filter(isActiveSession).map((s) => s.id) : []);
        for (const row of due) {
            if (active.has(String(row.id))) {
                this.store.db.prepare("UPDATE sessions SET autoPinUntil=NULL WHERE id=?").run(row.id);
                workspaces.add(String(row.workspaceId));
                continue;
            }
            if (this.viewed(String(row.id)))
                continue;
            this.store.db.prepare("UPDATE sessions SET autoPinUntil=0 WHERE id=?").run(row.id);
            workspaces.add(String(row.workspaceId));
        }
        for (const workspaceId of workspaces)
            this.publishVisible(workspaceId);
    }
    viewed(sessionId) {
        return [...this.viewers.values()].some((scope) => scope.sessionId === sessionId);
    }
    publishVisible(workspaceId) {
        if (this.store.workspaces().some((w) => w.id === workspaceId))
            this.publish(`sessions:${workspaceId}`);
    }
    close() {
        if (this.closed)
            return;
        // Persist a full grace period for sessions still open when the service stops.
        for (const scope of this.viewers.values())
            this.store.leaveSession(scope);
        this.closed = true;
        this.viewers.clear();
        clearInterval(this.timer);
    }
}
//# sourceMappingURL=session-attention.js.map