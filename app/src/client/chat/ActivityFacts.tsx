import { useContext, useMemo, useSyncExternalStore } from "react";
import { messageScope, type ChatMessage } from "../../shared/agent.js";
import { OriginalMessages } from "./OriginalConversation.js";
import { emptyTasks, taskActive, tasksScope, taskToolName, type TaskList } from "../../shared/tasks.js";
import type { Scope } from "../../shared/protocol.js";
import { scopeSnapshot, subscribeScope } from "../transport.js";
import { taskCallStatus } from "../tasks/task-call.js";
import { tasksAt } from "../tasks/task-selectors.js";
import type { ActivityFact } from "./ToolActivity.js";
import { ordinaryToolStatus, toolPreview, toolSummary } from "./tool-summary.js";

export function messageFacts(message: ChatMessage, order: number, get: (id: string) => ChatMessage | null, list: TaskList): [string, ActivityFact][] {
  const entries: [string, ActivityFact][] = [[`message:${message.id}`, {
    name: message.thinkingActive && message.streaming ? "thinking" : !message.calls?.length && message.thinking ? "thought" : message.taskNotice ? "subagent" : "",
    icon: message.taskNotice ? "agents" : "thinking", target: message.taskNotice ? message.text : message.thinking ?? "",
    kind: message.taskNotice ? "notice" : "message", evidence: !!message.taskNotice || !!message.calls?.some((call) => taskToolName(call.name)), runId: message.runId, order: [order, -1],
    status: message.error || message.status === "failed" || message.taskNotice === "failed" || message.taskNotice === "interrupted" ? "failed" :
      message.status === "cancelled" || message.taskNotice === "cancelled" ? "cancelled" : message.streaming || message.status === "running" ? "running" : "completed",
  }]];
  for (const [callOrder, call] of (message.calls ?? []).entries()) {
    const result = get(`tool-${call.id}`), summary = toolSummary(call), task = taskToolName(call.name);
    let status = task ? taskCallStatus(result, message) : ordinaryToolStatus(message, result);
    const tasks = tasksAt(list, call.id);
    if (task && status === "completed" && tasks.length) status = tasks.some((item) => taskActive(item.status)) ? "running" :
      tasks.some((item) => item.status === "failed" || item.status === "interrupted") ? "failed" :
      tasks.some((item) => item.status === "cancelled") ? "cancelled" : "completed";
    entries.push([call.id, { name: summary.label, icon: summary.icon,
      target: task ? summary.target : `${summary.target}${summary.detail ? ` · ${summary.detail}` : ""}${status === "failed" ? ` · ${toolPreview(result)}` : ""}`,
      status, startedAt: result?.toolStartedAt, durationMs: result?.durationMs, order: [order, callOrder] }]);
  }
  return entries;
}

/** One initial facts snapshot. Hidden presentation components have no registration responsibility. */
export function useActivityFacts(scope: Scope, ids: string[], thinkingOnlyIds: string[] = [], callsOnlyIds: string[] = [], callIds?: string[]) {
  const original = useContext(OriginalMessages);
  const key = JSON.stringify([ids, thinkingOnlyIds, callsOnlyIds, callIds]);
  const store = useMemo(() => {
    const get = (id: string) => {
      const raw = scopeSnapshot<ChatMessage>(messageScope(scope, id)) ?? original?.get(id) ?? null;
      const message = raw && callIds && raw.calls ? { ...raw, calls: raw.calls.filter(call => callIds.includes(call.id)) } : raw;
      if (!message) return null;
      if (thinkingOnlyIds.includes(id)) return { ...message, calls: undefined,
        streaming: !!message.thinkingActive && !!message.streaming,
        status: message.thinkingActive && message.streaming ? "running" as const : "completed" as const, error: undefined };
      if (callsOnlyIds.includes(id)) return { ...message, thinking: undefined, thinkingActive: false };
      return message;
    };
    const tasks = () => scopeSnapshot<TaskList>(tasksScope(scope)) ?? emptyTasks;
    const chunks = ids.map((id, order) => { const message = get(id); return message ? messageFacts(message, order, get, tasks()) : []; });
    let snapshot = chunks.flat();
    return {
      get: () => snapshot,
      subscribe: (notify: () => void) => {
        let active = true, queued = false;
        const subscriptions = new Map<string, () => void>();
        const owners = new Map<string, Set<number>>();
        const dirty = new Set<number>();
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
              const next = message ? messageFacts(message, index, get, tasks()) : [];
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
        ids.forEach((id, order) => {
          watch(id, order);
          for (const call of get(id)?.calls ?? []) watch(`tool-${call.id}`, order);
          update(order);
        });
        let previousTasks = tasks();
        const offTasks = subscribeScope(tasksScope(scope), () => {
          const next = tasks();
          ids.forEach((id, order) => {
            if (get(id)?.calls?.some((call) => JSON.stringify(tasksAt(previousTasks, call.id)) !== JSON.stringify(tasksAt(next, call.id)))) update(order);
          });
          previousTasks = next;
        });
        return () => { active = false; subscriptions.forEach((off) => off()); offTasks(); };
      },
    };
  }, [scope.workspaceId, scope.sessionId, original, key]);
  return useSyncExternalStore(store.subscribe, store.get);
}
