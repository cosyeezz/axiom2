import { useState } from "react";
import type { ChatMessage } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
import { taskLabels, taskToolName } from "../../shared/tasks.js";
import { useFullMessage } from "../chat/useFullMessage.js";
import { TaskReportBody } from "./TaskReportBody.js";
import type { ToolCall } from "../chat/tool-summary.js";
import { callObject, readTaskReport } from "./task-call.js";

/** Mounted only on disclosure. Loads the recorded response, never replays the tool. */
export function TaskCallDetails({ scope, call, result, message }: {
  scope: Scope; call: ToolCall; result: ChatMessage | null; message: ChatMessage;
}) {
  const outputRead = useFullMessage(scope, result, !!result?.truncated);
  const inputRead = useFullMessage(scope, message, call.inputLength !== undefined ? call.inputLength > call.input.length : !!message.truncated);
  const loading = outputRead.loading || inputRead.loading;
  const error = outputRead.error || inputRead.error;
  const [rawOpen, setRawOpen] = useState(false);
  const output = outputRead.message ?? result;
  const input = inputRead.message?.calls?.find((item) => item.id === call.id)?.input ?? call.input;
  const params = callObject(input);
  const name = taskToolName(call.name);
  const report = name === "read_result" && output?.status === "completed" && !output.truncated ? readTaskReport(output.text, params) : null;
  return <div className="task-call-detail">
    {loading && <p className="task-call-meta" role="status">正在加载完整记录…</p>}
    {error && <div className="task-call-error" role="alert">{error}<button type="button" className="btn" onClick={() => { if (outputRead.error) void outputRead.load(); if (inputRead.error) void inputRead.load(); }}>重新加载</button></div>}
    {name === "append" && typeof params?.text === "string" && <div className="task-call-content"><span className="task-call-meta">{params.mode === "followUp" ? "结束后追问" : "补充任务内容"}</span><p>{params.text}</p></div>}
    {name === "cancel_task" && typeof params?.reason === "string" && <div className="task-call-content"><span className="task-call-meta">停止原因</span><p>{params.reason}</p></div>}
    {report && <div className="task-report">
      <p className="task-call-meta">本次交付 · {taskLabels[report.status]}</p>
      {report.reason && <p className="task-call-error">{report.reason}</p>}
      <TaskReportBody key={report.id} scope={scope} report={report} />
      {report.unfinished.length > 0 && <div className="task-report-notes"><span className="task-call-meta">未完成／未验证</span><ul>{report.unfinished.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
      {report.sideEffects && <p className="task-call-meta">{report.sideEffects}</p>}
    </div>}
    {name === "read_result" && output?.status === "completed" && !report && !loading && <p className="task-call-meta">无法解析本次交付，请查看原始记录。</p>}
    <details className="task-call-raw" onToggle={(event) => setRawOpen(event.currentTarget.open)}>
      <summary>调用详情</summary>
      {rawOpen && <div><span className="task-call-meta">{call.name} · 输入参数</span><pre>{input}</pre>
        <span className="task-call-meta">执行输出</span><pre>{output?.text || output?.error || "尚未记录输出"}</pre>
        {output?.truncated && <p className="task-call-meta">当前仅展示部分输出</p>}
      </div>}
    </details>
  </div>;
}
