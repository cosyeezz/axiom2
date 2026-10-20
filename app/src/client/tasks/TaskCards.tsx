import { createContext, memo, useContext } from "react";
import { type ChatMessage } from "../../shared/agent.js";
import { useThreadMessage } from "../chat/OriginalConversation.js";
import { Icon } from "../components.js";
import { toolPreview, type ToolCall } from "../chat/tool-summary.js";
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
  const input = callObject(call.input);
  const definitions = Array.isArray(input?.tasks) ? input.tasks.map((item: unknown) =>
    item && typeof item === "object" && "task" in item && typeof item.task === "string" ? item.task : "准备子任务") : [];
  const status = taskCallStatus(result, message);
  const label = taskCallLabel("delegate", status, callObject(result?.text ?? ""));
  const completed = tasks.filter(t => t.status === "completed").length;
  const failed = tasks.filter(t => ["failed", "interrupted"].includes(t.status)).length;
  const cancelled = tasks.filter(t => t.status === "cancelled").length;
  const batchLabel = `${completed} / ${tasks.length} 已完成${failed ? ` · ${failed} 失败或中断` : ""}${cancelled ? ` · ${cancelled} 已停止` : ""} · 本次委派成员的最新执行状态`;
  const showFeedback = status === "failed" || status === "cancelled" || !tasks.length;
  return (
    <section className="subagents delegation-card" data-tool="delegate" data-status={showFeedback ? status : "completed"} aria-label="子代理协作">
      <header className="subagents-head">
        <Icon name="subagent-identity" className="subagent-identity-icon" role="img" aria-hidden={undefined} aria-label={tasks.length ? `子 Agent · ${batchLabel}` : label} data-tooltip={tasks.length ? batchLabel : label} />
        <strong>子代理协作</strong>
      </header>
      {showFeedback && <div className="delegation-feedback">
        {status === "failed" ? <p className="task-call-error" role="alert">委派失败 · {toolPreview(result)}</p> : tasks.length > 0 ? <p className="task-call-meta">{label}</p> : null}
        {!tasks.length && <div className="delegation-pending">
          {(definitions.length ? definitions : ["准备子任务"]).map((description, index) => <p key={index} data-tooltip={description}>{description}</p>)}
          {status === "completed" && <span className="task-call-meta">委派已受理，等待任务记录同步</span>}
        </div>}
      </div>}
      {tasks.map((t) => (
        <div className="subagent-card" key={t.id} data-task-id={t.id} data-result-ids={JSON.stringify(t.results.map((result) => result.id))}>
          <button
            type="button"
            className="subagent"
            data-status={t.error || t.status === "interrupted" ? "failed" : t.status}
            aria-haspopup="dialog"
            aria-label={`打开子会话：${t.description}`}
            onClick={() => open(t.id)}
          >
            <span className="agent-identity" data-tooltip={`${t.description} · ${t.results.length} 次交付`}>
              <strong data-tooltip={t.description}>{t.description}</strong>
              {t.error && <span className="task-call-error" role="alert" data-tooltip={t.error}>{t.error}</span>}
            </span>
            <TaskState task={t} iconOnly />
            <Icon className="agent-open" name="subagent-open" />
          </button>
        </div>
      ))}
    </section>
  );
});
