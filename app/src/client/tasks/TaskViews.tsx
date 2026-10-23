import { FilePreviewHost } from "../chat/FilePreviewHost.js";
import { guardFileNavigation } from "../file-edit-guard.js";
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
    <OpenTask.Provider value={(next) => guardFileNavigation(() => open(next))}>
      {children}
      {id && scope && (
        <TaskWindow
          key={id}
          scope={scope}
          id={id}
          onClose={() => guardFileNavigation(() => open(""))}
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
  const [detailsVisited, setDetailsVisited] = useState(false), [loadingReport, setLoadingReport] = useState(false);
  const [readingRevision, setReadingRevision] = useState(0), [briefRevision, setBriefRevision] = useState(0);
  const reportRequest = useRef(0);
  useEffect(() => () => { reportRequest.current++; }, []);
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
          <Icon name="subagent-identity" />
          <strong title={task?.title || "子任务"}>{task?.title || "子任务"}</strong>
        </div>
        {task && <><TaskState task={task} /><button type="button" className="btn task-brief-link" onClick={() => setBriefRevision(value => value + 1)}>任务说明</button></>}
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
          <div className="container task-results" onClickCapture={() => setReadingRevision(value => value + 1)}>
            <details onToggle={(event) => { if (event.target === event.currentTarget && event.currentTarget.open) setDetailsVisited(true); }}>
              <summary>
                执行与交付 · {task.results.length} 次
              </summary>
              {detailsVisited && <>
              {task.error && <p className="execution-alert">{task.error}</p>}
              {task.results.map((r, i) => (
                <button
                  type="button"
                  className="btn"
                  key={r.id}
                  onClick={async () => {
                    const request = ++reportRequest.current;
                    setLoadingReport(true); setError(""); setReport(null);
                    try {
                      const value = await command<TaskResult>("task.result", { taskId: task.id, resultId: r.id }, scope);
                      if (request === reportRequest.current) setReport(value);
                    } catch (e) {
                      if (request === reportRequest.current) setError((e as Error).message);
                    } finally {
                      if (request === reportRequest.current) setLoadingReport(false);
                    }
                  }}
                >
                  第 {i + 1} 次 · {taskLabels[r.status]}
                </button>
              ))}
              {loadingReport && <p role="status">正在读取交付…</p>}
              {report && (
                <div>
                  {report.sideEffects && <p>{report.sideEffects}</p>}
                  <TaskReportBody key={report.id} scope={scope} report={report} />
                  {report.unfinished.length > 0 && <p>{report.unfinished.join("；")}</p>}
                </div>
              )}
              {error && <p role="alert">{error}</p>}</>}
            </details>
          </div>
          <FilePreviewHost key={`${child.workspaceId}:${child.sessionId}`}>
          <OriginalConversationProvider key={`${child.workspaceId}:${child.sessionId}`} scope={child}>
            <AgentThread scope={child} nested readingRevision={readingRevision} task={task} briefRevision={briefRevision} />
            {composer(child)}
          </OriginalConversationProvider>
          </FilePreviewHost>
        </section>
      )}
    </dialog>
  );
}
