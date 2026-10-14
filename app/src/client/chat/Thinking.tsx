import { useContext, useEffect, useState } from "react";
import { Icon } from "../components.js";
import { Markdown } from "./Markdown.js";
import { ActivityExpanded } from "./ToolActivity.js";
import { ThinkingDots } from "./ThinkingDots.js";

export function Thinking({ text, active }: { text: string; active: boolean }) {
  const [open, setOpen] = useState(false);
  const groupOpen = useContext(ActivityExpanded);
  useEffect(() => { if (!groupOpen) setOpen(false); }, [groupOpen]);
  return <details className="thinking-block" open={groupOpen && open} data-active={active}>
    <summary aria-label={active ? "正在思考" : "思考内容"} onClick={(event) => { event.preventDefault(); setOpen((value) => !value); }}>
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" className="thinking-glyph lucide lucide-brain" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 18V5" />
        <path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4" />
        <path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5" />
        <path d="M17.997 5.125a4 4 0 0 1 2.526 5.77" />
        <path d="M18 18a4 4 0 0 0 2-7.464" />
        <path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517" />
        <path d="M6 18a4 4 0 0 1-2-7.464" />
        <path d="M6.003 5.125a4 4 0 0 0-2.526 5.77" />
      </svg>
      <span className="thinking-label">{active ? <ThinkingDots /> : "thought"}</span>
      <Icon name="chevron" />
    </summary>
    {groupOpen && open && <div className="thinking-body markdown"><Markdown text={text} /></div>}
  </details>;
}
