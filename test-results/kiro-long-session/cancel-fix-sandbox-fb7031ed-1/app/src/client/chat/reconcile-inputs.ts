import { command } from "../transport.js";
import { getDraft, updateDraft } from "../drafts.js";
import { scopeKey, type Draft, type Scope } from "../../shared/protocol.js";
import { optimisticConfirmation, optimisticRecall, optimisticRemove, optimisticState, pendingMessages } from "./optimistic.js";
import { mergeRecalledDrafts } from "./recall-drafts.js";
import { rejectSubmission, setSubmissionError } from "./submission-feedback.js";

import { clearResume, finishResume, resumeAttempt } from "./resume-state.js";
export { beginResume, finishResume, pendingResume } from "./resume-state.js";

// Unconfirmed user data is not an evictable display cache. Memory only; never replay commands.
const recalls = new Map<string, string>();
const checking = new Set<string>();
export function clearInputRecovery(scope: Scope) { recalls.delete(scopeKey(scope)); clearResume(scope); setSubmissionError(scope, ""); }
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
    const attempt = resumeAttempt(scope);
    const resume = attempt && !attempt.accepted ? attempt.requestId : undefined;
    if (resume) {
      try {
        const result = await command<{ status: string; data?: { message?: string } }>("request.get", { requestId: resume }, scope);
        if (resumeAttempt(scope)?.requestId === resume && !resumeAttempt(scope)?.accepted &&
          (result.status === "committed" || result.status === "failed")) {
          finishResume(scope, resume, result.status === "committed");
          setSubmissionError(scope, result.status === "failed" ? result.data?.message ?? "重试未受理。" : "");
        }
      } catch { /* Resume reconciliation is silent; keep the original request guarded. */ }
    }
    const recall = recalls.get(key);
    if (recall) {
      try {
        const result = await command<{ status: string; data?: { drafts: Draft[]; ids?: string[] } }>("request.get", { requestId: recall }, scope);
        if (result.status === "committed") finishRecall(scope, recall, result.data);
        else if (result.status === "failed") finishRecall(scope, recall);
      } catch (error) { setSubmissionError(scope, `撤回结果核实失败：${(error as Error).message}`); }
    }
    const pending = pendingMessages(scope);
    for (let start = 0; start < pending.length; start += 128) {
      const batch = pending.slice(start, start + 128);
      try {
        const result = await command<{ id: string; consumed: boolean; active?: boolean; queued?: boolean; receipt: { status: string; data?: { inputId?: string; runId?: string; message?: string } } }[]>(
          "agent.inputs", { ids: batch.map((item) => item.id) }, scope);
        for (const item of result) {
          if (item.consumed) optimisticRemove(scope, item.id);
          else if (item.receipt.status === "failed") rejectSubmission(scope, item.id, item.receipt.data?.message);
          else if (batch.find((pending) => pending.id === item.id)?.state === "failed" && item.receipt.status !== "committed") continue;
          else {
            const unresolved = item.receipt.status === "uncertain" || item.receipt.status === "not_found" ||
              item.receipt.status === "committed" && item.active === false && !item.queued;
            if (unresolved) optimisticState(scope, item.id, "uncertain");
            if (item.receipt.status === "committed") optimisticState(scope, item.id, unresolved ? "uncertain" : "accepted", item.receipt.data?.inputId ?? item.receipt.data?.runId, !!item.receipt.data?.inputId);
            optimisticConfirmation(scope, item.id, unresolved
              ? `发送结果未确认，原文已保留；不会自动重发。${item.receipt.data?.message ?? ""}` : "");
          }
        }
      } catch (error) {
        for (const item of batch) if (item.state !== "failed") optimisticConfirmation(scope, item.id, `发送结果核实失败：${(error as Error).message} 原文已保留，将继续查询。`);
      }
    }
  } finally { checking.delete(key); }
}
