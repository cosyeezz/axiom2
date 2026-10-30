import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sessionListScope, type SessionListInitial, type SessionListInvalidation, type SessionListPage } from "../../shared/session-list.js";
import { command, observeConnection, scopeAuthority, scopeOrder, subscribeScope, useConnectionState } from "../transport.js";
import { SessionListPages, type SessionListReader, type SessionListState } from "./session-list-pages.js";

const reader: SessionListReader = {
  initial: (workspaceId, query, signal) => command<SessionListInitial>("session-list.initial", { query }, { workspaceId }, undefined, signal),
  page: (workspaceId, group, query, cursor, signal) => command<SessionListPage>("session-list.page", { group, query, cursor }, { workspaceId }, undefined, signal),
};
const emptyFrame = { page: null, cursor: null, previous: [], loading: false, error: null } as const;
const emptyState: SessionListState = { top: emptyFrame, workspace: emptyFrame, revision: null, loading: false, error: null };
type Context = { workspaceId: string | undefined; query: string; generation: number; continuous: boolean };
type View = { context: Context; state: SessionListState; epoch: number; acceptedEpoch: number };
type Lease = { context: Context; active: boolean; started: boolean; model: SessionListPages; epoch: number; stopModel: () => void; replace: () => number };
const sameContext = (a: Context | undefined, b: Context) => !!a && a.workspaceId === b.workspaceId && a.query === b.query && a.generation === b.generation && a.continuous === b.continuous;
const sameDisplay = (a: Context | undefined, b: Context) => sameContext(a, b) || !!a && b.continuous && a.continuous && a.workspaceId === b.workspaceId && a.query === b.query;
const depthOf = (state?: SessionListState) => ({ top: state?.top.page?.items.length ?? 0, workspace: state?.workspace.page?.items.length ?? 0 });
const idleFrames = (state: SessionListState): SessionListState => ({ ...state, loading: false,
  top: { ...state.top, loading: false }, workspace: { ...state.workspace, loading: false } });

/** React owner of one workspace/raw-query/connection lifetime. RPC pages are not
 * transport scopes: they neither subscribe to full lists nor confirm selection. */
export function useSessionListPages(workspaceId: string | undefined, query = "", continuous = false) {
  const connection = useConnectionState();
  const context = useMemo<Context>(() => ({ workspaceId, query, generation: connection.generation, continuous }), [workspaceId, query, connection.generation, continuous]);
  const live = useRef({ context, connected: connection.connected });
  live.current = { context, connected: connection.connected };
  const owner = useRef<Lease | null>(null);
  const epoch = useRef(0);
  const [view, setView] = useState<View | null>(null);
  const displayed = useRef(view);
  displayed.current = view;

  useEffect(() => {
    if (!workspaceId) { setView(null); return; }
    if (!connection.connected) return;
    // Effect-owned, not a render/useMemo resource: StrictMode cleanup must not
    // leave a disposed instance installed for the replayed setup.
    const carried = continuous && sameDisplay(displayed.current?.context, context) ? displayed.current?.state : undefined;
    const lease: Lease = { context, active: true, started: false,
      model: new SessionListPages(reader, workspaceId, query, continuous, depthOf(carried)), epoch: ++epoch.current, stopModel: () => {}, replace: () => 0 };
    owner.current = lease;
    const current = () => lease.active && owner.current === lease && live.current.connected && sameContext(live.current.context, context);
    const attach = () => {
      const model = lease.model, readEpoch = lease.epoch;
      const valid = () => current() && lease.model === model;
      const publish = () => {
        if (!valid()) return;
        const state = model.getSnapshot();
        setView(previous => {
          if (!valid()) return previous;
          // A forced new reader has no pages until its initial succeeds. Keep
          // only the displayed rows as a transition, not authority for this epoch.
          const keep = state.revision === null && previous && sameDisplay(previous.context, context);
          return { context, epoch: readEpoch,
            acceptedEpoch: state.revision === null ? (keep && sameContext(previous.context, context) ? previous.acceptedEpoch : 0) : readEpoch,
            state: keep ? { ...previous.state, loading: state.loading, error: state.error,
              top: { ...previous.state.top, loading: false, error: state.top.error },
              workspace: { ...previous.state.workspace, loading: false, error: state.workspace.error } } : state };
        });
      };
      lease.stopModel = model.subscribe(publish);
      publish();
    };
    lease.replace = () => {
      lease.stopModel();
      const currentDepth = depthOf(lease.model.getSnapshot());
      // Another receipt can restart a reader whose initial is still pending.
      // Its empty model must not erase the depth of the rows still displayed.
      const displayedDepth = depthOf(continuous && sameDisplay(displayed.current?.context, context) ? displayed.current?.state : undefined);
      const depth = { top: Math.max(currentDepth.top, displayedDepth.top), workspace: Math.max(currentDepth.workspace, displayedDepth.workspace) };
      lease.model.dispose(); // synchronously fence old RPCs, before React rerenders
      lease.model = new SessionListPages(reader, workspaceId, query, continuous, depth);
      lease.epoch = ++epoch.current;
      attach();
      lease.started = true;
      void lease.model.refresh();
      return lease.epoch;
    };
    attach();
    // Connection loss is a synchronous fence, not merely a later effect cleanup.
    const stopConnection = observeConnection(state => {
      if (!state.connected || state.generation !== context.generation) {
        lease.active = false;
        lease.model.dispose();
      }
    });
    let order = scopeOrder(sessionListScope);
    const delivered = () => {
      if (!current()) return;
      const next = scopeOrder(sessionListScope);
      const invalidation = scopeAuthority<SessionListInvalidation>(sessionListScope);
      if (next <= order || invalidation === undefined) return;
      order = next;
      // Continuous History refreshes visible counts independently. Count-only
      // deliveries must not repeatedly rebuild the title list or cancel scrolling.
      if (continuous && invalidation.revision === lease.model.getSnapshot().revision) return;
      // Before bootstrap, this delivery is already covered by the first read.
      // The default paged consumer still refreshes even for an equal revision.
      if (lease.started) void lease.model.refresh();
    };
    const stopGlobal = subscribeScope(sessionListScope, delivered);
    delivered(); // close the subscribe/snapshot window without trusting old cache
    queueMicrotask(() => {
      if (!current() || lease.started) return;
      lease.started = true;
      void lease.model.refresh(); // do not wait indefinitely for a global snapshot
    });
    return () => {
      lease.active = false;
      if (owner.current === lease) owner.current = null;
      stopConnection(); stopGlobal(); lease.stopModel(); lease.model.dispose();
    };
  }, [context, workspaceId, query, continuous, connection.connected]);

  const current = useCallback(() => {
    const lease = owner.current;
    return lease?.active && live.current.connected && sameContext(lease.context, context) && sameContext(live.current.context, context) ? lease : null;
  }, [context]);
  const refresh = useCallback(() => current()?.model.refresh() ?? Promise.resolve(), [current]);
  const next = useCallback((group: "top" | "workspace") => current()?.model.next(group) ?? Promise.resolve(), [current]);
  const previous = useCallback((group: "top" | "workspace") => current()?.model.previous(group) ?? Promise.resolve(), [current]);
  /** Receipt fence for finite optimistic bridges. Returns a synchronous epoch;
   * only acceptedEpoch >= this value proves a post-fence initial was accepted.
   * Ordinary refresh's promise may finish before its dirty follow-up, so it is
   * intentionally not such a fence. Failure retains old pages and old evidence. */
  const restart = useCallback(() => current()?.replace() ?? null, [current]);
  const shown = view && sameDisplay(view.context, context) ? view : null;
  const accepted = shown && sameContext(shown.context, context);
  return { context, state: shown ? (connection.connected ? { ...shown.state, loading: !accepted || shown.state.loading } : idleFrames(shown.state)) : { ...emptyState, loading: !!workspaceId && connection.connected },
    epoch: shown?.epoch ?? 0, acceptedEpoch: accepted ? shown.acceptedEpoch : 0,
    enabled: !!current(), refresh, next, previous, restart };
}
