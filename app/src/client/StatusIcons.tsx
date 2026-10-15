import { type ReactNode } from "react";

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

export function PulseRingsIcon(props: IconProps) {
  return <FilledIcon {...props} className={`pulse-rings-multiple ${props.className ?? ""}`}>
    {/* Fill over 2s, hold for 2s, then reverse over 2s without a loop-boundary jump. */}
    <g transform="translate(12 12)">
      {[0.35, 0.65, 1].map(scale => <g key={scale} transform={`scale(${scale})`}>
        <animateTransform attributeName="transform" type="scale" values={`${scale};1;1;${scale}`} keyTimes="0;0.3333333333333333;0.6666666666666666;1" dur="6s" repeatCount="indefinite" />
        <path fill="currentColor" d="M12,1A11,11,0,1,0,23,12,11,11,0,0,0,12,1Zm0,20a9,9,0,1,1,9-9A9,9,0,0,1,12,21Z" transform="translate(-12 -12)" />
      </g>)}
    </g>
    <circle className="unread-solid-dot" cx="12" cy="12" r="0" fill="currentColor">
      <animate attributeName="r" values="0;9;9;0" keyTimes="0;0.3333333333333333;0.6666666666666666;1" dur="6s" repeatCount="indefinite" />
    </circle>
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
