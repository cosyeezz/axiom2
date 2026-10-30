import { useEffect, useRef, type RefObject } from "react";
import { scopeKey, type Scope, type Session } from "../../shared/protocol.js";
import { sessionListScope } from "../../shared/session-list.js";
import { command, isVisuallyRemoved, observeVisualActions, scopeAuthority, scopeOrder, useConnectionState, useScopeOrder, useVisualActions } from "../transport.js";
import { useSelectedSession, useSessionListAuthority } from "./useSelectedSession.js";

type Read = { workspaceId: string; controller: AbortController };

/** Recover only from current authoritative absence, never a missing title row. */
export function useSessionRecovery({ workspaceId, selected, preparing, navigation, recover, onError }: {
  workspaceId?: string;
  selected: Scope | null;
  preparing: boolean;
  navigation: RefObject<number>;
  recover: (scope: Scope, isCurrent: () => boolean) => void;
  onError: (message: string) => void;
}) {
  const connection = useConnectionState();
  const session = useSelectedSession(selected), list = useSessionListAuthority();
  const key = selected?.sessionId ? scopeKey(selected) : null;
  const selectedKey = selected ? scopeKey(selected) : null;
  const sessionOrder = useScopeOrder(key), listOrder = useScopeOrder(sessionListScope);
  // A foreign viewer keeps its own empty surface and first-session authority;
  // the sidebar workspace is only a fallback when there is no viewer at all.
  const target = selected?.workspaceId ?? workspaceId;
  const actions = useVisualActions();
  const deleting = actions.some(action => action.target.workspaceId === target &&
    (action.op === "session.delete" || action.op === "workspace.delete"));
  const read = useRef<Read | null>(null);
  const live = useRef({ target, selectedKey, preparing, recover, onError });
  live.current = { target, selectedKey, preparing, recover, onError };
  const navigationVersion = navigation.current;

  useEffect(() => observeVisualActions(({ action }) => {
    // Invalidate synchronously, before React cleanup, even when the user has a
    // delayed file/memory navigation confirmation open. Abort is only an aid.
    const pending = read.current;
    if (pending && action.target.workspaceId === pending.workspaceId &&
      (action.op === "session.delete" || action.op === "workspace.delete")) {
      read.current = null; pending.controller.abort();
    }
  }), []);

  useEffect(() => {
    if (!connection.connected || !target || !list || preparing || deleting || key && session !== null) return;
    const pending: Read = { workspaceId: target, controller: new AbortController() };
    read.current = pending;
    const isCurrent = () => read.current === pending && !pending.controller.signal.aborted &&
      navigation.current === navigationVersion && !live.current.preparing &&
      live.current.target === target && live.current.selectedKey === selectedKey &&
      scopeAuthority(sessionListScope) === list && scopeOrder(sessionListScope) === listOrder &&
      (!key || scopeAuthority(key) === null && scopeOrder(key) === sessionOrder);
    void command<Session | null>("session-list.first", {}, { workspaceId: target }, undefined, pending.controller.signal).then(first => {
      if (!isCurrent()) return;
      if (first && first.workspaceId !== target) throw new Error("会话恢复结果无效，请重试。");
      const canApply = () => isCurrent() && (!first || !isVisuallyRemoved(first));
      if (!canApply()) return;
      const next = { workspaceId: target, sessionId: first?.id ?? "" };
      // Do not write workspace.select for an unchanged empty surface: its global
      // invalidation would otherwise feed back into another identical recovery.
      if (selected?.workspaceId === next.workspaceId && (selected.sessionId || "") === next.sessionId) return;
      live.current.recover(next, canApply);
    }).catch(error => {
      if (isCurrent()) live.current.onError((error as Error).message);
    });
    // Keep identity valid after the RPC resolves: navigate() may delay applying
    // it behind a confirmation. Cleanup, not finally, ends this read's lease.
    return () => {
      if (read.current === pending) read.current = null;
      pending.controller.abort();
    };
  }, [target, selectedKey, key, preparing, deleting, session, sessionOrder, list, listOrder,
    connection.connected, connection.generation, navigationVersion]);
}
