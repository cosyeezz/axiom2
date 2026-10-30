import { useContext, useEffect } from "react";
import { useRememberedDisclosure } from "./OriginalConversation.js";
import { ProcessDots, ProcessOutcome } from "./ProcessStatus.js";
import { ActivityExpanded, ActivitySettled } from "./ToolActivity.js";
import { Markdown } from "./Markdown.js";
import { ThinkingPreview } from "./ThinkingPreview.js";
import { MessagePartBody } from "./MessagePartBody.js";
import type { ChatMessage } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";

export function Thinking({ text, active, scope, message }: { text: string; active: boolean; scope: Scope; message: ChatMessage }) {
  const groupOpen = useContext(ActivityExpanded);
  const settled = useContext(ActivitySettled);
  active = active && !settled;
  const [expanded, setOpen] = useRememberedDisclosure(`thinking:${message.id}`);
  const trimmed = text.trim();
  const firstLine = trimmed.split(/\r\n|\r|\n/, 1)[0];
  const incomplete = message.thinkingLength !== undefined ? message.thinkingLength > text.length : !!message.truncated;
  const canExpand = !!trimmed || incomplete;
  const open = expanded && canExpand;
  const status = active ? "running" : message.status === "failed" || message.status === "cancelled" ? message.status : "completed";
  useEffect(() => { if (!groupOpen || !canExpand) setOpen(false); }, [groupOpen, canExpand, setOpen]);
  if (!groupOpen || (!trimmed && !incomplete && !active)) return null;
  const label = status === "failed" ? "思考失败" : status === "cancelled" ? "思考已停止" : firstLine;
  const inline = open && !!trimmed && (status === "completed" || active);
  const header = <>
    <span className={`thinking-label process-status-text${active ? " is-active" : ""}`}><span className="thinking-text" aria-hidden={inline || undefined}>{active && !open ? <ThinkingPreview text={message.thinkingTail ?? text} start={message.thinkingTail !== undefined ? (message.thinkingLength ?? text.length) - message.thinkingTail.length : 0} /> : status === "completed" || active ? <Markdown text={firstLine || (active ? "" : "思考记录")} compact /> : label}</span>{active && <ProcessDots />}</span>
    {!active && status !== "completed" && <ProcessOutcome status={status} />}
  </>;
  return <details className="thinking-block" open={open} data-status={status} data-inline={inline || undefined}>
    <summary className="thinking-header" aria-disabled={!canExpand || undefined} tabIndex={canExpand ? undefined : -1} aria-label={canExpand ? open ? "收起思考" : "展开思考" : "正在思考"} onClick={event => { event.preventDefault(); if (canExpand) setOpen(value => !value); }}>{header}</summary>
    {open && (trimmed || incomplete) && <div className="thinking-body markdown"><MessagePartBody scope={scope} message={message} field="thinking" fallback="" /></div>}
  </details>;
}
