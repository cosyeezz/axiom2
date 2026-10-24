import type { ChatMessage } from "./agent.js";
import { taskToolName } from "./tasks.js";

export type CallReference = { messageId: string; callId: string };
export type ProcessEntry =
  | { kind: "thinking" | "outcome"; id: string }
  | { kind: "tool"; id: string; call: CallReference };
export type ProcessSlice =
  | { kind: "task"; id: string; call: CallReference }
  | { kind: "body" | "notice"; id: string }
  | { kind: "process"; id: string; calls: CallReference[]; entries: ProcessEntry[] };

/** Prose and notices separate segments; thoughts and calls keep their segment identity. */
export function processSlices(messages: ChatMessage[], thinkingOnlyIds: string[] = [], callsOnlyIds: string[] = []): ProcessSlice[] {
  const slices: ProcessSlice[] = [];
  let entries: ProcessEntry[] = [];
  const flush = () => {
    const calls = entries.flatMap(entry => "call" in entry ? [entry.call] : []);
    if (entries.length) slices.push({ kind: "process", id: `${entries[0].kind}:${entries[0].id}`, calls, entries });
    entries = [];
  };
  for (const message of messages) {
    // Ignore legacy UI projections without splitting adjacent execution segments.
    if (message.role === "toolResult" || message.taskNotice) continue;
    if (message.compression || message.role !== "assistant") {
      flush();
      slices.push({ kind: "notice", id: message.id });
      continue;
    }
    if (!callsOnlyIds.includes(message.id)) {
      if (message.thinking || message.thinkingActive) entries.push({ kind: "thinking", id: message.id });
      if (!thinkingOnlyIds.includes(message.id)) {
        if (message.text.trim() || message.images?.length) {
          flush();
          slices.push({ kind: "body", id: message.id });
        } else if (message.error || message.status === "failed" || message.status === "cancelled") {
          // A terminal attempt is a detail of this process, not a second card.
          entries.push({ kind: "outcome", id: message.id });
        }
      }
    }
    if (thinkingOnlyIds.includes(message.id)) continue;
    for (const call of message.calls ?? []) {
      const reference = { messageId: message.id, callId: call.id };
      if (taskToolName(call.name)) {
        flush();
        slices.push({ kind: "task", id: call.id, call: reference });
      } else entries.push({ kind: "tool", id: call.id, call: reference });
    }
  }
  flush();
  return slices;
}
