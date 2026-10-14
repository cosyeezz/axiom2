import { useCallback, useSyncExternalStore } from "react";
import { scopeKey, type Scope } from "../../shared/protocol.js";
import { getDraft, updateDraft } from "../drafts.js";
import { optimisticRemove, pendingMessages } from "./optimistic.js";
import { mergeRecalledDrafts } from "./recall-drafts.js";

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

// Only a confirmed rejection reaches here. Consumed/removed inputs cannot be restored twice.
export function rejectSubmission(scope: Scope, id: string, reason?: string) {
  const pending = pendingMessages(scope).find((item) => item.id === id);
  if (!pending) return;
  optimisticRemove(scope, id);
  updateDraft(scope, mergeRecalledDrafts(getDraft(scope), [pending.draft]));
  setSubmissionError(scope, `${reason || "消息未能发送。"} 内容已保留在输入框。`);
}
