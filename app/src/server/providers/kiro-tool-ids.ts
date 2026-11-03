import { createHash } from "node:crypto";
import type { Message } from "@earendil-works/pi-ai";
import { KiroChatError } from "./kiro-native-protocol.js";

/** Pi Responses stores call_id|item_id; KAS LOo expects only a tool call ID.
 * Decode at the SDK boundary, not in the SDK-independent native serializer.
 * Do not use transformMessages here: its synthetic results change interruption semantics.
 */
export function normalizeKiroToolIds(messages: Message[]): Message[] {
  const reserved = new Set<string>(), seen = new Set<string>(), candidates = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "toolResult") reserved.add(message.toolCallId); // An orphan must not become paired by renaming a call.
    if (message.role !== "assistant") continue;
    for (const block of message.content) {
      if (block.type !== "toolCall") continue;
      reserved.add(block.id);
      if (message.stopReason === "error" || message.stopReason === "aborted") continue;
      // Preserve the native core's duplicate-history rejection before any renaming.
      if (seen.has(block.id)) throw new KiroChatError("Kiro 历史工具调用标识无效或重复。");
      seen.add(block.id);
      if (message.provider === "kiro" || !["openai-responses", "openai-codex-responses"].includes(message.api)) continue;
      // Closed, bounded SDK composite form; other providers/opaque IDs stay untouched.
      const parts = /^([A-Za-z0-9_-]{1,64})\|([A-Za-z0-9_-]{1,64})$/.exec(block.id);
      if (parts && parts[0] === block.id) candidates.set(block.id, parts[1]);
    }
  }
  if (!candidates.size) return messages;
  const counts = new Map<string, number>();
  for (const id of candidates.values()) counts.set(id, (counts.get(id) ?? 0) + 1);
  const mapping = new Map<string, string>();
  // Reserve all usable call IDs before allocating fallbacks, independent of message order.
  for (const [original, id] of candidates) if (!reserved.has(id) && counts.get(id) === 1) {
    mapping.set(original, id); reserved.add(id);
  }
  for (const original of [...candidates.keys()].sort()) {
    if (mapping.has(original)) continue;
    // Collision-only local policy, not a claim about an official Kiro ID generator.
    const base = `call_${createHash("sha256").update(original).digest("hex").slice(0, 40)}`;
    let id = base, suffix = 0;
    while (reserved.has(id)) id = `${base}_${(++suffix).toString(36)}`;
    mapping.set(original, id); reserved.add(id);
  }
  return messages.map(message => {
    if (message.role === "assistant" && message.stopReason !== "error" && message.stopReason !== "aborted") {
      return { ...message, content: message.content.map(block => block.type === "toolCall" && mapping.has(block.id)
        ? { ...block, id: mapping.get(block.id)! } : block) };
    }
    if (message.role === "toolResult" && mapping.has(message.toolCallId)) return { ...message, toolCallId: mapping.get(message.toolCallId)! };
    return message;
  });
}
