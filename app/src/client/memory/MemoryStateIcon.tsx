import type { MemoryState } from "../../shared/memory-outline.js";

/** Lucide (ISC), Tabler (MIT), Phosphor (MIT). Sources/licenses: design-previews/task-state-icons.
 * Animate the original geometry only. SMIL intentionally stays active in reduced-motion mode,
 * like StatusIcons; a keyed state change starts the one-shot completion stroke again. */
export function MemoryStateIcon({ state, motion = true }: { state: MemoryState; motion?: boolean }) {
  const filled = state === "等待" || state === "阻塞" || state === "失败";
  return <svg key={state} className="memory-state-icon" data-state={state} viewBox={filled ? "0 0 256 256" : "0 0 24 24"} fill="none" stroke={filled ? undefined : "currentColor"} strokeWidth={filled ? undefined : 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {state === "未开始" && <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>}
    {state === "进行中" && <path d="M12 21v-3m6.36.36l-2.12-2.12M21 12h-3m.36-6.36l-2.12 2.12M12 3v3m-6.36-.36l2.12 2.12M4 12h2m1 4.95l.71-.71">
      {motion && <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1.6s" repeatCount="indefinite" />}
    </path>}
    {state === "已完成" && ["M18 6L7 17l-5-5", "M22 10l-7.5 7.5L13 16"].map((d, index) => <path key={d} d={d} stroke={index === 1 ? "var(--success)" : undefined} pathLength="1" strokeDasharray="1" strokeDashoffset="0">
      {motion && <animate attributeName="stroke-dashoffset" from="1" to="0" dur="0.45s" fill="freeze" />}
    </path>)}
    {(state === "等待" || state === "阻塞") && <path fill="currentColor" d="M200 32h-40a16 16 0 0 0-16 16v160a16 16 0 0 0 16 16h40a16 16 0 0 0 16-16V48a16 16 0 0 0-16-16m0 176h-40V48h40ZM96 32H56a16 16 0 0 0-16 16v160a16 16 0 0 0 16 16h40a16 16 0 0 0 16-16V48a16 16 0 0 0-16-16m0 176H56V48h40Z">
      {motion && <animate attributeName="opacity" values="1;.4;1" dur="2.6s" calcMode="spline" keyTimes="0;.5;1" keySplines=".4 0 .2 1;.4 0 .2 1" repeatCount="indefinite" />}
    </path>}
    {state === "失败" && <path fill="currentColor" d="M235.07 189.09L147.61 37.22a22.75 22.75 0 0 0-39.22 0L20.93 189.09a21.53 21.53 0 0 0 0 21.72A22.35 22.35 0 0 0 40.55 222h174.9a22.35 22.35 0 0 0 19.6-11.19a21.53 21.53 0 0 0 .02-21.72m-10.41 15.71a10.46 10.46 0 0 1-9.21 5.2H40.55a10.46 10.46 0 0 1-9.21-5.2a9.51 9.51 0 0 1 0-9.72l87.45-151.87a10.75 10.75 0 0 1 18.42 0l87.46 151.87a9.51 9.51 0 0 1-.01 9.72M122 144v-40a6 6 0 0 1 12 0v40a6 6 0 0 1-12 0m16 36a10 10 0 1 1-10-10a10 10 0 0 1 10 10" />}
    {state === "已放弃" && <><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12m0-6.5v-2a1.5 1.5 0 1 1 3 0V12m0-6.5a1.5 1.5 0 0 1 3 0V12" /><path d="M17 7.5a1.5 1.5 0 0 1 3 0V16a6 6 0 0 1-6 6h-2h.208a6 6 0 0 1-5.012-2.7L7 19q-.468-.718-3.286-5.728a1.5 1.5 0 0 1 .536-2.022a1.87 1.87 0 0 1 2.28.28L8 13" /></>}
  </svg>;
}
