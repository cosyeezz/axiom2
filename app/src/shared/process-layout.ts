import type { ChatMessage } from "./agent.js";
import { taskToolName } from "./tasks.js";

export type CallReference = { messageId: string; callId: string };
export type ProcessEntry =
  | { kind: "thinking" | "notice"; id: string }
  | { kind: "tool"; id: string; call: CallReference };
export type ProcessSlice =
  | { kind: "task"; id: string; call: CallReference }
  | { kind: "body" | "notice"; id: string }
  | { kind: "process"; id: string; calls: CallReference[]; entries: ProcessEntry[] };

/** Prose separates segments; a segment keeps its identity as thoughts and calls arrive. */
export function processSlices(messages: ChatMessage[], thinkingOnlyIds: string[] = [], callsOnlyIds: string[] = []): ProcessSlice[] {
  const slices: ProcessSlice[] = [];
  let entries: ProcessEntry[] = [];
  const flush = () => {
    const calls = entries.flatMap(entry => "call" in entry ? [entry.call] : []);
    // A result notification alone is not another execution segment.
    if (entries.length && entries.every(entry => entry.kind === "notice")) {
      slices.push(...entries.map(entry => ({ kind: "notice" as const, id: entry.id })));
    } else if (entries.length) slices.push({ kind: "process", id: `${entries[0].kind}:${entries[0].id}`, calls, entries });
    entries = [];
  };
  for (const message of messages) {
    if (message.role === "toolResult") continue;
    if (message.taskNotice) {
      entries.push({ kind: "notice", id: message.id });
      continue;
    }
    if (message.compression || message.role !== "assistant") {
      flush();
      slices.push({ kind: "notice", id: message.id });
      continue;
    }
    if (!callsOnlyIds.includes(message.id)) {
      if (message.thinking || message.thinkingActive) entries.push({ kind: "thinking", id: message.id });
      if (!thinkingOnlyIds.includes(message.id) && (message.text.trim() || message.images?.length || message.error || message.status === "cancelled")) {
        flush();
        slices.push({ kind: "body", id: message.id });
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
