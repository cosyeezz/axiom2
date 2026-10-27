import type { Scope, Session, Workspace } from "../shared/protocol.js";

export type VisualAction = {
  id: string;
  op: string;
  params: Record<string, unknown>;
  target: Partial<Scope>;
  session?: Session;
  state: "pending" | "uncertain";
};
const supported = new Set(["session.rename", "session.pin", "session.delete", "workspace.rename", "workspace.pin", "workspace.delete", "favorites.set"]);

/** Intent overlays never replace server facts. Rollback removes only this intent,
 * so intervening streams, other windows and unrelated fields are preserved. */
export class VisualActions {
  private actions = new Map<string, VisualAction>();
  private projected = new Map<string, { source: unknown; value: unknown }>();
  private snapshot: VisualAction[] = [];
  list = () => this.snapshot;
  private changed() { this.projected.clear(); this.snapshot = [...this.actions.values()]; }
  begin(id: string, op: string, params: Record<string, unknown>, target: Partial<Scope>, session?: Session) {
    if (!supported.has(op)) return;
    const action: VisualAction = { id, op, params, target, session, state: "pending" };
    this.actions.set(id, action); this.changed();
    return action;
  }
  remove(id: string) { const action = this.actions.get(id); this.actions.delete(id); this.changed(); return action; }
  uncertain(id: string) {
    const action = this.actions.get(id);
    if (action) { this.actions.set(id, { ...action, state: "uncertain" }); this.changed(); }
  }
  hidden(session: Pick<Session, "id" | "workspaceId">) {
    return this.snapshot.some(a => a.op === "session.delete" && a.target.sessionId === session.id && a.target.workspaceId === session.workspaceId ||
      a.op === "workspace.delete" && a.target.workspaceId === session.workspaceId);
  }
  project<T>(scope: string, source: T): T {
    // Never retain large message/thread sources or defeat transport's session LRU.
    if (!this.snapshot.length || !/^(sessions:|session:|workspaces$|pinned-sessions$|favorites$)/.test(scope)) return source;
    const cached = this.projected.get(scope);
    if (cached && cached.source === source) return cached.value as T;
    const value = this.snapshot.reduce((data, action) => projectVisualAction(scope, data, action), source as unknown) as T;
    this.projected.set(scope, { source, value });
    return value;
  }
}

/** Also used to merge an acknowledged intent into caches that were not subscribed.
 * Only the commanded fields are merged, never the captured whole object. */
export function projectVisualAction(scope: string, source: unknown, action: VisualAction): unknown {
  const { op, params: p, target: t } = action;
  if (op.startsWith("session.")) {
    const update = (s: Session) => {
      if (s.id !== t.sessionId || s.workspaceId !== t.workspaceId) return s;
      if (op === "session.delete") return null;
      return { ...s, ...(op === "session.rename" ? { title: p.title as string } : { pinned: p.pinned as boolean }) };
    };
    if (scope === `session:${t.workspaceId}:${t.sessionId}` && source) return update(source as Session);
    if ((scope === `sessions:${t.workspaceId}` || scope === "pinned-sessions") && Array.isArray(source)) {
      const rows = source as Session[];
      const result = rows.map(update).filter((s): s is Session => s !== null);
      if (scope === "pinned-sessions" && op === "session.pin" && p.pinned === true && action.session && !result.some(s => s.id === t.sessionId))
        result.push({ ...action.session, pinned: true });
      return result;
    }
  }
  if (op.startsWith("workspace.")) {
    if (scope === "workspaces" && Array.isArray(source)) return (source as Workspace[]).flatMap(w => w.id !== t.workspaceId ? [w] :
      op === "workspace.delete" ? [] : [{ ...w, ...(op === "workspace.rename" ? { name: p.name as string } : { pinned: p.pinned as boolean }) }]);
    if (op === "workspace.delete") {
      if (scope === "pinned-sessions" && Array.isArray(source)) return (source as Session[]).filter(s => s.workspaceId !== t.workspaceId);
      if (scope === `sessions:${t.workspaceId}`) return [];
    }
  }
  if (op === "favorites.set" && scope === "favorites" && Array.isArray(source)) {
    const rows = (source as { provider: string; id: string }[]).filter(f => f.provider !== p.provider || f.id !== p.id);
    if (p.favorite === true) rows.push({ provider: p.provider as string, id: p.id as string });
    return rows;
  }
  return source;
}
