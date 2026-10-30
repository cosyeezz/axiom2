import { memo, useContext, useEffect, useRef, useState } from "react";
import { type ChatMessage } from "../../shared/agent.js";
import { useThreadMessage } from "../chat/OriginalConversation.js";
import type { Scope } from "../../shared/protocol.js";
import { type TaskTool } from "../../shared/tasks.js";
import { Icon } from "../components.js";
import { useTaskInspection } from "./TaskWindowProvider.js";
import { taskCallPreview, toolPreview, type ToolCall } from "../chat/tool-summary.js";
import { ActivityExpanded } from "../chat/ToolActivity.js";
import { OpenTask } from "./TaskCards.js";
import { TaskCallDetails } from "./TaskCallDetails.js";
import { callObject, taskCallLabel, taskCallStatus } from "./task-call.js";
import "../styles/task-calls.css";

export const TaskOperation = memo(function TaskOperation({ scope, call, message, name }: {
  scope: Scope; call: ToolCall; message: ChatMessage; name: Exclude<TaskTool, "delegate">;
}) {
  const result = useThreadMessage(scope, `tool-${call.id}`);
  const openTask = useContext(OpenTask);
  const [open, setOpen] = useState(false);
  const groupOpen = useContext(ActivityExpanded);
  useEffect(() => { if (!groupOpen) setOpen(false); }, [groupOpen]);
  const input = callObject(call.input);
  const compact = taskCallPreview(call);
  const output = callObject(result?.text ?? "");
  const window = useTaskInspection(scope, compact?.taskId ?? "", name === "append" && typeof output?.inputId === "string" ? output.inputId : undefined, groupOpen && open);
  const { task, receipt } = window;
  const [navigationError, setNavigationError] = useState("");
  const lifetime = useRef(0);
  useEffect(() => { const next = ++lifetime.current; return () => { if (lifetime.current === next) lifetime.current++; }; }, [scope.workspaceId, scope.sessionId, call.id, compact?.taskId]);
  const status = receipt?.state === "failed" ? "failed" : taskCallStatus(result, message);
  const labels = { queued: "排队中", unknown: "待核实", accepted: "已接收", delivered: "已送达", failed: "追加失败", cancelled: "已撤销" };
  const receiptLabel = receipt ? receipt.state === null ? "待核实" : labels[receipt.state] : "待核实";
  const label = name === "append" && typeof output?.inputId === "string"
    ? `${receiptLabel}${receipt && !window.current ? "（待同步）" : ""}` : taskCallLabel(name, status, output);
  const action = name === "read_result" ? "子任务结果" : name === "append" ? input?.mode === "followUp" ? "追加追问" : "补充任务" : "停止子任务";
  const title = task?.title?.text ? `${task.title.text}${task.title.complete ? "" : "…"}` : "关联子任务";
  const error = status === "failed" ? receipt?.hasError ? "追加失败，展开查看详情" : toolPreview(result) : null;
  const preview = name === "append" ? compact?.summary ?? "补充任务" : name === "cancel_task" ? compact?.reason : undefined;
  return <section className="task-operation" data-tool={name} data-preview={!!preview} data-status={status} aria-busy={!!compact?.taskId && !window.current} aria-label={`${action}：${title}`}>
    <details open={groupOpen && open}>
      <summary data-tooltip={error ? `${label} · ${error}` : label} onClick={(event) => { event.preventDefault(); setOpen((value) => !value); }}>
        <span className="task-operation-icon"><Icon name={name === "read_result" ? "tool-result" : name === "append" ? "tool-append" : "tool-cancel"} /><span className="task-operation-status" role={error ? "alert" : "status"}>{error ? `${label} · ${error}` : label}</span></span>
        <span className="task-operation-heading" data-tooltip={error ? `${title} · ${error}` : title}><strong>{title}</strong>{preview && <span className="task-operation-target" data-tooltip={preview}>{preview}</span>}</span>
      </summary>
      {groupOpen && open && <>
        {error && <p className="task-call-error">{window.inputError?.text || error}</p>}
        {window.inputError?.next != null && <button type="button" className="task-open-link" disabled={window.loading || !window.current} onClick={() => void window.moreError()}>加载更多错误详情</button>}
        {window.loading && <p role="status">正在同步任务状态…</p>}
        {(window.error || navigationError) && <p role="alert">{navigationError || window.error} <button type="button" className="task-open-link" onClick={() => { setNavigationError(""); void window.retry(); }}>重试</button></p>}
        <TaskCallDetails scope={scope} call={call} result={result} message={message} />
        {task && <button type="button" className="task-open-link" aria-haspopup="dialog" onClick={async () => {
          const owner = lifetime.current; setNavigationError("");
          try { const id = await window.target(task.taskKey); if (owner === lifetime.current) openTask(id); }
          catch (error) { if (owner === lifetime.current) setNavigationError((error as Error).message); }
        }}>打开子会话<Icon name="subagent-open" /></button>}
      </>}
    </details>
  </section>;
});
