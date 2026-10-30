import { useCallback, useSyncExternalStore } from "react";
import { attachmentsInput, imageLimits, scopeKey, type Scope } from "../../shared/protocol.js";
import { maxDraftTextLength } from "../../shared/drafts.js";
import { maxDraftSkills, skillsInput } from "../../shared/skills.js";
import { optimisticConfirmation, optimisticRemove, optimisticState, pendingMessages } from "./optimistic.js";
import { getDraft, updateDraft } from "../drafts.js";
import { getComposerEdit, startComposerEdit } from "./composer-edit.js";
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

// Both outcomes restore directly for editing; neither sends or changes a receipt.
// Unknown outcomes keep their non-blocking reminder in the composer.
export function restoreFailedSubmission(scope: Scope, id: string) {
  return restoreSubmission(scope, id, "failed");
}
export function restoreUncertainSubmission(scope: Scope, id: string) {
  const restored = restoreSubmission(scope, id, "uncertain");
  if (restored) setSubmissionError(scope, "原消息已恢复编辑，尚未发送。此前发送结果仍未确认，请核对会话记录，避免重复执行。");
  return restored;
}
function restoreSubmission(scope: Scope, id: string, state: "failed" | "uncertain") {
  const pending = pendingMessages(scope).find((item) => item.id === id);
  if (pending?.state !== state) return false;
  if (pending.rewrite) {
    if (getComposerEdit(scope)) {
      setSubmissionError(scope, "请先完成或取消当前修改，再恢复这条消息。");
      return false;
    }
    // Preserve the original revision: a changed branch must be rejected, never silently rebased or appended.
    startComposerEdit(scope, pending.rewrite, pending.draft);
    optimisticRemove(scope, id);
    setSubmissionError(scope, "");
    return true;
  }
  const restored = mergeRecalledDrafts(getDraft(scope), [pending.draft]);
  try {
    if (restored.text.length > maxDraftTextLength) throw Error("合并后的草稿文本过长");
    const images = restored.images ?? [];
    const imageBytes = images.reduce((total, image) => total + image.data.length * 3 / 4 - (image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0), 0);
    if (images.length > imageLimits.count || imageBytes > imageLimits.totalBytes) throw Error("合并后的图片数量或大小超限");
    attachmentsInput(restored.attachments, restored.attachment, images.length);
    skillsInput(restored.skills, maxDraftSkills);
  } catch (error) {
    setSubmissionError(scope, `暂时无法恢复编辑：${(error as Error).message}。请先处理当前草稿，再恢复这条消息；原消息已保留。`);
    return false;
  }
  updateDraft(scope, restored);
  optimisticRemove(scope, id);
  setSubmissionError(scope, "");
  return true;
}

// A rejection remains attached to the submitted message, never to the next draft.
// Consumed/removed inputs and duplicate failure receipts cannot recreate a submission.
export function rejectSubmission(scope: Scope, id: string, reason?: string) {
  const pending = pendingMessages(scope).find((item) => item.id === id);
  if (!pending || (pending.state === "failed" && pending.confirmation)) return;
  optimisticState(scope, id, "failed");
  optimisticConfirmation(scope, id, `发送未完成：${reason || "消息未能发送。"} 原消息已保留。`);
}
