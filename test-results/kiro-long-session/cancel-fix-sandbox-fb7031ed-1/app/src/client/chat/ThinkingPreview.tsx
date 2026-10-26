import { useLayoutEffect, useRef } from "react";
import { Markdown } from "./Markdown.js";
import { mergeThinkingPreview } from "../../shared/thinking-preview.js";

/** A one-line window onto the newest wrapped line, not an expanding transcript. */
export function ThinkingPreview({ text, start = 0 }: { text: string; start?: number }) {
  const viewport = useRef<HTMLSpanElement>(null);
  const content = useRef<HTMLSpanElement>(null);
  const previous = useRef<{ text: string; offset: number } | null>(null);
  const animation = useRef<Animation | null>(null);
  const buffer = useRef({ text, start });
  buffer.current = mergeThinkingPreview(buffer.current, { text, start });
  const value = buffer.current.text.trim();
  useLayoutEffect(() => () => animation.current?.cancel(), []);
  useLayoutEffect(() => {
    const window = viewport.current!, body = content.current!;
    const follow = (animate: boolean) => {
      const offset = Math.max(0, body.getBoundingClientRect().height - window.clientHeight);
      const last = previous.current;
      // Continue from the currently painted position when another line arrives mid-roll.
      const from = new DOMMatrixReadOnly(getComputedStyle(body).transform).m42;
      if (!last || offset !== last.offset) animation.current?.cancel();
      body.style.transform = `translateY(${-offset}px)`;
      if (animate && last && offset > last.offset && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        animation.current = body.animate([
          { transform: `translateY(${from}px)` },
          { transform: `translateY(${-offset}px)` },
        ], { duration: 240, easing: "ease-out" });
      }
      previous.current = { text: value, offset };
    };
    follow(true);
    let width = window.clientWidth;
    const observer = new ResizeObserver(() => {
      const offset = Math.max(0, body.getBoundingClientRect().height - window.clientHeight);
      if (width !== window.clientWidth || offset !== previous.current?.offset) {
        width = window.clientWidth;
        follow(false);
      }
    });
    observer.observe(window);
    observer.observe(body);
    return () => observer.disconnect();
  }, [value]);
  return <span ref={viewport} className="thinking-scroll"><span ref={content} className="thinking-scroll-content">
    {value.split(/\r\n|\r|\n/).filter(line => line.trim()).map((line, index) => <span className="thinking-scroll-line" key={index}><Markdown text={line} compact /></span>)}
  </span></span>;
}
