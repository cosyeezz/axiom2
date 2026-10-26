import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icon.js";
import "../styles/inline-code.css";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function InlineCode({ text }: { text: string }) {
  // Keep the final grapheme and its action together, including emoji / combining marks.
  const tail = useMemo(() => graphemes.segment(text).containing(text.length - 1)?.index ?? 0, [text]);
  const [state, setState] = useState<"" | "copying" | "copied" | "failed">("");
  const revision = useRef(0), busy = useRef(false), button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    revision.current++; busy.current = false; setState("");
    return () => { revision.current++; };
  }, [text]);
  useEffect(() => {
    if (state !== "copied") return;
    const timer = setTimeout(() => setState(""), 1500);
    return () => clearTimeout(timer);
  }, [state]);
  async function copy() {
    if (busy.current) return;
    const request = ++revision.current;
    busy.current = true; setState("copying");
    try {
      await navigator.clipboard.writeText(text);
      if (request === revision.current) setState("copied");
    } catch {
      if (request === revision.current) setState("failed");
    } finally {
      if (request === revision.current) busy.current = false;
    }
  }
  const feedback = state === "copied" ? "已复制" : state === "failed" ? "复制失败，点击重试" : state === "copying" ? "正在复制…" : "";
  return <span className="inline-code" data-copy-state={state || undefined}>
    <code>{text.slice(0, tail)}<span className="inline-code-tail">{text.slice(tail)}<button ref={button} type="button" className="action-icon inline-code-copy"
      aria-label={state === "failed" ? feedback : "复制代码"} aria-busy={state === "copying"} aria-disabled={state === "copying"}
      data-tooltip={feedback || "复制代码"}
      onClick={event => { event.stopPropagation(); void copy(); }}
      onDoubleClick={event => event.stopPropagation()}
      onKeyDown={event => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}>
      <Icon name={state === "copied" ? "check" : state === "failed" ? "close" : "copy"} />
    </button></span></code>
    {/* Keep feedback outside the source text so selection and annotation offsets stay exact. */}
    {typeof document !== "undefined" && createPortal(<span className="screen-reader inline-code-status" role="status" aria-live="polite">{feedback}</span>, button.current?.closest("dialog") ?? document.body)}
  </span>;
}
