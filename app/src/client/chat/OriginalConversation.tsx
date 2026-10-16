import { createContext, useContext, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { command, useConnectionState, useScope } from "../transport.js";
import { messageScope, type ChatMessage, type ThreadIndex } from "../../shared/agent.js";
import { AppError, type Scope } from "../../shared/protocol.js";
import { threadGroups } from "../../shared/thread-layout.js";

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
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 16" fill="currentColor" stroke="none" aria-hidden="true" data-icon="bi:filetype-raw">
      <path fillRule="evenodd" d="M14 4.5V14a2 2 0 0 1-2 2v-1a1 1 0 0 0 1-1V4.5h-2A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v9H2V2a2 2 0 0 1 2-2h5.5zM1.597 11.85H0v3.999h.782v-1.491h.71l.7 1.491h1.651l.313-1.028h1.336l.314 1.028h.84L5.31 11.85h-.925l-1.329 3.96l-.783-1.572A1.18 1.18 0 0 0 3 13.116q0-.384-.167-.668a1.1 1.1 0 0 0-.478-.44a1.7 1.7 0 0 0-.758-.158m-.815 1.913v-1.292h.7a.74.74 0 0 1 .507.17q.194.17.194.49q0 .315-.194.474q-.19.158-.518.158zm4.063-1.148l.489 1.617H4.32l.49-1.617zm4.006.445l-.74 2.789h-.73L6.326 11.85h.855l.601 2.903h.038l.706-2.903h.683l.706 2.903h.04l.596-2.903h.858l-1.055 3.999h-.73l-.74-2.789H8.85Z" />
    </svg>
  </button>;
}

export const OriginalMessages = createContext<ReadonlyMap<string, ChatMessage> | null>(null);

/** Archived messages are local to this mounted view; live deltas still notify by message ID. */
export function useThreadMessage(scope: Scope, id: string) {
  const original = useContext(OriginalMessages);
  const live = useScope<ChatMessage | null>(messageScope(scope, id), null);
  return live ?? original?.get(id) ?? null;
}

export function useOriginalConversation(scope: Scope | null, index: ThreadIndex) {
  const enabled = useOriginalMode(scope)?.enabled ?? false;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ messages: ChatMessage[]; revision: string; error: string } | null>(null);
  const connection = useConnectionState();
  // Text deltas do not reload the archive. Refresh only at message/layout and run boundaries.
  const revision = JSON.stringify([index.ids, index.groups, index.runId, index.runStatus, connection.generation]);
  useEffect(() => {
    if (!enabled || !scope?.sessionId) { setState(null); return; }
    if (!connection.connected) return;
    let active = true;
    void command<ChatMessage[]>("agent.original", {}, scope).then((messages) => {
      if (active) setState({ messages, revision, error: "" });
    }).catch((error: Error) => {
      const message = error instanceof AppError && error.code === "UNKNOWN_OPERATION"
        ? "当前后台尚未支持原始会话。请在任务结束后重启后台服务，再刷新页面；仅刷新页面无法更新后台。"
        : error.message;
      if (active) setState((previous) => ({ messages: previous?.messages ?? [], revision, error: message }));
    });
    return () => { active = false; };
  }, [enabled, scope?.workspaceId, scope?.sessionId, revision, connection.connected, attempt]);
  const messages = useMemo(() => new Map(state?.messages.map((message) => [message.id, message])), [state]);
  const groups = useMemo(() => threadGroups(state?.messages ?? []), [state]);
  return { enabled, messages, groups,
    showing: enabled && !!state && !state.error,
    loading: enabled && !state,
    error: enabled ? state?.error ?? "" : "",
    ready: !enabled || !!state && state.revision === revision && !state.error && connection.connected,
    retry: () => { setState(null); setAttempt((value) => value + 1); } };
}
