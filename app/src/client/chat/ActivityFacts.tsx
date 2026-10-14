import { useContext, useEffect } from "react";
import { messageScope, type ChatMessage } from "../../shared/agent.js";
import { emptyTasks, taskActive, tasksScope } from "../../shared/tasks.js";
import type { Scope } from "../../shared/protocol.js";
import { useScope } from "../transport.js";
import { taskCallStatus } from "../tasks/task-call.js";
import { ActivityContext, type ActivityFact } from "./ToolActivity.js";
import { toolSummary, type ToolCall } from "./tool-summary.js";

export function useActivityFact(id: string, fact: ActivityFact) {
  const report = useContext(ActivityContext);
  useEffect(() => { report(id, fact); }, [report, id, fact.name, fact.icon, fact.target, fact.status, fact.kind, fact.order[0], fact.order[1]]);
  useEffect(() => () => report(id, null), [report, id]);
}

export function ActivityMessageFact({ message, order }: { message: ChatMessage; order: number }) {
  useActivityFact(`message:${message.id}`, {
    name: message.thinkingActive && message.streaming ? "thinking" : !message.calls?.length && message.thinking ? "thought" : message.taskNotice ? "subagent" : "",
    icon: message.taskNotice ? "agents" : "thinking", target: message.taskNotice ? message.text : message.thinkingActive && message.streaming ? "正在思考…" : "思考已完成",
    kind: message.taskNotice ? "notice" : "message", order: [order, -1],
    status: message.error || message.status === "failed" || message.taskNotice === "failed" || message.taskNotice === "interrupted" ? "failed" :
      message.status === "cancelled" || message.taskNotice === "cancelled" ? "cancelled" : message.streaming || message.status === "running" ? "running" : "completed",
  });
  return null;
}

export function ActivityTaskFact({ scope, call, message, order, callOrder }: {
  scope: Scope; call: ToolCall; message: ChatMessage; order: number; callOrder: number;
}) {
  const result = useScope<ChatMessage | null>(messageScope(scope, `tool-${call.id}`), null);
  const list = useScope(tasksScope(scope), emptyTasks);
  const tasks = list.tasks.filter(task => task.anchor === call.id);
  let status = taskCallStatus(result, message);
  if (status === "completed" && tasks.length) {
    status = tasks.some(task => taskActive(task.status)) ? "running" :
      tasks.some(task => task.status === "failed" || task.status === "interrupted") ? "failed" :
      tasks.some(task => task.status === "cancelled") ? "cancelled" : "completed";
  }
  const summary = toolSummary(call);
  useActivityFact(call.id, { name: summary.label, icon: summary.icon, target: summary.target, status, order: [order, callOrder] });
  return null;
}
