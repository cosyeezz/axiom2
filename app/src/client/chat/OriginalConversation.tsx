import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { command, useConnectionState, useScope } from "../transport.js";
import { messageScope, type ChatMessage, type ThreadIndex } from "../../shared/agent.js";
import { AppError, type Scope } from "../../shared/protocol.js";
import { Icon } from "../Icon.js";
import { OriginalStore } from "./original-store.js";

type OriginalMode = { scope: Scope | null; enabled: boolean; setEnabled: Dispatch<SetStateAction<boolean>> };
const OriginalModeContext = createContext<OriginalMode | null>(null);

/** One provider per viewing instance, keyed by scope, shared by its thread and toolbar. */
export function OriginalConversationProvider({ scope, children }: { scope: Scope | null; children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const value = useMemo(() => ({ scope, enabled, setEnabled }), [scope?.workspaceId, scope?.sessionId, enabled]);
  return <OriginalModeContext.Provider value={value}>{children}</OriginalModeContext.Provider>;
}
function useOriginalMode(scope: Scope | null | undefined) {
  const mode = useContext(OriginalModeContext);
  return mode?.scope?.workspaceId === scope?.workspaceId && mode?.scope?.sessionId === scope?.sessionId ? mode : null;
}
export function OriginalConversationToggle({ scope }: { scope?: Scope }) {
  const mode = useOriginalMode(scope);
  return <button type="button" className="compression-trigger original-conversation-toggle action-icon"
    aria-label="原始会话" aria-pressed={mode?.enabled ?? false}
    data-tooltip={mode?.enabled ? "关闭原始会话" : "查看原始会话"}
    disabled={!scope?.sessionId || !mode} onClick={() => mode?.setEnabled((enabled) => !enabled)}>
    <Icon name="history" />
  </button>;
}

export const OriginalMessages = createContext<OriginalStore | null>(null);

/** Archived changes notify only their message ID; status changes preserve the store identity. */
export function useThreadMessage(scope: Scope, id: string) {
  const original = useContext(OriginalMessages);
  const live = useScope<ChatMessage | null>(messageScope(scope, id), null);
  const subscribe = useCallback((fn: () => void) => original?.subscribeMessage(id, fn) ?? (() => {}), [original, id]);
  const archived = useSyncExternalStore(subscribe, () => original?.get(id) ?? null);
  return live ?? archived;
}

export function useOriginalConversation(scope: Scope | null, index: ThreadIndex) {
  const enabled = useOriginalMode(scope)?.enabled ?? false;
  const connection = useConnectionState();
  const store = useMemo(() => new OriginalStore((signal) => command<ChatMessage[]>("agent.original", {}, scope ?? {}, crypto.randomUUID(), signal),
    (error) => error instanceof AppError && error.code === "UNKNOWN_OPERATION"
      ? "当前后台尚未支持原始会话。请在任务结束后重启后台服务，再刷新页面；仅刷新页面无法更新后台。"
      : error.message), [enabled, scope?.workspaceId, scope?.sessionId]);
  const state = useSyncExternalStore(store.subscribe, store.snapshot);
  // Older backends retain the structural fallback. Rebuild revisions cover archive-only edits.
  const revision = JSON.stringify([index.ids, index.groups, index.runId, index.runStatus, index.contextRevision, connection.generation]);
  useEffect(() => {
    if (enabled && scope?.sessionId && connection.connected) store.request(revision);
    else store.pause();
  }, [store, enabled, revision, connection.connected, scope?.sessionId]);
  useEffect(() => () => store.dispose(), [store]);
  return { enabled, messages: store, groups: state.groups,
    showing: enabled && state.hasData,
    loading: enabled && (state.loading || !state.hasData && !state.error),
    error: enabled ? state.error : "",
    ready: !enabled || state.hasData && state.revision === revision && !state.loading && !state.error && connection.connected,
    retry: () => store.retry() };
}
