import { useCallback, useSyncExternalStore } from "react";
import { scopeKey, type Scope, type Draft } from "../../shared/protocol.js";
import type { ChatMessage } from "../../shared/agent.js";
export type PendingMessage = { id: string; draft: Draft; message: ChatMessage; inputId?: string; queued?: boolean; state: "sending" | "accepted" | "uncertain" | "failed"; confirmation?: string };
const entries = new Map<string, PendingMessage[]>();
const listeners = new Map<string, Set<() => void>>();
const empty: PendingMessage[] = [];
const observed = new Map<string, Set<string>>();
function update(scope: Scope, fn: (list: PendingMessage[]) => PendingMessage[]) {
  const key = scopeKey(scope);
  const next = fn(entries.get(key) ?? empty);
  if (next.length) entries.set(key, next); else entries.delete(key);
  listeners.get(key)?.forEach((fn) => fn());
}
export function optimisticStart(scope: Scope, id: string, draft: Draft, queued = false) {
  const images = (draft.attachments ?? (draft.attachment ? [draft.attachment] : []))
    .filter((a) => a.kind === "image").map((a) => ({ id: a.id!, name: a.name, path: a.path!, mimeType: "image/png" }));
  update(scope, (list) => [...list, { id, draft, queued, state: "sending", message: { id, role: "user", text: draft.text, images, skills: draft.skills } }]);
}
export function optimisticState(scope: Scope, id: string, state: PendingMessage["state"], inputId?: string, queued?: boolean) {
  const seen = observed.get(scopeKey(scope));
  update(scope, (list) => list.flatMap((item) => item.id !== id ? [item]
    : seen?.has(id) || (inputId && seen?.has(inputId)) ? [] : [{ ...item, state, inputId: inputId ?? item.inputId, queued: queued ?? item.queued }]));
}
export function optimisticConfirmation(scope: Scope, id: string, confirmation: string) {
  update(scope, (list) => list.map((item) => item.id === id ? { ...item, confirmation } : item));
}
export function pendingMessageStatus(item: PendingMessage, queued = false) {
  if (item.confirmation) return item.confirmation;
  return { sending: queued ? "正在排队…" : "正在发送…", accepted: queued ? "等待接收" : "已受理，等待进入会话", uncertain: "正在确认发送结果…", failed: "发送未完成，原消息已保留" }[item.state];
}
export function optimisticRemove(scope: Scope, id: string) { update(scope, (list) => list.filter((item) => item.id !== id)); }
export function reconcileOptimistic(scope: Scope, messages: ChatMessage[]) {
  const ids = observed.get(scopeKey(scope)) ?? new Set<string>();
  for (const id of messages.flatMap((m) => [m.id, ...(m.inputIds ?? [])])) ids.add(id);
  while (ids.size > 2048) ids.delete(ids.values().next().value!);
  observed.delete(scopeKey(scope)); observed.set(scopeKey(scope), ids);
  while (observed.size > 5) observed.delete(observed.keys().next().value!);
  const list = entries.get(scopeKey(scope));
  if (list?.some((item) => ids.has(item.id) || (item.inputId && ids.has(item.inputId))))
    update(scope, (items) => items.filter((item) => !ids.has(item.id) && !(item.inputId && ids.has(item.inputId))));
}
export function optimisticRecall(scope: Scope, ids: string[]) {
  const removed = new Set(ids);
  update(scope, (list) => list.filter((item) => !removed.has(item.id) && !(item.inputId && removed.has(item.inputId))));
}
export function pendingMessages(scope: Scope) { return entries.get(scopeKey(scope)) ?? empty; }
export function clearOptimistic(scope: Scope) {
  entries.delete(scopeKey(scope)); observed.delete(scopeKey(scope));
  listeners.get(scopeKey(scope))?.forEach((fn) => fn());
}
export function useOptimistic(scope: Scope | null) {
  const key = scope ? scopeKey(scope) : "";
  return useSyncExternalStore(useCallback((fn) => {
    const group = listeners.get(key) ?? new Set(); listeners.set(key, group); group.add(fn);
    return () => { group.delete(fn); if (!group.size) listeners.delete(key); };
  }, [key]), () => entries.get(key) ?? empty);
}
