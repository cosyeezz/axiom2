import type { SessionManager } from "@earendil-works/pi-coding-agent";

/** Preserve an appended input's ownership through edit/resend branches. Only
 * host IDs and rewrite links are inspected, never the wording of user messages.
 * Old targets may be off the active branch after a second rewrite; their bodies
 * must not be projected back into the visible conversation.
 */
export function continuationInputIds(manager: SessionManager): ReadonlySet<string> {
  const messages = new Set<string>(), requests = new Set<string>();
  for (const entry of manager.getEntries()) {
    if (entry.type === "custom_message" && entry.customType === "axiom-append") {
      messages.add(entry.id);
      const id = (entry.details as { axiomInput?: unknown } | undefined)?.axiomInput;
      if (typeof id === "string") messages.add(`input-${id}`);
    } else if (entry.type === "custom" && entry.customType === "axiom-rewrite") {
      const data = entry.data as { requestId?: unknown; messageId?: unknown } | undefined;
      if (typeof data?.requestId === "string" && typeof data.messageId === "string" && messages.has(data.messageId))
        requests.add(data.requestId);
    } else if (entry.type === "message") {
      const message = entry.message as { role: string; axiomId?: string; axiomInputIds?: string[]; axiomContinuation?: boolean };
      if (message.role === "user" && (message.axiomContinuation === true || message.axiomInputIds?.some(id => requests.has(id))))
        messages.add(message.axiomId ?? entry.id);
    }
  }
  return requests;
}
