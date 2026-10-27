import type { RewriteTarget } from "../../shared/rewrite.js";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { paintFeedback } from "../paint-feedback.js";
import { command } from "../transport.js";
import {
  clearSubmittedDraft,
  draftContent,
  getDraft,
} from "../drafts.js";
import { AppError, type Draft, type Scope } from "../../shared/protocol.js";
import { prepareDraftSubmission, completeDraftSubmission } from "../draft-persistence.js";
import type { DraftStamp } from "../../shared/drafts.js";
import { optimisticStart, optimisticState } from "./optimistic.js";
import { beginRecall, finishRecall, pendingRecall, reconcileInputs, beginResume, finishResume, pendingResume } from "./reconcile-inputs.js";
import { skillsInput } from "../../shared/skills.js";
import { messageLengthError } from "./message-limit.js";
import { resumeAttempt } from "./resume-state.js";
import { rejectSubmission, setSubmissionError, useSubmissionError } from "./submission-feedback.js";

// A request belongs to the captured session/draft even if its receipt arrives after navigation.
export function useSubmission(
  scope: Scope,
  state: {
    active: boolean;
    nested: boolean;
    selected: boolean;
    connected: boolean;
    runId?: string;
    task?: { id: string; parentSessionId: string };
  },
) {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const error = useSubmissionError(scope);
  const setError = (message: string) => setSubmissionError(scope, message);
  async function submit(op: "prompt" | "append" | "stop" | "continue" = "prompt", provided?: { draft: Draft; onStart: () => void; rewrite?: RewriteTarget }) {
    const continuing = op === "continue";
    const stopping = op === "stop";
    if (
      inFlight.current ||
      !state.connected ||
      (!stopping && !state.active && !state.selected)
    )
      return;
    if (continuing && pendingResume(scope, state.runId)) {
      void reconcileInputs(scope).catch(() => {});
      return;
    }
    if (provided?.rewrite && state.active) {
      setError("请先停止此会话及活动子任务，再修改并重新发送。");
      return;
    }
    const current = provided?.draft ?? getDraft(scope);
    if (!stopping && !continuing) {
      const lengthError = messageLengthError(current.text);
      if (lengthError) { setError(lengthError); return; }
      try { skillsInput(current.skills); }
      catch (error) { setError((error as Error).message); return; }
    }
    if (!stopping && !continuing && !current.text.trim() && !current.attachment && !current.attachments?.length && !current.images?.length && !current.skills?.length) return;
    const requestId = crypto.randomUUID();
    if (continuing) {
      if (state.active || !state.runId) return;
      let begun = false;
      flushSync(() => { begun = beginResume(scope, requestId, state.runId); });
      if (!begun) return;
    }
    inFlight.current = true;
    setBusy(true);
    setError("");
    const captured = draftContent(current);
    let stamp: DraftStamp | undefined;
    let started = false;
    try {
      if (!stopping && !continuing) {
        if (!provided) stamp = prepareDraftSubmission(scope, captured, requestId);
        optimisticStart(scope, requestId, captured, state.active, provided?.rewrite);
        started = true;
        if (provided) provided.onStart();
        else clearSubmittedDraft(scope, captured, false);
        // Local feedback is independent of admission/authentication/worker startup.
        // Yield naturally instead of forcing a synchronous render of the thread.
        await paintFeedback();
      }
      const task = stopping && state.nested ? state.task : undefined;
      const receipt = await command<{ runId?: string; inputId?: string }>(
        continuing ? "agent.resume" : stopping ? (task ? "task.cancel" : "agent.stop") : "prompt",
        continuing ? { expectedRunId: state.runId } : stopping
          ? (task ? { taskId: task.id } : { runId: state.runId })
          : { ...captured, ...(provided?.rewrite ? { rewrite: provided.rewrite } : {}), ...(stamp ? { draftStamp: stamp } : {}), ...(state.nested || state.active ? { mode: "steer" } : {}) },
        task ? { ...scope, sessionId: task.parentSessionId } : scope,
        requestId,
      );
      if (stamp) completeDraftSubmission(scope, stamp);
      if (continuing) finishResume(scope, requestId, true);
      else if (!stopping) optimisticState(scope, requestId, "accepted", receipt.inputId ?? receipt.runId, receipt.inputId ? true : receipt.runId ? false : undefined);
    } catch (e) {
      if (continuing) {
        const attempt = resumeAttempt(scope);
        if (attempt?.requestId !== requestId || attempt.accepted) return;
        if ((e as AppError).code === "UNCERTAIN") {
          void reconcileInputs(scope).catch(() => {});
        } else {
          finishResume(scope, requestId);
          setError((e as Error).message);
        }
      } else if (stopping || !started) setError((e as Error).message);
      else if ((e as AppError).code === "UNCERTAIN") {
        optimisticState(scope, requestId, "uncertain");
        void reconcileInputs(scope).catch(() => {});
      } else rejectSubmission(scope, requestId, (e as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function recall() {
    if (inFlight.current || !state.connected) return false;
    if (pendingRecall(scope)) {
      setError("撤回结果尚未确认，正在读取原回执；不会再次撤回或重发。");
      void reconcileInputs(scope).catch(() => {});
      return false;
    }
    inFlight.current = true;
    setBusy(true);
    setError("");
    const requestId = crypto.randomUUID();
    beginRecall(scope, requestId);
    try {
      const data = await command<{ drafts: Draft[]; ids?: string[] }>("agent.recall", {}, scope, requestId);
      finishRecall(scope, requestId, data);
      const { drafts } = data;
      if (!drafts.length) setError("没有可撤回的排队内容；已执行的输入不会撤回。");
      return drafts.length > 0;
    } catch (e) {
      if ((e as AppError).code !== "UNCERTAIN") finishRecall(scope, requestId);
      setError((e as AppError).code === "UNCERTAIN" ? "撤回结果未确认；将只读取原回执，不会再次执行。" : (e as Error).message);
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return { busy, error, setError, submit, recall };
}
