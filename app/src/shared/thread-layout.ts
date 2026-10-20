import type { ChatMessage, ThreadIndex } from "./agent.js";

export function threadEmpty(message: ChatMessage): boolean {
  return message.role === "assistant" && !message.text.trim() && !message.images?.length &&
    !message.thinking && !message.thinkingActive && !message.calls?.length &&
    !message.compression && !message.taskNotice && !message.error && !message.truncated &&
    message.status !== "failed" && message.status !== "cancelled";
}

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
  const byId = new Map(messages.map(message => [message.id, message]));
  const appendProcess = (message: ChatMessage, selectionChange?: ChatMessage["selectionChange"], part?: "thinking" | "calls") => {
    let group = groups.at(-1);
    const previousRun = group?.ids.map(id => byId.get(id)?.runId).findLast(id => !!id);
    if (!group?.activity || selectionChange || previousRun && message.runId && previousRun !== message.runId) {
      group = { id: `${part === "calls" ? "calls" : "process"}:${message.id}`, ids: [], activity: true, ...(selectionChange ? { selectionChange } : {}) };
      groups.push(group);
    }
    group.ids.push(message.id);
    if (part === "thinking") (group.thinkingOnlyIds ??= []).push(message.id);
    if (part === "calls") (group.callsOnlyIds ??= []).push(message.id);
  };
  for (const message of messages) {
    // Results stay with their calls, including asynchronous subagent operations.
    if (message.role === "toolResult") continue;
    const selectionChange = changes.get(message.id);
    // Invisible stream placeholders must not separate adjacent process cards.
    // Keep explicit selection notices even before their response has content.
    if (threadEmpty(message) && !selectionChange) continue;
    const body = message.role === "assistant" && !message.compression && !message.taskNotice &&
      !!(message.text.trim() || message.images?.length);
    const thinking = !!(message.thinking || message.thinkingActive);
    if (body) {
      // Native assistant turns produce thinking, narration, then calls. A body is
      // always a boundary, even when calls arrive later on the same message.
      if (thinking) appendProcess(message, selectionChange, "thinking");
      groups.push({ id: message.id, ids: [message.id], activity: false, ...(thinking || message.calls?.length ? { hideThinking: true } : {}),
        ...(!thinking && selectionChange ? { selectionChange } : {}) });
      if (message.calls?.length) appendProcess(message, undefined, "calls");
    } else if (threadActivity(message) || threadThinking(message)) appendProcess(message, selectionChange);
    else groups.push({ id: message.id, ids: [message.id], activity: false, ...(selectionChange ? { selectionChange } : {}) });
  }
  return foldFinalProcesses(groups, messages);
}

/** Keep live slices stable; only a confirmed answer moves narration into its process. */
function foldFinalProcesses(groups: NonNullable<ThreadIndex["groups"]>, messages: ChatMessage[]) {
  const byId = new Map(messages.map(message => [message.id, message]));
  const result: NonNullable<ThreadIndex["groups"]> = [];
  let start = 0, runId: string | undefined;
  for (const group of groups) {
    const message = byId.get(group.ids[0])!;
    const groupRun = group.ids.map(id => byId.get(id)?.runId).findLast(id => !!id);
    const boundary = message.role === "user" || message.compression ||
      message.role === "notice" && !message.taskNotice || group.selectionChange ||
      groupRun && runId && groupRun !== runId;
    if (boundary) start = result.length;
    if (groupRun) runId = groupRun;
    if (message.role === "user" || message.compression || message.role === "notice" && !message.taskNotice) {
      result.push(group); start = result.length; continue;
    }
    if (!group.activity && message.phase === "final_answer" && !message.calls?.length) {
      const preceding = result.splice(start);
      if (preceding.length) {
        const ids = [...new Set(preceding.flatMap(item => item.ids))];
        result.push({ id: `final-process:${ids[0]}`, ids, activity: true, folded: true,
          ...(ids.includes(message.id) ? { thinkingOnlyIds: [message.id] } : {}),
          ...(preceding[0].selectionChange ? { selectionChange: preceding[0].selectionChange } : {}) });
      }
      result.push(group); start = result.length;
    } else result.push(group);
  }
  return result;
}
