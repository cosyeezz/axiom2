import { useContext, useEffect, useState } from "react";
import { ProcessDots, ProcessOutcome } from "./ProcessStatus.js";
import { ActivityExpanded, ActivitySettled } from "./ToolActivity.js";
import { Markdown } from "./Markdown.js";
import { MessagePartBody } from "./MessagePartBody.js";
import type { ChatMessage } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";

export function Thinking({ text, active, scope, message }: { text: string; active: boolean; scope: Scope; message: ChatMessage }) {
  const groupOpen = useContext(ActivityExpanded);
  const settled = useContext(ActivitySettled);
  active = active && !settled;
  const [open, setOpen] = useState(false);
  const trimmed = text.trim();
  const firstLine = trimmed.split(/\r\n|\r|\n/, 1)[0];
  const incomplete = message.thinkingLength !== undefined ? message.thinkingLength > text.length : !!message.truncated;
  const status = active ? "running" : message.status === "failed" || message.status === "cancelled" ? message.status : "completed";
  useEffect(() => { if (!groupOpen) setOpen(false); }, [groupOpen]);
  if (!groupOpen || (!trimmed && !incomplete && !active)) return null;
  const label = status === "failed" ? "思考失败" : status === "cancelled" ? "思考已停止" : firstLine;
  const inline = open && !!trimmed && (status === "completed" || active);
  const header = <>
    <span className={`thinking-label process-status-text${active ? " is-active" : ""}`}><span className="thinking-text" aria-hidden={inline || undefined}>{status === "completed" || active ? <Markdown text={firstLine || (active ? "" : "思考记录")} compact /> : label}</span>{active && <ProcessDots />}</span>
    {!active && status !== "completed" && <ProcessOutcome status={status} />}
  </>;
  return <details className="thinking-block" open={open} data-status={status} data-inline={inline || undefined}>
    <summary className="thinking-header" aria-label={open ? "收起思考" : "展开思考"} onClick={event => { event.preventDefault(); setOpen(value => !value); }}>{header}</summary>
    {open && (trimmed || incomplete) && <div className="thinking-body markdown"><MessagePartBody scope={scope} message={message} field="thinking" fallback="" /></div>}
  </details>;
}
