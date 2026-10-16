import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
import { Icon } from "../components.js";
import { command } from "../transport.js";

export function CopyReply({ message, scope }: { message: ChatMessage; scope: Scope }) {
  const [feedback, setFeedback] = useState<"" | "copied" | "failed">("");
  const [copying, setCopying] = useState(false);
  const active = useRef(true), busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; clearTimeout(timer.current); };
  }, []);
  const label = feedback === "copied" ? "已复制" : feedback === "failed" ? "复制失败，点击重试" : "";
  async function copy() {
    if (busy.current) return;
    busy.current = true;
    clearTimeout(timer.current);
    setFeedback(""); setCopying(true);
    try {
      const full = message.truncated
        ? await command<ChatMessage>("message.get", { id: message.id }, scope)
        : message;
      if (!active.current) return;
      await navigator.clipboard.writeText(full.text);
      if (active.current) setFeedback("copied");
    } catch {
      if (active.current) setFeedback("failed");
    } finally {
      busy.current = false;
      if (active.current) {
        setCopying(false);
        timer.current = setTimeout(() => setFeedback(""), 1500);
      }
    }
  }
  return <span className="message-actions" data-feedback={feedback || undefined}>
    <button type="button" className="action-icon" aria-label="复制回复的 Markdown 原文" aria-busy={copying}
      data-tooltip={label || "复制回复"} onClick={() => void copy()}>
      {feedback === "copied" ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg> :
        <Icon name={feedback === "failed" ? "close" : "copy"} />}
    </button>
    <span className="screen-reader" role="status" aria-live="polite">{label}</span>
    {feedback === "failed" && <span className="message-copy-error" aria-hidden="true">复制失败，点击重试</span>}
  </span>;
}
