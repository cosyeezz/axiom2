import { useId, useLayoutEffect, useRef } from "react";
import type { ToolStatus } from "./tool-summary.js";

/** Shared label and motion for every live process phase. */
export function ProcessTitle({ label, active = false, thinking = false }: { label: string; active?: boolean; thinking?: boolean }) {
  return <span data-thinking={active && thinking || undefined} className={`activity-title process-status-text${active ? " is-active" : ""}`}>{label}{active && <ProcessDots />}</span>;
}

export function ModelRequestStatus() {
  return <div className="process-live process-requesting" role="status"><ProcessTitle label="正在思考" active thinking /></div>;
}

/** The dot mask receives the same gradient at the same coordinates as its label. */
export function ProcessDots() {
  const clipId = useId();
  const dots = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = dots.current, label = node?.parentElement;
    if (!node || !label) return;
    const measure = () => {
      const parent = label.getBoundingClientRect(), glyph = node.getBoundingClientRect();
      node.style.setProperty("--process-gradient-width", `${parent.width * 2.5}px`);
      node.style.setProperty("--process-gradient-travel", `${parent.width * -1.5}px`);
      const offset = glyph.left - parent.left;
      node.style.setProperty("--process-dot-offset", `${offset}px`);
      if (parent.width > 0) node.querySelectorAll("circle").forEach(circle => {
        // The white peak is at (-.25 + 1.5 * progress) * label width.
        const peak = (offset + circle.cx.baseVal.value + parent.width * .25) / (parent.width * 1.5);
        circle.style.setProperty("--process-dot-peak", String(peak));
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(label);
    return () => observer.disconnect();
  }, []);
  return <span ref={dots} className="process-ellipsis" style={{ clipPath: `url(#${clipId})` }} aria-hidden="true">
    <svg width="24" height="24" aria-hidden="true"><defs>
      <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
        {[6, 12, 18].map(cx => <circle key={cx} cx={cx} cy="12" r="0" />)}
      </clipPath>
    </defs></svg>
  </span>;
}
export function ProcessOutcome({ status }: { status: ToolStatus }) {
  if (status === "running") return null;
  const label = status === "completed" ? "已完成" : status === "failed" ? "失败" : status === "cancelled" ? "已停止" : "未确认完成";
  return <span className="process-outcome" data-status={status} role="img" aria-label={label}>
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {status === "completed" ? <path d="m4 10 4 4 8-8" /> : status === "failed" ? <path d="m5 5 10 10m0-10L5 15" /> : status === "cancelled" ? <path d="M7 5v10m6-10v10" /> : <><circle cx="10" cy="10" r="7" /><path d="M10 6v5m0 3h.01" /></>}
    </svg>
  </span>;
}
