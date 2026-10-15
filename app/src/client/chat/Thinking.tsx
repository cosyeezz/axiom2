import { useContext } from "react";
import { Markdown } from "./Markdown.js";
import { ActivityExpanded } from "./ToolActivity.js";
import { ThinkingDots } from "./ThinkingDots.js";

export function Thinking({ text, active }: { text: string; active: boolean }) {
  const groupOpen = useContext(ActivityExpanded);
  if (!groupOpen || (!text && !active)) return null;
  return <div className="thinking-block" data-active={active}>
    {text && <div className="thinking-body markdown"><Markdown text={text} /></div>}
    {active && <ThinkingDots />}
  </div>;
}
