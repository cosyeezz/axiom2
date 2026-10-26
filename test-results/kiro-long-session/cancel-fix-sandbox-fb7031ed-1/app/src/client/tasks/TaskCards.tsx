import { createContext, memo, useContext } from "react";
import { type ChatMessage } from "../../shared/agent.js";
import { useThreadMessage } from "../chat/OriginalConversation.js";
import { Icon } from "../components.js";
import { taskCallPreview, toolPreview, type ToolCall } from "../chat/tool-summary.js";
import { callObject, taskCallLabel, taskCallStatus } from "./task-call.js";
import "../styles/task-calls.css";
import { useAnchorTasks } from "./task-selectors.js";
import type { Scope } from "../../shared/protocol.js";
import {
  taskActive,
  taskLabels,
  type Task,
} from "../../shared/tasks.js";
export const OpenTask = createContext<(id: string) => void>(() => {});
export function TaskState({ task, iconOnly = false }: { task: Task; iconOnly?: boolean }) {
  const state =
    task.status === "completed"
      ? "completed"
      : ["failed", "interrupted"].includes(task.status)
        ? "failed"
        : task.status === "cancelled" ? "stopped" : task.status === "queued" ? "waiting" : taskActive(task.status)
          ? "running"
          : "waiting";
  const label = task.summaryDeadlineAt && ["starting", "running"].includes(task.status) ? "正在总结" : taskLabels[task.status];
  return (
    <span className="agent-state" data-state={state} role={iconOnly ? "img" : undefined} aria-label={iconOnly ? label : undefined} data-tooltip={iconOnly ? label : undefined}>
      <Icon className={state === "running" ? "task-running-icon" : undefined} name={state === "running" ? "subagent-running" : state === "completed" ? "subagent-completed" : state === "failed" || state === "stopped" ? "subagent-ended" : "hourglass"} />
      {!iconOnly && <span className="agent-state-label">{label}</span>}
    </span>
  );
}
export const TaskCards = memo(function TaskCards({
  scope,
  call,
  message,
}: {
  scope: Scope;
  call: ToolCall;
  message: ChatMessage;
}) {
  const open = useContext(OpenTask);
  const result = useThreadMessage(scope, `tool-${call.id}`);
  const tasks = useAnchorTasks(scope, call.id);
  const definitions = taskCallPreview(call)?.titles ?? [];
  const status = taskCallStatus(result, message);
  const label = taskCallLabel("delegate", status, callObject(result?.text ?? ""));
  const completed = tasks.filter(t => t.status === "completed").length;
  const failed = tasks.filter(t => ["failed", "interrupted"].includes(t.status)).length;
  const cancelled = tasks.filter(t => t.status === "cancelled").length;
  const batchLabel = `${completed} / ${tasks.length} 已完成${failed ? ` · ${failed} 失败或中断` : ""}${cancelled ? ` · ${cancelled} 已停止` : ""} · 本次委派成员的最新执行状态`;
  const showFeedback = status === "failed" || status === "cancelled" || !tasks.length;
  const feedback = status === "failed" ? `委派失败 · ${toolPreview(result)}` : status === "completed" && !tasks.length ? "委派已受理，等待任务记录同步" : status === "cancelled" ? label : "";
  return (
    <section className="subagents delegation-card" data-tool="delegate" data-status={showFeedback ? status : "completed"} aria-label="子代理协作">
      <header className="subagents-head">
        <Icon name="subagent-identity" className="subagent-identity-icon" role="img" aria-hidden={undefined} aria-label={tasks.length ? `子 Agent · ${batchLabel}` : label} data-tooltip={tasks.length ? batchLabel : label} />
        <strong>子代理协作</strong>
      </header>
      {showFeedback && <div className="delegation-pending">
        {(tasks.length ? ["委派回执"] : definitions.length ? definitions : ["准备子任务"]).map((description, index) => <div className="delegation-pending-item" key={index} aria-label={feedback ? `${description} · ${feedback}` : description} data-tooltip={feedback ? `${description} · ${feedback}` : description}>
          <p>{description}</p>
          {feedback && <span className="task-operation-status" role={status === "failed" ? "alert" : "status"}>{feedback}</span>}
        </div>)}
      </div>}
      {tasks.map((t) => (
        <div className="subagent-card" key={t.id} data-task-id={t.id} data-result-ids={JSON.stringify(t.results.map((result) => result.id))}>
          <button
            type="button"
            className="subagent"
            data-status={t.error || t.status === "interrupted" ? "failed" : t.status}
            aria-haspopup="dialog"
            aria-label={`打开子会话：${t.title || "子任务"}${t.error ? ` · ${t.error}` : ""}`}
            onClick={() => open(t.id)}
          >
            <span className="agent-identity" data-tooltip={`${t.title || "子任务"} · ${t.results.length} 次交付${t.error ? ` · ${t.error}` : ""}`}>
              <strong data-tooltip={t.error ? `${t.title || "子任务"} · ${t.error}` : t.title || "子任务"}>{t.title || "子任务"}</strong>
              {t.error && <span className="task-operation-status" role="alert">{t.error}</span>}
            </span>
            <TaskState task={t} iconOnly />
            <Icon className="agent-open" name="subagent-open" />
          </button>
        </div>
      ))}
    </section>
  );
});
