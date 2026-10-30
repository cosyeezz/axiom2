import { FilePreviewHost } from "../chat/FilePreviewHost.js";
import { guardFileNavigation } from "../file-edit-guard.js";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../components.js";
import { AgentThread } from "../chat/AgentThread.js";
import { OriginalConversationProvider } from "../chat/OriginalConversation.js";
import { OpenTask, TaskState } from "./TaskCards.js";
import { TaskWindowProvider, useTaskInspection, useTaskWindowModel } from "./TaskWindowProvider.js";
import { WindowTaskBrief } from "./TaskBrief.js";
import { TaskResultPages } from "./TaskWindowContent.js";
import type { Scope } from "../../shared/protocol.js";
import type { WindowTaskTarget } from "../../shared/task-window.js";

export function TaskViews({ scope, children, composer }: {
  scope: Scope | null; children: ReactNode; composer: (scope: Scope) => ReactNode;
}) {
  const scopeKey = JSON.stringify(scope && [scope.workspaceId, scope.sessionId]);
  const [opened, open] = useState({ scopeKey: "", id: "" });
  return <TaskWindowProvider scope={scope}>
    <OpenTask.Provider value={id => guardFileNavigation(() => open({ scopeKey, id }))}>
      {children}
      {opened.id && opened.scopeKey === scopeKey && scope && <TaskWindow key={`${scopeKey}:${opened.id}`} scope={scope} id={opened.id}
        onClose={() => guardFileNavigation(() => open({ scopeKey, id: "" }))} composer={composer} />}
    </OpenTask.Provider>
  </TaskWindowProvider>;
}
function TaskWindow({ scope, id, onClose, composer }: {
  scope: Scope; id: string; onClose: () => void; composer: (scope: Scope) => ReactNode;
}) {
  const view = useTaskInspection(scope, id, undefined, false), reader = useTaskWindowModel(scope), task = view.task;
  const ref = useRef<HTMLDialogElement>(null);
  const [destination, setDestination] = useState<{ taskKey: string; target: WindowTaskTarget | null; error: string } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [readingRevision, setReadingRevision] = useState(0), [briefRevision, setBriefRevision] = useState(0);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    ref.current!.showModal();
    return () => trigger?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!reader || !view.current || !task) return;
    const controller = new AbortController();
    void reader.destination(task.taskKey, controller.signal).then(target => {
      if (!controller.signal.aborted) setDestination({ taskKey: task.taskKey, target, error: "" });
    }, error => {
      if (!controller.signal.aborted) setDestination({ taskKey: task.taskKey, target: null, error: (error as Error).message });
    });
    return () => controller.abort();
  }, [reader, view.current, view.revision, task?.taskKey]);
  // Unknown/missing metadata never closes a dialog. Child IDs come only from a
  // current-authorized target, not an ordinal, opaque key or a fabricated Task.
  const target = destination?.taskKey === task?.taskKey ? destination?.target : null;
  const child = target ? { workspaceId: scope.workspaceId, sessionId: target.sessionId } : null;
  const title = task?.title ? task.title.text + (task.title.complete ? "" : "…") : "子任务";
  return <dialog ref={ref} className="subagent-dialog" aria-label="子代理会话"
    onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => event.stopPropagation()}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
    }}>
    <header className="subagent-dialog-head">
      <div className="subagent-dialog-heading"><Icon name="subagent-identity" /><strong title={title}>{title}</strong></div>
      {task && <><TaskState task={task} /><button type="button" className="btn task-brief-link" onClick={() => setBriefRevision(value => value + 1)}>任务说明</button></>}
      <button className="icon-btn" type="button" autoFocus aria-label="关闭子代理会话，返回主对话" onClick={onClose}><Icon name="close" /></button>
    </header>
    {view.loading && <p role="status">正在读取任务…</p>}
    {!view.loading && !task && !view.error && <p role="status">当前窗口未找到任务。<button type="button" className="btn" onClick={() => void view.retry()}>刷新</button></p>}
    {task && !view.current && <p className="task-call-meta">任务信息待同步</p>}
    {(view.error || destination?.error) && <p role="alert">{view.error || destination?.error} <button type="button" className="btn" onClick={() => void view.retry()}>重试</button></p>}
    {task && view.revision && <section className="workspace">
      <div className="container task-results" onClickCapture={() => setReadingRevision(value => value + 1)}>
        <details onToggle={event => { if (event.target === event.currentTarget) setDetailsOpen(event.currentTarget.open); }}>
          <summary>执行与交付 · {task.results.total} 次</summary>
          {detailsOpen && <TaskResultPages key={task.taskKey} reader={reader} task={task} revision={view.revision} current={view.current} scope={scope} />}
        </details>
      </div>
      {child && target ? <FilePreviewHost key={`${child.workspaceId}:${child.sessionId}`}>
        <OriginalConversationProvider scope={child}>
          <AgentThread scope={child} nested readingRevision={readingRevision} briefRevision={briefRevision} initialTaskInputId={target.initialInputId}
            brief={<WindowTaskBrief reader={reader} task={task} reveal={briefRevision} />} />
          {composer(child)}
        </OriginalConversationProvider>
      </FilePreviewHost> : <WindowTaskBrief reader={reader} task={task} reveal={briefRevision} />}
    </section>}
  </dialog>;
}
