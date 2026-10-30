import { useEffect, useRef, useState, type RefObject } from "react";
import { sessionListScope, type SessionListInvalidation, type SessionListCounts } from "../../shared/session-list.js";
import { command, observeConnection, scopeAuthority, scopeOrder, subscribeScope, useConnectionState } from "../transport.js";
import { SessionListCountsModel, type CountsSnapshot, type SessionListCountsReader } from "./session-list-counts.js";

const reader: SessionListCountsReader = {
  counts: (workspaceId, sessionIds, signal) => command<SessionListCounts>("session-list.counts", { sessionIds }, { workspaceId }, undefined, signal),
};
const empty: CountsSnapshot = { values: new Map(), invalidated: false };
type Owner = { context: string; model: SessionListCountsModel; active: boolean };

/** Only actual viewport intersections enter the reader, not all mounted rows.
 * rowsStamp describes DOM membership/held boundaries, never count reply state. */
export function useSessionListCounts(root: RefObject<HTMLDivElement | null>, workspaceId: string | undefined, query: string, rowsStamp: string) {
  const connection = useConnectionState();
  const context = JSON.stringify([workspaceId, query, connection.generation]);
  const live = useRef({ context, connected: connection.connected });
  live.current = { context, connected: connection.connected };
  const owner = useRef<Owner | null>(null);
  const [view, setView] = useState<{ context: string; state: CountsSnapshot } | null>(null);
  useEffect(() => {
    if (!workspaceId || !connection.connected) return;
    const lease: Owner = { context, model: new SessionListCountsModel(reader), active: true };
    owner.current = lease;
    const current = () => lease.active && owner.current === lease && live.current.context === context && live.current.connected;
    const publish = () => {
      if (!current()) return;
      const state = lease.model.getSnapshot();
      setView(previous => current() ? { context, state } : previous);
    };
    const stopModel = lease.model.subscribe(publish);
    publish();
    const stopConnection = observeConnection(state => {
      if (!state.connected || state.generation !== connection.generation) {
        lease.active = false; lease.model.dispose();
      }
    });
    let order = scopeOrder(sessionListScope);
    const delivered = () => {
      if (!current()) return;
      const next = scopeOrder(sessionListScope);
      if (next <= order || scopeAuthority<SessionListInvalidation>(sessionListScope) === undefined) return;
      order = next; lease.model.invalidate(); // equal metadata revision still matters
    };
    const stopScope = subscribeScope(sessionListScope, delivered);
    delivered();
    return () => {
      lease.active = false;
      if (owner.current === lease) owner.current = null;
      stopConnection(); stopScope(); stopModel(); lease.model.dispose();
    };
  }, [context, workspaceId, connection.connected, connection.generation]);
  useEffect(() => {
    const element = root.current, lease = owner.current;
    if (!element || !lease?.active || lease.context !== context || !connection.connected) return;
    let active = true;
    const visible = new Map<Element, () => void>();
    const observer = new IntersectionObserver(entries => {
      if (!active || !lease.active || owner.current !== lease || live.current.context !== context || !live.current.connected) return;
      for (const entry of entries) {
        const row = entry.target as HTMLElement;
        if (entry.isIntersecting && entry.intersectionRatio > 0 && !row.hidden) {
          if (!visible.has(row) && row.dataset.workspaceId && row.dataset.sessionId)
            visible.set(row, lease.model.enter({ workspaceId: row.dataset.workspaceId, sessionId: row.dataset.sessionId }));
        } else {
          visible.get(row)?.(); visible.delete(row);
        }
      }
    }, { root: element, threshold: 0 });
    for (const row of element.querySelectorAll<HTMLElement>(".history-row[data-session-id]:not([hidden])")) observer.observe(row);
    return () => { active = false; observer.disconnect(); visible.forEach(leave => leave()); };
  }, [root, context, rowsStamp, connection.connected]);
  return view?.context === context ? view.state : empty;
}
