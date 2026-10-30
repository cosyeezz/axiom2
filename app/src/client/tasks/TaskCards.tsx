import { createContext, memo, useContext, useEffect, useRef, useState } from "react";
import { type ChatMessage } from "../../shared/agent.js";
import { useThreadMessage } from "../chat/OriginalConversation.js";
import { Icon } from "../components.js";
import { taskCallPreview, toolPreview, type ToolCall } from "../chat/tool-summary.js";
import { callObject, taskCallLabel, taskCallStatus } from "./task-call.js";
import "../styles/task-calls.css";
import { useTaskAnchorWindow } from "./TaskWindowProvider.js";
import type { Scope } from "../../shared/protocol.js";
import {
  taskActive,
  taskLabels,
  type Task,
} from "../../shared/tasks.js";
export const OpenTask = createContext<(id: string) => void>(() => {});
export function TaskState({ task, iconOnly = false }: { task: { status: Task["status"] | null; summaryDeadlineAt?: number | null }; iconOnly?: boolean }) {
  const state =
    task.status === "completed"
      ? "completed"
      : ["failed", "interrupted"].includes(task.status ?? "")
        ? "failed"
        : task.status === "cancelled" ? "stopped" : task.status === "queued" ? "waiting" : task.status !== null && taskActive(task.status)
          ? "running"
          : "waiting";
  const label = task.summaryDeadlineAt && ["starting", "running"].includes(task.status ?? "") ? "正在总结" : task.status === null ? "状态待确认" : taskLabels[task.status];
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
  const window = useTaskAnchorWindow(scope, call.id);
  const [navigationError, setNavigationError] = useState("");
  const lifetime = useRef(0);
  useEffect(() => { const next = ++lifetime.current; return () => { if (lifetime.current === next) lifetime.current++; }; }, [scope.workspaceId, scope.sessionId, call.id]);
  const definitions = taskCallPreview(call)?.titles ?? [];
  const status = taskCallStatus(result, message);
  const label = taskCallLabel("delegate", status, callObject(result?.text ?? ""));
  const counts = window.page?.counts;
  const total = counts?.total;
  const failed = counts ? counts.failed + counts.interrupted : 0;
  const batchLabel = counts ? `${counts.completed} / ${counts.total} 已完成${failed ? ` · ${failed} 失败或中断` : ""}${counts.cancelled ? ` · ${counts.cancelled} 已停止` : ""}${counts.unknown ? ` · ${counts.unknown} 状态待确认` : ""} · 本次委派成员的执行状态${window.current ? "" : "（正在同步）"}` : "正在读取任务状态";
  const showFeedback = status === "failed" || status === "cancelled" || !window.rows.length;
  const feedback = status === "failed" ? `委派失败 · ${toolPreview(result)}` : status === "completed" && total === 0 ? "委派已受理，等待任务记录同步" : status === "cancelled" ? label : "";
  return (
    <section className="subagents delegation-card" data-tool="delegate" data-status={showFeedback ? status : "completed"} aria-label="子代理协作">
      <header className="subagents-head">
        <Icon name="subagent-identity" className="subagent-identity-icon" role="img" aria-hidden={undefined} aria-label={`子 Agent · ${batchLabel}`} data-tooltip={batchLabel} />
        <strong>子代理协作</strong>
      </header>
      {showFeedback && <div className="delegation-pending">
        {(window.rows.length ? ["委派回执"] : definitions.length ? definitions : ["准备子任务"]).map((description, index) => <div className="delegation-pending-item" key={index} aria-label={feedback ? `${description} · ${feedback}` : description} data-tooltip={feedback ? `${description} · ${feedback}` : description}>
          <p>{description}</p>
          {feedback && <span className="task-operation-status" role={status === "failed" ? "alert" : "status"}>{feedback}</span>}
        </div>)}
      </div>}
      {window.rows.map(({ task: t, revision }) => {
        const title = `${t.title?.text || "子任务"}${t.title && !t.title.complete ? "…" : ""}`;
        const stale = !window.current || revision !== window.page?.revision;
        return <div className="subagent-card" key={t.taskKey} data-task-key={t.taskKey} aria-busy={stale}>
          <button type="button" className="subagent" data-status={t.hasError || t.status === "interrupted" ? "failed" : t.status ?? "unknown"}
            aria-haspopup="dialog" aria-label={`打开子会话：${title}${stale ? " · 状态待同步" : ""}`}
            onClick={async () => {
              const owner = lifetime.current; setNavigationError("");
              try { const id = await window.target(t.taskKey); if (owner === lifetime.current) open(id); }
              catch (error) { if (owner === lifetime.current) setNavigationError((error as Error).message); }
            }}>
            <span className="agent-identity" data-tooltip={`${title} · ${t.results.total} 次交付${stale ? " · 状态待同步" : ""}`}>
              <strong>{title}</strong>
              {t.hasError && <span className="task-operation-status" role="alert">任务执行异常，打开子会话查看详情</span>}
            </span>
            <TaskState task={t} iconOnly /><Icon className="agent-open" name="subagent-open" />
          </button>
        </div>;
      })}
      {window.previous !== null && <button type="button" className="task-open-link" disabled={window.loading || !window.current} onClick={() => void window.more()}>加载更早的子任务</button>}
      {window.loading && <p role="status">正在同步任务…</p>}
      {(window.error || navigationError) && <p role="alert">{navigationError || window.error} <button type="button" className="task-open-link" onClick={() => { setNavigationError(""); void window.retry(); }}>重试</button></p>}
    </section>
  );
});
