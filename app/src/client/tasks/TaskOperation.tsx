import { memo, useContext, useEffect, useState } from "react";
import { messageScope, type ChatMessage } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
import { emptyTasks, tasksScope, type TaskTool } from "../../shared/tasks.js";
import { Icon } from "../components.js";
import { useScope } from "../transport.js";
import { compactText, toolPreview, type ToolCall } from "../chat/tool-summary.js";
import { ActivityExpanded } from "../chat/ToolActivity.js";
import { OpenTask } from "./TaskCards.js";
import { TaskCallDetails } from "./TaskCallDetails.js";
import { callObject, taskCallLabel, taskCallStatus } from "./task-call.js";
import "../styles/task-calls.css";

export const TaskOperation = memo(function TaskOperation({ scope, call, message, name }: {
  scope: Scope; call: ToolCall; message: ChatMessage; name: Exclude<TaskTool, "delegate">;
}) {
  const result = useScope<ChatMessage | null>(messageScope(scope, `tool-${call.id}`), null);
  const list = useScope(tasksScope(scope), emptyTasks);
  const openTask = useContext(OpenTask);
  const [open, setOpen] = useState(false);
  const groupOpen = useContext(ActivityExpanded);
  useEffect(() => { if (!groupOpen) setOpen(false); }, [groupOpen]);
  const input = callObject(call.input);
  const task = list.tasks.find((item) => item.id === input?.taskId);
  const status = taskCallStatus(result, message);
  const label = taskCallLabel(name, status, callObject(result?.text ?? ""));
  const title = name === "read_result" ? "子任务结果" : name === "append" ? input?.mode === "followUp" ? "追加追问" : "补充任务" : "停止子任务";
  const content = name === "append" ? input?.text : name === "cancel_task" ? input?.reason : null;
  return <section className="task-operation" data-tool={name} data-status={status} aria-label={title}>
    <details open={groupOpen && open}>
      <summary onClick={(event) => { event.preventDefault(); setOpen((value) => !value); }}>
        <span className="task-operation-icon" aria-hidden="true"><Icon name={name === "read_result" ? "tool-result" : name === "append" ? "tool-append" : "tool-cancel"} /></span>
        <span className="task-operation-heading"><strong>{title}</strong><span className="task-operation-target" title={task?.description}>{task ? compactText(task.description, 100) : "关联子任务"}</span></span>
        <span className="task-operation-status" role="status">{status === "running" && <span className="execution-pulse" aria-hidden="true" />}{label}</span>
        <span className="task-operation-action">{open ? "收起" : name === "read_result" && status === "completed" ? "查看结果" : "详情"}</span>
        <span className="task-operation-chevron" aria-hidden="true"><Icon name="chevron" /></span>
      </summary>
      {groupOpen && open && <>
        <TaskCallDetails scope={scope} call={call} result={result} message={message} />
        {task && <button type="button" className="task-open-link" aria-haspopup="dialog" onClick={() => openTask(task.id)}>打开子会话<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6m0-6-9 9M10 5H5v14h14v-5" /></svg></button>}
      </>}
    </details>
    {status === "failed" && <p className="task-call-error" role="alert">{toolPreview(result)}</p>}
    {status !== "failed" && !open && typeof content === "string" && content.trim() && <p className="task-operation-preview" title={content}>{compactText(content, 180)}</p>}
  </section>;
});
