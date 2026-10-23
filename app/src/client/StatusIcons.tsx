import { useId, type ReactNode } from "react";

// SVG timelines are kept local to each mounted icon.
// Filled icons explicitly opt out of the workbench's default outline stroke.
type IconProps = { className?: string; label?: string; title?: string };
function FilledIcon({ className = "", label, title, children }: IconProps & { children: ReactNode }) {
  return <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}
    data-tooltip={title} style={{ fill: "currentColor", stroke: "none" }}>
    {children}
  </svg>;
}

export function BubbleLoadingIcon(props: IconProps) {
  return <FilledIcon {...props} className={`bubble-loading ${props.className ?? ""}`}>
    {Array.from({ length: 8 }, (_, index) => <circle key={index} cx="12" cy="2" r="0" fill="currentColor" transform={index ? `rotate(${index * 45} 12 12)` : undefined}>
      <animate attributeName="r" begin={index ? `${index * 0.125}s` : "0"} calcMode="spline" dur="1s" keySplines="0.2 0.2 0.4 0.8;0.2 0.2 0.4 0.8;0.2 0.2 0.4 0.8" repeatCount="indefinite" values="0;2;0;0" />
    </circle>)}
  </FilledIcon>;
}

export function SessionStatusIcon({ state, ...props }: IconProps & { state: "running" | "unread" }) {
  const haloId = useId();
  return <FilledIcon {...props} className={`session-state ${state} ${props.className ?? ""}`}>
    {state === "unread" && <>
      <defs>
        <radialGradient id={haloId}>
          <stop offset="0" stopColor="currentColor" stopOpacity=".85" />
          <stop offset=".28" stopColor="currentColor" stopOpacity=".65" />
          <stop offset=".6" stopColor="currentColor" stopOpacity=".25" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Only halo opacity changes: neither the core nor the glow contracts. */}
      <circle className="session-state-halo" cx="12" cy="12" r="24" fill={`url(#${haloId})`} />
    </>}
    <circle className="session-state-dot" cx="12" cy="12" r={state === "running" ? 9 : 8} fill="currentColor" />
  </FilledIcon>;
}

export function FoldIcon() {
  return <svg className="fold-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"
    style={{ fill: "none", stroke: "currentColor", strokeWidth: 2 }} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v6l3 -3m-6 0l3 3">
      <animateTransform attributeName="transform" type="translate" values="0 0;0 1.5;0 0" dur="1.8s" calcMode="spline" keyTimes="0;0.5;1" keySplines=".4 0 .2 1;.4 0 .2 1" repeatCount="indefinite" />
    </path>
    <path d="M12 21v-6l3 3m-6 0l3 -3">
      <animateTransform attributeName="transform" type="translate" values="0 0;0 -1.5;0 0" dur="1.8s" calcMode="spline" keyTimes="0;0.5;1" keySplines=".4 0 .2 1;.4 0 .2 1" repeatCount="indefinite" />
    </path>
    <path d="M4 12l1 0" />
    <path d="M9 12l1 0" />
    <path d="M14 12l1 0" />
    <path d="M19 12l1 0" />
  </svg>;
}
