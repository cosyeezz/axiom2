import { useSyncExternalStore } from "react";
import {
  scopeKey,
  type Draft,
  type Scope,
} from "../shared/protocol.js";

// Synchronous page cache; the persistence adapter saves changes without blocking input.
let persist: ((scope: Scope, draft: Draft) => void) | undefined;
export function onDraftChange(callback: typeof persist) { persist = callback; }
export function restoreDraft(scope: Scope, draft: Draft) {
  const key = scopeKey(scope);
  drafts.set(key, draftContent(draft));
  listeners.get(key)?.forEach((fn) => fn());
}
export type DraftContent = Draft;
const drafts = new Map<string, Draft>();
const listeners = new Map<string, Set<() => void>>();
export function getDraft(scope: Scope) {
  const key = scopeKey(scope);
  if (!drafts.has(key))
    drafts.set(key, { text: "", attachment: null, attachments: [], images: [] });
  return drafts.get(key)!;
}
export function updateDraft(
  scope: Scope,
  patch: Partial<DraftContent>,
  save = true,
) {
  const key = scopeKey(scope);
  drafts.set(key, { ...getDraft(scope), ...patch });
  listeners.get(key)?.forEach((fn) => fn());
  if (save) persist?.(scope, getDraft(scope));
}
export function draftContent(draft: DraftContent): DraftContent {
  return {
    text: draft.text,
    attachment: draft.attachment ? { ...draft.attachment } : null,
    attachments: (draft.attachments ?? []).map((attachment) => ({ ...attachment })),
    images: (draft.images ?? []).map((image) => ({ ...image })),
  };
}
export function clearSubmittedDraft(scope: Scope, submitted: DraftContent, save = true) {
  const current = getDraft(scope);
  if (JSON.stringify(draftContent(current)) === JSON.stringify(draftContent(submitted)))
    updateDraft(scope, { text: "", attachment: null, attachments: [], images: [] }, save);
}
export function useDraft(scope: Scope) {
  const key = scopeKey(scope);
  return useSyncExternalStore(
    (fn) => {
      const group = listeners.get(key) || new Set<() => void>();
      listeners.set(key, group);
      group.add(fn);
      return () => {
        group.delete(fn);
      };
    },
    () => getDraft(scope),
  );
}
