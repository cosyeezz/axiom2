import { useCallback, useSyncExternalStore } from "react";
import { scopeKey, type Scope } from "../../shared/protocol.js";
import { optimisticConfirmation, optimisticState, pendingMessages } from "./optimistic.js";

// Submission feedback belongs to the originating session, including late receipts.
const errors = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();
export function submissionError(scope: Scope) { return errors.get(scopeKey(scope)) ?? ""; }
export function setSubmissionError(scope: Scope, error: string) {
  const key = scopeKey(scope);
  if (error) errors.set(key, error); else errors.delete(key);
  listeners.get(key)?.forEach((fn) => fn());
}
export function useSubmissionError(scope: Scope) {
  const key = scopeKey(scope);
  return useSyncExternalStore(useCallback((fn) => {
    const group = listeners.get(key) ?? new Set(); listeners.set(key, group); group.add(fn);
    return () => { group.delete(fn); if (!group.size) listeners.delete(key); };
  }, [key]), () => errors.get(key) ?? "");
}

// A rejection remains attached to the submitted message, never to the next draft.
// Consumed/removed inputs and duplicate failure receipts cannot recreate a submission.
export function rejectSubmission(scope: Scope, id: string, reason?: string) {
  const pending = pendingMessages(scope).find((item) => item.id === id);
  if (!pending || (pending.state === "failed" && pending.confirmation)) return;
  optimisticState(scope, id, "failed");
  optimisticConfirmation(scope, id, `发送未完成：${reason || "消息未能发送。"} 原消息已保留。`);
}
