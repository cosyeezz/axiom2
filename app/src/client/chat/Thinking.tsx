import { useContext, useEffect, useState } from "react";
import { Markdown } from "./Markdown.js";
import { ActivityExpanded } from "./ToolActivity.js";
import { ThinkingDots } from "./ThinkingDots.js";
import { MessagePartBody } from "./MessagePartBody.js";
import type { ChatMessage } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";

export function Thinking({ text, active, scope, message }: { text: string; active: boolean; scope: Scope; message: ChatMessage }) {
  const groupOpen = useContext(ActivityExpanded);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!groupOpen) setOpen(false); }, [groupOpen]);
  if (!groupOpen || (!text && !active)) return null;
  return <details className="thinking-block" open={open} data-status={active ? "running" : "completed"}>
    <summary className="thinking-header" onClick={event => { event.preventDefault(); setOpen(value => !value); }}>
      <svg className="thinking-glyph" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <path d="M15.5 13a3.5 3.5 0 0 0 -3.5 3.5v1a3.5 3.5 0 0 0 7 0v-1.8" />
        <path d="M8.5 13a3.5 3.5 0 0 1 3.5 3.5v1a3.5 3.5 0 0 1 -7 0v-1.8" />
        <path d="M17.5 16a3.5 3.5 0 0 0 0 -7h-.5" />
        <path d="M19 9.3v-2.8a3.5 3.5 0 0 0 -7 0" />
        <path d="M6.5 16a3.5 3.5 0 0 1 0 -7h.5" />
        <path d="M5 9.3v-2.8a3.5 3.5 0 0 1 7 0v10" />
      </svg>
      {active ? <ThinkingDots /> : <span className="thinking-label">thinking</span>}
      {!open && !active && text && <span className="thinking-preview"><Markdown text={text} compact /></span>}
    </summary>
    {open && text && <div className="thinking-body markdown"><MessagePartBody scope={scope} message={message} field="thinking" fallback="" /></div>}
  </details>;
}
