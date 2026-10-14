import { command } from "../transport.js";
import { getDraft, updateDraft } from "../drafts.js";
import { scopeKey, type Draft, type Scope } from "../../shared/protocol.js";
import { optimisticRecall, optimisticRemove, optimisticState, pendingMessages } from "./optimistic.js";
import { mergeRecalledDrafts } from "./recall-drafts.js";
import { rejectSubmission, setSubmissionError } from "./submission-feedback.js";

// Unconfirmed user data is not an evictable display cache. Memory only; never replay commands.
const recalls = new Map<string, string>();
const resumes = new Map<string, string>();
export function pendingResume(scope: Scope) { return resumes.has(scopeKey(scope)); }
export function beginResume(scope: Scope, id: string) { resumes.set(scopeKey(scope), id); }
export function finishResume(scope: Scope, id: string) {
  if (resumes.get(scopeKey(scope)) === id) resumes.delete(scopeKey(scope));
}
const checking = new Set<string>();
export function clearInputRecovery(scope: Scope) { recalls.delete(scopeKey(scope)); resumes.delete(scopeKey(scope)); setSubmissionError(scope, ""); }
export function pendingRecall(scope: Scope) { return recalls.has(scopeKey(scope)); }
export function beginRecall(scope: Scope, id: string) { recalls.set(scopeKey(scope), id); }
export function finishRecall(scope: Scope, id: string, data?: { drafts: Draft[]; ids?: string[] }) {
  if (recalls.get(scopeKey(scope)) !== id) return;
  recalls.delete(scopeKey(scope));
  if (!data) return;
  optimisticRecall(scope, data.ids ?? []);
  if (data.drafts.length) updateDraft(scope, mergeRecalledDrafts(getDraft(scope), data.drafts));
}
export async function reconcileInputs(scope: Scope) {
  const key = scopeKey(scope);
  if (checking.has(key)) return;
  checking.add(key);
  try {
    const resume = resumes.get(key);
    if (resume) {
      const result = await command<{ status: string; data?: { message?: string } }>("request.get", { requestId: resume }, scope);
      if (result.status === "committed" || result.status === "failed") {
        finishResume(scope, resume);
        setSubmissionError(scope, result.status === "failed" ? result.data?.message ?? "重试未受理。" : "");
      }
    }
    const recall = recalls.get(key);
    if (recall) {
      const result = await command<{ status: string; data?: { drafts: Draft[]; ids?: string[] } }>("request.get", { requestId: recall }, scope);
      if (result.status === "committed") finishRecall(scope, recall, result.data);
      else if (result.status === "failed") finishRecall(scope, recall);
    }
    const pending = pendingMessages(scope);
    for (let start = 0; start < pending.length; start += 128) {
      const result = await command<{ id: string; consumed: boolean; active?: boolean; queued?: boolean; receipt: { status: string; data?: { inputId?: string; runId?: string; message?: string } } }[]>(
        "agent.inputs", { ids: pending.slice(start, start + 128).map((item) => item.id) }, scope);
      for (const item of result) {
        if (item.consumed) optimisticRemove(scope, item.id);
        else if (item.receipt.status === "committed") optimisticState(scope, item.id, item.active === false && !item.queued ? "uncertain" : "accepted", item.receipt.data?.inputId ?? item.receipt.data?.runId, !!item.receipt.data?.inputId);
        else if (item.receipt.status === "failed") rejectSubmission(scope, item.id, item.receipt.data?.message);
      }
    }
  } finally { checking.delete(key); }
}
