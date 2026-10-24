import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type SetStateAction } from "react";
import { command, useConnectionState, useScope } from "../transport.js";
import { messageScope, type ChatMessage, type ThreadIndex } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
import type { HistoryIndex, HistoryRead } from "../../shared/history.js";
import { HistoryStore } from "./history-store.js";

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
}
export const OriginalMessages = createContext<MessageStore | null>(null);
export function useThreadMessage(scope: Scope, id: string) {
  const original = useContext(OriginalMessages);
  const live = useScope<ChatMessage | null>(messageScope(scope, id), null);
  const subscribe = useCallback((fn: () => void) => original?.subscribeMessage(id, fn) ?? (() => {}), [original, id]);
  const archived = useSyncExternalStore(subscribe, () => original?.get(id) ?? null);
  return live ?? archived;
}
export function useHistoryConversation(scope: Scope | null, index: ThreadIndex) {
  const connection = useConnectionState();
  const store = useMemo(() => new HistoryStore(
    signal => command<HistoryIndex>("agent.history.index", {}, scope ?? {}, crypto.randomUUID(), signal),
    (segmentId, groupId, signal) => command<HistoryRead>("agent.history.read", { segmentId, ...(groupId === undefined ? {} : { groupId }) }, scope ?? {}, crypto.randomUUID(), signal)),
  [scope?.workspaceId, scope?.sessionId]);
  const state = useSyncExternalStore(store.subscribe, store.snapshot);
  useEffect(() => {
    if (scope?.sessionId && connection.connected) void store.refresh();
    else store.pause();
  }, [store, scope?.sessionId, index.contextRevision, connection.generation, connection.connected]);
  useEffect(() => () => store.dispose(), [store]);
  return { ...state, store, ready: !!state.index && !state.loading && !state.error && connection.connected, retry: () => void store.refresh() };
}
export function useHistoryRange(store: HistoryStore, segmentId: string, groupId?: string, enabled = true) {
  const key = store.key(segmentId, groupId);
  const revision = useSyncExternalStore(store.subscribe, store.snapshot).index?.revision;
  const subscribe = useCallback((notify: () => void) => store.subscribeRange(key, notify), [store, key]);
  const state = useSyncExternalStore(subscribe, () => store.range(key));
  useEffect(() => enabled ? store.acquire(segmentId, groupId) : undefined, [store, key, enabled, revision]);
  return { ...state, retry: () => void store.load(segmentId, groupId) };
}
