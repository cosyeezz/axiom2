import { useId, type ReactNode } from "react";

export function validRatio(value: number | null | undefined, total: number | null | undefined): number | null {
  const ratio = value != null && total != null && Number.isFinite(value) && value >= 0 && Number.isFinite(total) && total > 0 ? value / total * 100 : null;
  return ratio != null && Number.isFinite(ratio) ? ratio : null;
}
export function cacheRatio(usage: { input: number; cacheRead: number; cacheWrite: number } | null | undefined) {
  return usage && [usage.input, usage.cacheRead, usage.cacheWrite].every(n => Number.isFinite(n) && n >= 0)
    ? validRatio(usage.cacheRead, usage.input + usage.cacheRead + usage.cacheWrite) : null;
}
function Frame({ children, kind, label, value, viewBox = "0 0 32 32" }: { children: ReactNode; kind: string; label?: string; value?: number | null; viewBox?: string }) {
  return <svg className={`data-icon data-icon-${kind}`} viewBox={viewBox} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} data-value={value ?? "unknown"}>{children}</svg>;
}
function Core({ name }: { name: string }) { return <use href={`#i-${name}`} x="10" y="10" width="12" height="12" />; }
function Unknown({ dx = -2, dy = 0 }: { dx?: number; dy?: number }) { return <g className="data-unknown" transform={`translate(${dx} ${dy})`}><circle cx="26" cy="25" r="5" fill="var(--surface, #222)" stroke="none" /><path d="M24.5 23.5a1.6 1.6 0 1 1 2.7 1.2c-.8.5-1.2.6-1.2 1.3m0 2h.01" /></g>; }
function Activity({ active }: { active?: boolean }) { return active ? <circle className="data-activity" cx="27" cy="5" r="2" fill="currentColor" stroke="none"><animate attributeName="opacity" values="1;.25;1" dur="1.8s" repeatCount="indefinite" /></circle> : null; }
function arc(i: number, n: number) { const gap = Math.min(8, 90 / n), a = (i * 360 / n - 90 + gap) * Math.PI / 180, b = ((i + 1) * 360 / n - 90 - gap) * Math.PI / 180; return `M${16+13*Math.cos(a)} ${16+13*Math.sin(a)} A13 13 0 ${b-a>Math.PI?1:0} 1 ${16+13*Math.cos(b)} ${16+13*Math.sin(b)}`; }
export function TaskProgressIcon({ percent, active, error, label }: { percent: number | null; active?: boolean; error?: boolean; label?: string }) {
  const valid = percent != null && Number.isFinite(percent) && percent >= 0 && percent <= 100;
  return <Frame kind={error ? "error" : percent === 100 ? "complete" : "task"} label={label} value={valid ? percent : null}>
    {Array.from({ length: 10 }, (_, i) => <path key={i} d={arc(i, 10)} className={valid && i < percent / 10 ? "data-filled" : "data-track"} strokeWidth="2.4" />)}
    <Core name={error ? "triangle-alert" : percent === 100 ? "check" : "list-checks"} />{!valid && !error && <Unknown />}<Activity active={active} />
  </Frame>;
}
export function ContextMemoryIcon({ percent, taskPercent = null, label }: { percent: number | null; taskPercent?: number | null; label?: string }) {
  const valid = percent != null && Number.isFinite(percent) && percent >= 0;
  const fill = valid ? Math.min(100, percent) : 0;
  const validTask = taskPercent != null && Number.isFinite(taskPercent) && taskPercent >= 0 && taskPercent <= 100;
  return <Frame kind={valid && percent >= 90 ? "capacity-warning" : "context-memory"} label={label} value={valid ? percent : null}>
    <circle className="data-track context-ring" cx="16" cy="16" r="13" />
    {valid && fill > 0 && <circle className="data-filled context-ring" cx="16" cy="16" r="13" pathLength="100" strokeDasharray={`${fill} 100`} transform="rotate(-90 16 16)" />}
    <svg className="memory-progress-bars ui-glyph" x="11" y="10" width="10" height="12" viewBox="0 0 10 12" data-progress={validTask ? taskPercent : "unknown"}>
      {[0, 1, 2].map(i => <path key={i} d={`M1 ${2 + i * 4}h8`} className={validTask && taskPercent >= (i + 1) * 100 / 3 ? "memory-progress-lit" : "memory-progress-pending"} />)}
    </svg>
  </Frame>;
}
export function CacheDataIcon({ percent, active }: { percent: number | null; active: boolean }) {
  const clipId = useId();
  const valid = percent != null && Number.isFinite(percent) && percent >= 0;
  const fill = valid ? Math.min(100, percent) : 0;
  return <Frame kind={valid && percent < 50 ? "cache-low" : "cache"} value={valid ? percent : null} viewBox="0.5 0 24 24">
    <defs><clipPath id={clipId}><path d="M3 5a9 3 0 0 0 18 0v3h-6v13.84A9 3 0 0 1 3 19Z" /></clipPath></defs>
    <rect className="data-level" x="3" y={22 - 15 * fill / 100} width="18" height={15 * fill / 100} clipPath={`url(#${clipId})`} fill="currentColor" stroke="none" opacity=".18" />
    {/* C001: Lucide database-zap, original outline paths (ISC). */}
    <g className="cache-outline"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14a9 3 0 0 0 12 2.84M21 5v3" /><path className="cache-lightning" data-tone={!valid ? "unknown" : percent > 90 ? "success" : percent > 70 ? "warning" : "danger"} d="m21 12-3 5h4l-3 5" /><path d="M3 12a9 3 0 0 0 11.59 2.87" />{active && <animate attributeName="opacity" values="1;.45;1" dur="1.8s" repeatCount="indefinite" />}</g>
    {!valid && <Unknown dx={-16} dy={-7} />}
  </Frame>;
}
export function BatchProgressIcon({ states, label }: { states: string[]; label: string }) {
  const active = states.some(s => ["starting", "running", "stopping"].includes(s));
  const failed = states.some(s => ["failed", "interrupted"].includes(s));
  return <Frame kind="batch" label={label} value={states.length ? states.filter(s => s === "completed").length / states.length * 100 : null}>
    {states.map((state, i) => <path key={i} d={arc(i, states.length)} strokeWidth="2.7" className={state === "completed" ? "data-success" : ["failed", "interrupted"].includes(state) ? "data-error" : state === "cancelled" ? "data-stopped" : "data-track"} />)}
    <Core name="network" />{failed ? <path className="data-error" d="m23 24 4 4m0-4-4 4" strokeWidth="2.4" /> : states.includes("cancelled") ? <rect className="data-stopped" x="23" y="23" width="5" height="5" /> : !states.length ? <Unknown /> : null}<Activity active={active} />
  </Frame>;
}
export function CompressionProgressIcon({ state, phase }: { state: string; phase?: string }) {
  const done = state === "completed" && phase === "done", active = state === "running";
  const failed = ["failed", "interrupted"].includes(state), stopped = state === "cancelled";
  const step = done ? 3 : Math.max(0, Math.min(2, ["snapshot", "summarizing", "applying", "done"].indexOf(phase ?? "")));
  return <Frame kind={failed ? "error" : "compression"}>
    <g><path d="M16 3v7l4-4m-8 0 4 4" />{active && <animateTransform attributeName="transform" type="translate" values="0 0;0 2;0 0" dur="1.8s" repeatCount="indefinite" />}</g>
    <g><path d="M16 23v-7l4 4m-8 0 4-4" />{active && <animateTransform attributeName="transform" type="translate" values="0 0;0 -2;0 0" dur="1.8s" repeatCount="indefinite" />}</g>
    <path d="M4 13h3m5 0h3m5 0h3m4 0h1" />
    {[0,1,2].map(i => <circle key={i} cx={7+i*9} cy="29" r="2" className={i <= step ? undefined : "data-track"} fill={i < step ? "currentColor" : "none"}>{active && i === step && <animate attributeName="opacity" values="1;.25;1" dur="1s" repeatCount="indefinite" />}</circle>)}
    {failed && <path d="m25 3 4 4m0-4-4 4" />}{stopped && <rect x="24" y="2" width="5" height="5" />}{state === "completed" && !done && <Unknown />}
  </Frame>;
}
