import { useCallback, useSyncExternalStore } from "react";
import { scopeKey, type Draft, type Scope } from "../../shared/protocol.js";
import type { RewriteTarget } from "../../shared/rewrite.js";
import { draftContent, getDraft, updateDraft, useDraft } from "../drafts.js";

// Editing is a separate, page-local slot. The ordinary persisted draft is never overwritten.
export type ComposerEdit = { target: RewriteTarget; draft: Draft; token: number; revision: number };
const edits = new Map<string, ComposerEdit>();
const listeners = new Map<string, Set<() => void>>();
const loads = new Map<string, number>();
let revision = 0;
export function beginComposerEditLoad(scope: Scope) { const id = ++revision; loads.set(scopeKey(scope), id); return id; }
export function finishComposerEditLoad(scope: Scope, id: number, target: RewriteTarget, draft: Draft) {
  if (loads.get(scopeKey(scope)) !== id || getComposerEdit(scope)) return;
  startComposerEdit(scope, target, draft);
}
export function revealComposerEdit(scope: Scope) {
  const edit = getComposerEdit(scope);
  if (edit) { edits.set(scopeKey(scope), { ...edit, revision: ++revision }); notify(scope); }
}
function notify(scope: Scope) { listeners.get(scopeKey(scope))?.forEach(fn => fn()); }
export function getComposerEdit(scope: Scope) { return edits.get(scopeKey(scope)) ?? null; }
export function startComposerEdit(scope: Scope, target: RewriteTarget, draft: Draft) {
  const token = ++revision;
  edits.set(scopeKey(scope), { target, draft: draftContent(draft), token, revision: token });
  notify(scope);
}
export function cancelComposerEdit(scope: Scope) { edits.delete(scopeKey(scope)); notify(scope); }
function useEditSnapshot<T>(scope: Scope | null, snapshot: (key: string) => T) {
  const key = scope ? scopeKey(scope) : "";
  return useSyncExternalStore(useCallback(fn => {
    const group = listeners.get(key) ?? new Set(); listeners.set(key, group); group.add(fn);
    return () => { group.delete(fn); if (!group.size) listeners.delete(key); };
  }, [key]), () => snapshot(key));
}
export function useComposerEdit(scope: Scope | null) {
  return useEditSnapshot(scope, key => edits.get(key) ?? null);
}
// History only needs entry/reveal/cancel, not each character of the edit draft.
export function useComposerEditRevision(scope: Scope | null) {
  return useEditSnapshot(scope, key => edits.get(key)?.revision ?? 0);
}
export function getComposerDraft(scope: Scope) { return getComposerEdit(scope)?.draft ?? getDraft(scope); }
export function updateComposerDraft(scope: Scope, patch: Partial<Draft>) {
  const edit = getComposerEdit(scope);
  if (!edit) { updateDraft(scope, patch); return; }
  edits.set(scopeKey(scope), { ...edit, draft: { ...edit.draft, ...patch } });
  notify(scope);
}
export function captureComposerDraft(scope: Scope) {
  const captured = getComposerEdit(scope);
  return {
    get: () => captured ? getComposerEdit(scope)?.token === captured.token ? getComposerEdit(scope)!.draft : captured.draft : getDraft(scope),
    update: (patch: Partial<Draft>) => {
      if (!captured) updateDraft(scope, patch);
      else if (getComposerEdit(scope)?.token === captured.token) updateComposerDraft(scope, patch);
    },
  };
}
export function useComposerDraft(scope: Scope) {
  const draft = useDraft(scope), edit = useComposerEdit(scope);
  return edit?.draft ?? draft;
}
