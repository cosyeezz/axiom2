import type { ChatMessage, ThreadIndex } from "./agent.js";

export function threadActivity(message: ChatMessage): boolean {
  if (message.taskNotice) return true;
  return message.role === "assistant" && !!message.calls?.length &&
    !message.error && message.status !== "failed" && message.status !== "cancelled";
}

export function threadThinking(message: ChatMessage): boolean {
  return message.role === "assistant" && !!(message.thinking || message.thinkingActive) &&
    !message.text.trim() && !message.images?.length && !message.calls?.length &&
    !message.compression && !message.taskNotice && !message.error &&
    message.status !== "failed" && message.status !== "cancelled";
}

export function threadGroups(messages: ChatMessage[]): NonNullable<ThreadIndex["groups"]> {
  const groups: NonNullable<ThreadIndex["groups"]> = [];
  for (const message of messages) {
    // Results stay with their calls, including asynchronous subagent operations.
    if (message.role === "toolResult") continue;
    const activity = threadActivity(message) || threadThinking(message);
    const previous = groups.at(-1);
    if (activity && previous?.activity) previous.ids.push(message.id);
    else groups.push({ id: message.id, ids: [message.id], activity });
  }
  return groups;
}
