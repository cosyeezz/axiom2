import { useContext, useMemo, useSyncExternalStore } from "react";
import { messageScope, type ChatMessage } from "../../shared/agent.js";
import { OriginalMessages } from "./OriginalConversation.js";
import { taskActive, taskToolName, type TaskList } from "../../shared/tasks.js";
import type { TaskWindowCounts } from "../../shared/task-window.js";
import { useTaskWindowModel } from "../tasks/TaskWindowProvider.js";
import type { Scope } from "../../shared/protocol.js";
import { scopeSnapshot, subscribeScope } from "../transport.js";
import { taskCallStatus } from "../tasks/task-call.js";
import { tasksAt } from "../tasks/task-selectors.js";
import type { ActivityFact } from "./ToolActivity.js";
import { ordinaryToolStatus, toolPreview, toolSummary } from "./tool-summary.js";

export function messageFacts(message: ChatMessage, order: number, get: (id: string) => ChatMessage | null, list: TaskList | ((anchor: string) => TaskWindowCounts | null)): [string, ActivityFact][] {
  const entries: [string, ActivityFact][] = [[`message:${message.id}`, {
    name: message.thinkingActive && message.streaming ? "thinking" : !message.calls?.length && message.thinking ? "thought" : message.taskNotice ? "subagent" : "",
    icon: message.taskNotice ? "agents" : "thinking", target: message.taskNotice ? message.text : message.thinking ?? "",
    hasContent: !!(message.thinking?.trim() || (message.thinkingLength ?? 0) > (message.thinking?.length ?? 0) || message.text.trim() || message.images?.length || message.error || message.status === "cancelled"),
    kind: message.taskNotice ? "notice" : "message", evidence: !!message.taskNotice || !!message.calls?.some((call) => taskToolName(call.name)), runId: message.runId, origin: message.runOrigin, order: [order, -1],
    status: message.error || message.status === "failed" || message.taskNotice === "failed" || message.taskNotice === "interrupted" ? "failed" :
      message.status === "cancelled" || message.taskNotice === "cancelled" ? "cancelled" : message.streaming || message.status === "running" ? "running" : "completed",
  }]];
  for (const [callOrder, call] of (message.calls ?? []).entries()) {
    const result = get(`tool-${call.id}`), summary = toolSummary(call), task = taskToolName(call.name);
    let status = task ? taskCallStatus(result, message) : ordinaryToolStatus(message, result);
    if (task && status === "completed") {
      if (typeof list === "function") {
        const counts = list(call.id);
        status = !counts ? "unknown" : counts.queued + counts.starting + counts.running + counts.stopping > 0 ? "running" :
          counts.unknown > 0 ? "unknown" : counts.failed + counts.interrupted > 0 ? "failed" : counts.cancelled > 0 ? "cancelled" : "completed";
      } else {
        // Pure legacy callers still supply a complete TaskList. Production uses
        // whole-anchor window counts, never the loaded tail's task rows.
        const tasks = tasksAt(list, call.id);
        if (tasks.length) status = tasks.some(item => taskActive(item.status)) ? "running" :
          tasks.some(item => item.status === "failed" || item.status === "interrupted") ? "failed" :
          tasks.some(item => item.status === "cancelled") ? "cancelled" : "completed";
      }
    }
    entries.push([call.id, { name: summary.label, icon: summary.icon,
      target: task ? summary.target : `${summary.target}${summary.detail ? ` · ${summary.detail}` : ""}${status === "failed" ? ` · ${toolPreview(result)}` : ""}`,
      status, startedAt: result?.toolStartedAt, durationMs: result?.durationMs, order: [order, callOrder] }]);
  }
  return entries;
}

/** One initial facts snapshot. Hidden presentation components have no registration responsibility. */
export function useActivityFacts(scope: Scope, ids: string[], thinkingOnlyIds: string[] = [], callsOnlyIds: string[] = [], callIds?: string[]) {
  const original = useContext(OriginalMessages), taskModel = useTaskWindowModel(scope);
  const key = JSON.stringify([ids, thinkingOnlyIds, callsOnlyIds, callIds]);
  const store = useMemo(() => {
    const get = (id: string) => {
      const raw = scopeSnapshot<ChatMessage>(messageScope(scope, id)) ?? original?.get(id) ?? null;
      const message = raw && callIds && raw.calls ? { ...raw, calls: raw.calls.filter(call => callIds.includes(call.id)) } : raw;
      if (!message) return null;
      if (thinkingOnlyIds.includes(id)) return { ...message, calls: undefined, text: "", images: undefined,
        streaming: !!message.thinkingActive && !!message.streaming,
        status: message.thinkingActive && message.streaming ? "running" as const : "completed" as const, error: undefined };
      if (callsOnlyIds.includes(id)) return { ...message, thinking: undefined, thinkingLength: undefined, thinkingActive: false, text: "", images: undefined, error: undefined };
      return message;
    };
    const tasks = (anchor: string) => {
      const frame = taskModel?.snapshot(anchor);
      return frame?.current && !frame.loading && !frame.error ? frame.page?.counts ?? null : null;
    };
    const chunks = ids.map((id, order) => { const message = get(id); return message ? messageFacts(message, order, get, tasks) : []; });
    let snapshot = chunks.flat();
    return {
      get: () => snapshot,
      subscribe: (notify: () => void) => {
        let active = true, queued = false;
        const subscriptions = new Map<string, () => void>();
        const owners = new Map<string, Set<number>>();
        const dirty = new Set<number>();
        const anchors = new Map<string, { orders: Set<number>; signature: string; off: () => void }>();
        const syncAnchors = (order: number, message: ChatMessage | null) => {
          const next = new Set(message?.calls?.filter(call => taskToolName(call.name)).map(call => call.id));
          for (const [anchor, entry] of anchors) if (!next.has(anchor)) {
            entry.orders.delete(order);
            if (!entry.orders.size) { anchors.delete(anchor); entry.off(); }
          }
          for (const anchor of next) {
            const existing = anchors.get(anchor);
            if (existing) { existing.orders.add(order); continue; }
            const entry = { orders: new Set([order]), signature: JSON.stringify(tasks(anchor)), off: () => {} };
            anchors.set(anchor, entry); // acquire may synchronously notify.
            entry.off = taskModel?.acquire(anchor) ?? (() => {});
          }
        };
        const update = (order: number) => {
          dirty.add(order);
          if (queued) return;
          queued = true;
          queueMicrotask(() => {
            queued = false;
            if (!active) return;
            let changed = false;
            for (const index of dirty) {
              const message = get(ids[index]);
              syncAnchors(index, message);
              const next = message ? messageFacts(message, index, get, tasks) : [];
              if (JSON.stringify(next) !== JSON.stringify(chunks[index])) { chunks[index] = next; changed = true; }
              for (const call of message?.calls ?? []) watch(`tool-${call.id}`, index);
            }
            dirty.clear();
            if (changed) { snapshot = chunks.flat(); notify(); }
          });
        };
        const watch = (id: string, order: number) => {
          let targets = owners.get(id);
          if (targets) { targets.add(order); return; }
          owners.set(id, targets = new Set([order]));
          const change = () => { for (const target of owners.get(id) ?? []) update(target); };
          const off = subscribeScope(messageScope(scope, id), change), offOriginal = original?.subscribeMessage(id, change);
          subscriptions.set(id, () => { off(); offOriginal?.(); });
        };
        const offTasks = taskModel?.subscribe(() => {
          for (const [anchor, entry] of anchors) {
            const signature = JSON.stringify(tasks(anchor));
            if (entry.signature === signature) continue;
            entry.signature = signature;
            for (const order of entry.orders) update(order);
          }
        });
        ids.forEach((id, order) => {
          watch(id, order);
          for (const call of get(id)?.calls ?? []) watch(`tool-${call.id}`, order);
          update(order);
        });
        return () => {
          active = false; subscriptions.forEach(off => off()); offTasks?.();
          anchors.forEach(entry => entry.off()); anchors.clear();
        };
      },
    };
  }, [scope.workspaceId, scope.sessionId, original, key, taskModel]);
  return useSyncExternalStore(store.subscribe, store.get);
}
