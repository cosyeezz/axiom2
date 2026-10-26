import { useSyncExternalStore } from "react";
import { scopeKey, type Scope } from "../../shared/protocol.js";

type ResumeAttempt = { requestId: string; expectedRunId?: string; accepted: boolean };
// Keep accepted attempts hidden until a different run is observed, even if its snapshot is late.
const attempts = new Map<string, ResumeAttempt>();
const listeners = new Map<string, Set<() => void>>();
const emit = (key: string) => listeners.get(key)?.forEach((listener) => listener());
export function resumeAttempt(scope: Scope) { return attempts.get(scopeKey(scope)); }
export function pendingResume(scope: Scope, runId?: string) {
  const attempt = resumeAttempt(scope);
  return !!attempt && !attempt.accepted && (!runId || !attempt.expectedRunId || attempt.expectedRunId === runId);
}
export function beginResume(scope: Scope, requestId: string, expectedRunId?: string) {
  const key = scopeKey(scope), current = attempts.get(key);
  if (current && (pendingResume(scope, expectedRunId) || expectedRunId && current.expectedRunId === expectedRunId)) return false;
  attempts.set(key, { requestId, expectedRunId, accepted: false });
  emit(key);
  return true;
}
export function finishResume(scope: Scope, requestId: string, accepted = false) {
  const key = scopeKey(scope), current = attempts.get(key);
  if (current?.requestId !== requestId || current.accepted) return;
  if (accepted) attempts.set(key, { ...current, accepted: true });
  else attempts.delete(key);
  emit(key);
}
export function clearResume(scope: Scope) {
  const key = scopeKey(scope);
  if (attempts.delete(key)) emit(key);
}
export function useResumeAttempt(scope: Scope) {
  const key = scopeKey(scope);
  return useSyncExternalStore((listener) => {
    const set = listeners.get(key) ?? new Set();
    listeners.set(key, set); set.add(listener);
    return () => { set.delete(listener); if (!set.size) listeners.delete(key); };
  }, () => attempts.get(key), () => undefined);
}
