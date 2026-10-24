import type { ChatMessage, ThreadIndex } from "./agent.js";

/** Delivery navigation follows final-answer bodies, never process completion cards. */
export function threadDelivery(message: ChatMessage): boolean {
  return message.role === "assistant" && message.phase === "final_answer" && !message.streaming &&
    (!message.status || message.status === "completed") && !message.error && !message.calls?.length &&
    !message.compression && !message.taskNotice && !!(message.text.trim() || message.images?.length);
}

export function threadEmpty(message: ChatMessage): boolean {
  return message.role === "assistant" && !message.text.trim() && !message.images?.length &&
    !message.thinking && !message.thinkingActive && !message.calls?.length &&
    !message.compression && !message.taskNotice && !message.error && !message.truncated &&
    message.status !== "failed" && message.status !== "cancelled";
}

export function threadActivity(message: ChatMessage): boolean {
  if (message.taskNotice) return false;
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

export function threadGroups(messages: ChatMessage[], options: { archived?: boolean } = {}): NonNullable<ThreadIndex["groups"]> {
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
    if (message.role === "toolResult" || message.taskNotice) continue;
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
      groups.push({ id: message.id, ids: [message.id], activity: false, ...(threadDelivery(message) ? { delivery: true } : {}), ...(thinking || message.calls?.length ? { hideThinking: true } : {}),
        ...(!thinking && selectionChange ? { selectionChange } : {}) });
      if (message.calls?.length) appendProcess(message, undefined, "calls");
    } else if (threadActivity(message) || threadThinking(message)) appendProcess(message, selectionChange);
    else groups.push({ id: message.id, ids: [message.id], activity: false, ...(selectionChange ? { selectionChange } : {}) });
  }
  const folded = foldFinalProcesses(groups, messages);
  return mergeAdjacentProcesses(options.archived ? foldArchivedProcesses(folded, messages) : folded);
}

/** Status and run ownership belong to the contents, not to adjacent card boundaries.
 * Called within one history range; answers, users and visible selection notices
 * remain boundaries. Preserve each message's original rendering contribution.
 */
function mergeAdjacentProcesses(groups: NonNullable<ThreadIndex["groups"]>) {
  const result: NonNullable<ThreadIndex["groups"]> = [];
  let pending: NonNullable<ThreadIndex["groups"]> = [];
  const flush = () => {
    if (pending.length < 2) result.push(...pending);
    else {
      const contributions = new Map<string, { thinkingOnly: boolean; callsOnly: boolean }>();
      for (const part of pending) {
        const thinking = new Set(part.thinkingOnlyIds), calls = new Set(part.callsOnlyIds);
        for (const id of part.ids) {
          const prior = contributions.get(id);
          contributions.set(id, { thinkingOnly: thinking.has(id) && (prior?.thinkingOnly ?? true),
            callsOnly: calls.has(id) && (prior?.callsOnly ?? true) });
        }
      }
      const ids = [...contributions.keys()];
      const thinkingOnlyIds = ids.filter(id => contributions.get(id)!.thinkingOnly);
      const callsOnlyIds = ids.filter(id => contributions.get(id)!.callsOnly);
      result.push({ id: pending[0].id, ids, activity: true,
        ...(pending.some(part => part.folded) ? { folded: true } : {}),
        ...(pending[0].selectionChange ? { selectionChange: pending[0].selectionChange } : {}),
        ...(thinkingOnlyIds.length ? { thinkingOnlyIds } : {}),
        ...(callsOnlyIds.length ? { callsOnlyIds } : {}) });
    }
    pending = [];
  };
  for (const group of groups) {
    if (!group.activity || group.selectionChange) flush();
    if (group.activity) pending.push(group);
    else result.push(group);
  }
  flush();
  return result;
}

/** Archived fragments are settled, even when compaction preceded the answer.
 * Wrap adjacent narration and execution together; ProcessFlow retains their
 * original inner slices. Never borrow an answer or prose from another range.
 */
function foldArchivedProcesses(groups: NonNullable<ThreadIndex["groups"]>, messages: ChatMessage[]) {
  const byId = new Map(messages.map(message => [message.id, message]));
  const result: NonNullable<ThreadIndex["groups"]> = [];
  let pending: NonNullable<ThreadIndex["groups"]> = [], runId: string | undefined;
  const collect = (parts: NonNullable<ThreadIndex["groups"]>) => {
    const ids = [...new Set(parts.flatMap(group => group.ids))];
    result.push({ id: `final-process:${ids[0]}`, ids, activity: true, folded: true,
      ...(parts[0].selectionChange ? { selectionChange: parts[0].selectionChange } : {}) });
  };
  const flush = () => {
    if (pending.some(group => group.activity)) collect(pending);
    else for (const group of pending) {
      // Compaction can separate a commentary-only fragment from its eventual
      // delivery. Its explicit phase is sufficient process evidence; unrelated
      // unmarked prose must not be pulled into the same archive container.
      if (byId.get(group.ids[0])?.phase === "commentary") collect([group]);
      else result.push(group);
    }
    pending = []; runId = undefined;
  };
  for (const group of groups) {
    const message = byId.get(group.ids[0])!;
    const groupRun = group.ids.map(id => byId.get(id)?.runId).findLast(id => !!id);
    if (group.selectionChange || groupRun && runId && groupRun !== runId) flush();
    if (group.folded || message.role !== "assistant" || message.compression ||
      !group.activity && message.phase === "final_answer" && !message.calls?.length) {
      flush(); result.push(group); continue;
    }
    pending.push(group);
    if (groupRun) runId = groupRun;
  }
  flush();
  return result;
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
