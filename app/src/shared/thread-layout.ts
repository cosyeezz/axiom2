import type { ChatMessage, ThreadIndex } from "./agent.js";

export function threadActivity(message: ChatMessage): boolean {
  if (message.taskNotice) return true;
  return message.role === "assistant" && !message.compression && (
    !!message.calls?.length || !message.text.trim() && !message.images?.length &&
    !message.thinking && !message.thinkingActive &&
    !!(message.error || message.status === "failed" || message.status === "cancelled")
  );
}

export function threadThinking(message: ChatMessage): boolean {
  return message.role === "assistant" && !!(message.thinking || message.thinkingActive) &&
    !message.text.trim() && !message.images?.length && !message.calls?.length &&
    !message.compression && !message.taskNotice;
}

export function threadReplyThinking(message: ChatMessage): boolean {
  return message.role === "assistant" && !!(message.thinking || message.thinkingActive) &&
    !!(message.text.trim() || message.images?.length) && !message.calls?.length &&
    !message.compression && !message.taskNotice;
}

export function threadGroups(messages: ChatMessage[]): NonNullable<ThreadIndex["groups"]> {
  const groups: NonNullable<ThreadIndex["groups"]> = [];
  const changes = new Map<string, NonNullable<ChatMessage["selectionChange"]>>();
  const firstReplies = new Set<string>();
  const requests = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "user" && message.runId && !requests.has(message.runId))
      requests.set(message.runId, message.id);
    if (message.role !== "assistant") continue;
    if (message.selectionChange) {
      // Place the first response's change above its user request. Resume and
      // notification runs have no user message, so keep it above the response.
      const anchor = message.runId && !firstReplies.has(message.runId)
        ? requests.get(message.runId) ?? message.id : message.id;
      changes.set(anchor, message.selectionChange);
    }
    if (message.runId) firstReplies.add(message.runId);
  }
  for (const message of messages) {
    // Results stay with their calls, including asynchronous subagent operations.
    if (message.role === "toolResult") continue;
    const activity = threadActivity(message) || threadThinking(message);
    const previous = groups.at(-1);
    const selectionChange = changes.get(message.id);
    if (previous?.activity && !selectionChange && threadReplyThinking(message)) {
      // Keep the reply's thinking in the preceding process when body text arrives.
      previous.ids.push(message.id);
      (previous.thinkingOnlyIds ??= []).push(message.id);
      groups.push({ id: message.id, ids: [message.id], activity: false, hideThinking: true });
    } else if (activity && previous?.activity && !selectionChange) previous.ids.push(message.id);
    else groups.push({ id: message.id, ids: [message.id], activity, ...(selectionChange ? { selectionChange } : {}) });
  }
  return groups;
}
