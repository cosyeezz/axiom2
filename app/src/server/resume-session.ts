import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { AppError } from "../shared/protocol.js";

// A host control signal, never a user message or model instruction. The context
// hook excludes it before every request; context_edit also excludes it on reload.
export const resumeControlType = "axiom-resume";
export const isResumeControl = (message: AgentMessage) =>
  message.role === "custom" && message.customType === resumeControlType;

export function omitResumeControls(session: AgentSession) {
  let changed = false;
  for (const entry of session.sessionManager.buildSessionProjection().entries) {
    if (entry.messages.some(isResumeControl)) {
      session.sessionManager.appendContextEdit(entry.sourceEntry.id, null);
      changed = true;
    }
  }
  if (changed) session.refreshContext();
}

/** Resume through the public Session lifecycle, including native retry/settling. */
export async function resumeSession(session: AgentSession, requestId?: string) {
  if (!session.isIdle) throw new AppError("AGENT_BUSY", "会话仍在执行，暂时无法重试。");
  omitResumeControls(session);
  const entries = session.sessionManager.buildSessionProjection().entries;
  const tail = entries.findLast((entry) => entry.messages.some((message) => message.role !== "system"));
  const last = tail?.messages.at(-1);
  if (last?.role === "assistant" && ["error", "aborted", "length"].includes(last.stopReason)) {
    // Only the unanswered response is retried. Earlier tool calls/results remain
    // paired and are never executed by the host a second time.
    session.sessionManager.appendContextEdit(tail!.sourceEntry.id, null);
    session.refreshContext();
  }
  const messages = session.messages;
  const assistant = messages.findLast((message) => message.role === "assistant");
  if (assistant?.role === "assistant" && assistant.stopReason === "toolUse") {
    const results = new Set(messages.slice(messages.indexOf(assistant) + 1)
      .filter((message) => message.role === "toolResult").map((message) => message.toolCallId));
    // A killed worker may have performed a side effect without saving a result.
    // Complete only the protocol pairing, never fabricate success or rerun it.
    for (const call of assistant.content) {
      if (call.type !== "toolCall" || results.has(call.id)) continue;
      session.sessionManager.appendMessage({
        role: "toolResult", toolCallId: call.id, toolName: call.name,
        content: [{ type: "text", text: "上次执行在工具结果保存前中断，结果未知。请先核对实际状态，再决定后续操作，避免重复副作用。" }],
        isError: true, timestamp: Date.now(), details: { axiomInterrupted: true },
        ...("axiomRunId" in assistant ? { axiomRunId: assistant.axiomRunId } : {}),
      });
    }
    session.refreshContext();
  }
  const context = session.messages.filter((message) => message.role !== "system");
  if (!context.length || context.at(-1)?.role === "assistant")
    throw new AppError("NO_CONTINUATION", "没有可续接的未完成请求，请输入新的要求。");
  try {
    await session.sendCustomMessage({
      customType: resumeControlType, content: [], display: false,
      details: { axiomInput: requestId },
    }, { triggerTurn: true });
  } finally {
    // Also covers auth/preflight failure and cancellation before the context hook.
    omitResumeControls(session);
  }
}
