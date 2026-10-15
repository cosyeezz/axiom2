import { useEffect, useRef, useState, type ReactNode } from "react";
import { command, useScope } from "../transport.js";
import { Icon } from "../components.js";
import { AgentThread } from "../chat/AgentThread.js";
import { OriginalConversationProvider } from "../chat/OriginalConversation.js";
import { TaskReportBody } from "./TaskReportBody.js";
import { OpenTask, TaskState } from "./TaskCards.js";
import type { Scope } from "../../shared/protocol.js";
import {
  emptyTasks,
  taskLabels,
  tasksScope,
  type TaskResult,
} from "../../shared/tasks.js";
export function TaskViews({
  scope,
  children,
  composer,
}: {
  scope: Scope | null;
  children: ReactNode;
  composer: (scope: Scope) => ReactNode;
}) {
  const [id, open] = useState("");
  return (
    <OpenTask.Provider value={open}>
      {children}
      {id && scope && (
        <TaskWindow
          key={id}
          scope={scope}
          id={id}
          onClose={() => open("")}
          composer={composer}
        />
      )}
    </OpenTask.Provider>
  );
}
function TaskWindow({
  scope,
  id,
  onClose,
  composer,
}: {
  scope: Scope;
  id: string;
  onClose: () => void;
  composer: (scope: Scope) => ReactNode;
}) {
  const list = useScope(tasksScope(scope), emptyTasks),
    task = list.tasks.find((t) => t.id === id),
    ref = useRef<HTMLDialogElement>(null);
  const [report, setReport] = useState<TaskResult | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement;
    ref.current!.showModal();
    return () => trigger?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!task) onClose();
  }, [!!task]);
  const child = task
    ? { workspaceId: scope.workspaceId, sessionId: task.sessionId }
    : null;
  return (
    <dialog
      ref={ref}
      className="subagent-dialog"
      aria-label="子代理会话"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <header className="subagent-dialog-head">
        <div className="subagent-dialog-heading">
          <span>子代理会话 · 独立上下文</span>
          <strong>{task?.description}</strong>
        </div>
        {task && <TaskState task={task} />}
        <button
          className="icon-btn"
          type="button"
          autoFocus
          aria-label="关闭子代理会话，返回主对话"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </header>
      {task && child && (
        <section className="workspace">
          <header className="topnav">
            <div className="title-block">
              <h1>{task.description}</h1>
              <div className="title-meta">
                工作预算 {task.budgets.workMs / 1000}s · 累计执行 {Math.round((task.elapsedMs ?? 0) / 1000)}s
              </div>
            </div>
          </header>
          <div className="container task-results">
            <details>
              <summary>
                执行与交付 · {task.results.length} 次
              </summary>
              {task.error && <p className="execution-alert">{task.error}</p>}
              {task.results.map((r, i) => (
                <button
                  type="button"
                  className="btn"
                  key={r.id}
                  onClick={async () => {
                    try {
                      setReport(
                        await command<TaskResult>(
                          "task.result",
                          { taskId: task.id, resultId: r.id },
                          scope,
                        ),
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  第 {i + 1} 次 · {taskLabels[r.status]}
                </button>
              ))}
              {report && (
                <div>
                  <p>{report.sideEffects}</p>
                  <TaskReportBody key={report.id} scope={scope} report={report} />
                  <p>{report.unfinished.join("；")}</p>
                </div>
              )}
              {error && <p role="alert">{error}</p>}
            </details>
          </div>
          <OriginalConversationProvider key={`${child.workspaceId}:${child.sessionId}`} scope={child}>
            <AgentThread scope={child} nested />
            {composer(child)}
          </OriginalConversationProvider>
        </section>
      )}
    </dialog>
  );
}
