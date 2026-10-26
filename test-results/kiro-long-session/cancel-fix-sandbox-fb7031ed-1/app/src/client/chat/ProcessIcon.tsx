import type { ToolIcon } from "../../shared/tool-summary.js";
import { Icon } from "../Icon.js";
import "../styles/process-motion.css";

/** Shared tool symbols and licenses live in icons.svg and ICONS-LICENSE.txt.
 * Read, edit, write and bash retain their standalone operation symbols.
 * Fitted viewBoxes and non-scaling strokes follow the row font. */
export function ProcessIcon({ kind, active = false }: { kind: ToolIcon | "think"; active?: boolean }) {
  if (kind === "think") return <span className="process-icon process-icon-think" aria-hidden="true">
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="2.25 2.25 19.5 19.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h1m8-9v1m8 8h1M5.6 5.6l.7.7m12.1-.7l-.7.7M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0-1 3a2 2 0 0 1-4 0a3.5 3.5 0 0 0-1-3m.7 1h4.6" />
    </svg>
  </span>;
  if (kind === "read" || kind === "edit" || kind === "write" || kind === "bash") return <span className={`process-icon process-icon-${kind}${active ? " is-active" : ""}`} aria-hidden="true">
    <svg className="tool-glyph" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0.75 0.75 22.5 22.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {kind === "bash" ? <path d="m2 2 10 10-10 10m12 0h8" /> : kind === "edit" || kind === "write" ? <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497zM15 5l4 4" /> : <>
        <path d="m16 16 6 6" />
        <circle cx="10" cy="10" r="8" vectorEffect="non-scaling-stroke" />
      </>}
      {kind === "write" && <path d="M12 22h10" />}
    </svg>
  </span>;
  return <span className={`process-icon process-icon-${kind}${active ? " is-active" : ""}`} aria-hidden="true">
    <Icon name={`tool-${kind}`} className="tool-glyph" />
  </span>;
}
