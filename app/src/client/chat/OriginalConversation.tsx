import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type SetStateAction } from "react";
import { command, useConnectionState, useScope } from "../transport.js";
import { messageScope, type ChatMessage, type ThreadIndex } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
import type { HistoryIndex, HistoryRead } from "../../shared/history.js";
import { HistoryStore } from "./history-store.js";
import { historyCache } from "./history-cache.js";

const Disclosures = createContext<Map<string, boolean> | null>(null);
/** Viewing state is isolated between main and child sessions; recycled rows remember disclosures. */
export function OriginalConversationProvider({ children }: { scope: Scope | null; children: ReactNode }) {
  const memory = useRef(new Map<string, boolean>());
  return <Disclosures.Provider value={memory.current}>{children}</Disclosures.Provider>;
}
export function useRememberedDisclosure(key: string, initial = false) {
  const memory = useContext(Disclosures);
  const [open, update] = useState(() => memory?.get(key) ?? initial);
  const setOpen = useCallback((next: SetStateAction<boolean>) => update(previous => {
    const value = typeof next === "function" ? next(previous) : next;
    memory?.set(key, value); return value;
  }), [memory, key]);
  return [open, setOpen] as const;
}
export interface MessageStore {
  get: (id: string) => ChatMessage | null;
  subscribeMessage: (id: string, fn: () => void) => () => void;
  remember?: (message: ChatMessage) => void;
}
export const OriginalMessages = createContext<MessageStore | null>(null);
export function useThreadMessage(scope: Scope, id: string) {
  const original = useContext(OriginalMessages);
  const live = useScope<ChatMessage | null>(messageScope(scope, id), null);
  // A live collection can evict a completed message in the same update that
  // promotes it into an archive. Retain the already displayed snapshot until
  // its lazy archive read arrives, rather than replacing a tall body by loading.
  useLayoutEffect(() => { if (live && !live.streaming) original?.remember?.(live); }, [original, live]);
  const subscribe = useCallback((fn: () => void) => original?.subscribeMessage(id, fn) ?? (() => {}), [original, id]);
  const archived = useSyncExternalStore(subscribe, () => original?.get(id) ?? null);
  return live ?? archived;
}
export function useHistoryConversation(scope: Scope | null, index: ThreadIndex) {
  const connection = useConnectionState();
  const cacheKey = scope?.sessionId ? JSON.stringify([scope.workspaceId, scope.sessionId]) : null;
  const store = useMemo(() => new HistoryStore(
    signal => command<HistoryIndex>("agent.history.index", {}, scope ?? {}, crypto.randomUUID(), signal),
    (segmentId, groupId, signal) => command<HistoryRead>("agent.history.read", { segmentId, ...(groupId === undefined ? {} : { groupId }) }, scope ?? {}, crypto.randomUUID(), signal),
    undefined, cacheKey ? historyCache.get(cacheKey) : undefined),
  [cacheKey]);
  const state = useSyncExternalStore(store.subscribe, store.snapshot);
  const [validated, setValidated] = useState<{ store: HistoryStore; contextRevision: ThreadIndex["contextRevision"]; generation: number } | null>(null);
  // A collection can drop its archived prefix before the matching catalogue
  // arrives. Expose that gap synchronously, not one passive-effect later.
  const updating = validated?.store !== store || validated.contextRevision !== index.contextRevision || validated.generation !== connection.generation;
  const validate = () => {
    const snapshot = store.snapshot();
    if (snapshot.index && !snapshot.loading && !snapshot.error)
      setValidated({ store, contextRevision: index.contextRevision, generation: connection.generation });
  };
  useEffect(() => {
    let current = true;
    if (scope?.sessionId && connection.connected) void store.refresh().then(() => { if (current) validate(); });
    else store.pause();
    return () => { current = false; };
  }, [store, scope?.sessionId, index.contextRevision, connection.generation, connection.connected]);
  const lifetimes = useRef(new Map<HistoryStore, object>());
  useEffect(() => {
    const lifetime = {};
    lifetimes.current.set(store, lifetime);
    return () => {
      if (cacheKey) historyCache.set(cacheKey, store.cached());
      store.pause();
      // StrictMode replays setup/cleanup with the same memoized store. Cancel
      // I/O immediately, but destroy it only if no synchronous setup reclaims it.
      queueMicrotask(() => {
        if (lifetimes.current.get(store) !== lifetime) return;
        lifetimes.current.delete(store); store.dispose();
      });
    };
  }, [store, cacheKey]);
  return { ...state, store, updating, ready: !!state.index && !state.loading && !state.error && !updating && connection.connected, retry: () => void store.refresh().then(validate) };
}
/** Acquire independent source groups in parallel; never broaden a read to a segment. */
export function useHistoryRanges(store: HistoryStore, ranges: { segmentId: string; groupId: string }[]) {
  const key = JSON.stringify(ranges);
  const stable = useMemo(() => ranges, [key]);
  const revision = useSyncExternalStore(store.subscribe, store.snapshot).index?.revision;
  const subscribe = useCallback((notify: () => void) => {
    const off = stable.map(range => store.subscribeRange(store.key(range.segmentId, range.groupId), notify));
    return () => off.forEach(fn => fn());
  }, [store, stable]);
  // A primitive snapshot is stable even when several source ranges change together.
  const snapshot = useSyncExternalStore(subscribe, () => JSON.stringify(stable.map(range => store.range(store.key(range.segmentId, range.groupId)))));
  useEffect(() => {
    const off = stable.map(range => store.acquire(range.segmentId, range.groupId));
    return () => off.forEach(fn => fn());
  }, [store, stable, revision]);
  const states = JSON.parse(snapshot) as { ready: boolean; error: string }[];
  return { ready: states.every(state => state.ready), error: states.find(state => state.error)?.error ?? "",
    retry: () => stable.forEach(range => void store.load(range.segmentId, range.groupId)) };
}
export function useHistoryRange(store: HistoryStore, segmentId: string, groupId?: string, enabled = true) {
  const key = store.key(segmentId, groupId);
  const revision = useSyncExternalStore(store.subscribe, store.snapshot).index?.revision;
  const subscribe = useCallback((notify: () => void) => store.subscribeRange(key, notify), [store, key]);
  const state = useSyncExternalStore(subscribe, () => store.range(key));
  useEffect(() => enabled ? store.acquire(segmentId, groupId) : undefined, [store, key, enabled, revision]);
  return { ...state, retry: () => void store.load(segmentId, groupId) };
}
