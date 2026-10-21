import { memo, useContext, useEffect, useState } from "react";
import { type ChatMessage } from "../../shared/agent.js";
import { useThreadMessage } from "../chat/OriginalConversation.js";
import type { Scope } from "../../shared/protocol.js";
import { type TaskTool } from "../../shared/tasks.js";
import { Icon } from "../components.js";
import { useTask } from "./task-selectors.js";
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
  const task = useTask(scope, compact?.taskId ?? "");
  const output = callObject(result?.text ?? "");
  const receipt = name === "append" ? task?.inputs?.find((item) => item.inputId === output?.inputId) : undefined;
  const status = receipt?.state === "failed" ? "failed" : taskCallStatus(result, message);
  const labels = { queued: "排队中", unknown: "待核实", accepted: "已接收", delivered: "已送达", failed: "追加失败", cancelled: "已撤销" };
  const label = receipt ? labels[receipt.state] : taskCallLabel(name, status, output);
  const action = name === "read_result" ? "子任务结果" : name === "append" ? input?.mode === "followUp" ? "追加追问" : "补充任务" : "停止子任务";
  const title = task?.title || task?.description || "关联子任务";
  const error = status === "failed" ? receipt?.error || toolPreview(result) : null;
  const preview = compact?.summary ?? "补充任务";
  return <section className="task-operation" data-tool={name} data-status={status} aria-label={`${action}：${title}`}>
    <details open={groupOpen && open}>
      <summary data-tooltip={error ? `${label} · ${error}` : label} onClick={(event) => { event.preventDefault(); setOpen((value) => !value); }}>
        <span className="task-operation-icon"><Icon name={name === "read_result" ? "tool-result" : name === "append" ? "tool-append" : "tool-cancel"} /><span className="task-operation-status" role={error ? "alert" : "status"}>{error ? `${label} · ${error}` : label}</span></span>
        <span className="task-operation-heading" data-tooltip={error ? `${title} · ${error}` : title}><strong>{title}</strong>{name === "append" && <span className="task-operation-target" data-tooltip={preview}>{preview}</span>}</span>
      </summary>
      {groupOpen && open && <>
        {error && <p className="task-call-error">{error}</p>}
        <TaskCallDetails scope={scope} call={call} result={result} message={message} />
        {task && <button type="button" className="task-open-link" aria-haspopup="dialog" onClick={() => openTask(task.id)}>打开子会话<Icon name="subagent-open" /></button>}
      </>}
    </details>
  </section>;
});
