import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { thinkingLevels, type Selection, type SelectionChange, type Thinking } from "../shared/agent.js";

/** Use the model that actually answered; old transcripts may lack a thinking level. */
export function requestSelection(message: any, fallback?: Thinking): Selection | undefined {
  // pi stamps thinkingLevel on provider results, including HTTP errors. Its
  // locally synthesized failure has no such evidence and must not use fallback.
  if (message.thinkingLevel == null && ["error", "aborted"].includes(message.stopReason)) return;
  const thinking = message.thinkingLevel ?? fallback;
  if (message.role !== "assistant" || typeof message.provider !== "string" || !message.provider ||
      typeof message.model !== "string" || !message.model || !thinkingLevels.includes(thinking)) return;
  return { provider: message.provider, id: message.model, thinking };
}

/** Selection entries alone do not prove that a model request ever started. */
export function lastRequestSelection(entries: SessionEntry[]): Selection | undefined {
  let thinking: Thinking | undefined;
  let last: Selection | undefined;
  for (const entry of entries) {
    if (entry.type === "thinking_level_change" && thinkingLevels.includes(entry.thinkingLevel as Thinking))
      thinking = entry.thinkingLevel as Thinking;
    if (entry.type === "message" && entry.message.role === "assistant")
      last = requestSelection(entry.message, thinking) ?? last;
  }
  return last;
}

export function selectionChange(from: Selection | undefined, to: Selection | undefined): SelectionChange | undefined {
  if (!from || !to || (from.provider === to.provider && from.id === to.id && from.thinking === to.thinking)) return;
  return { from, to };
}
