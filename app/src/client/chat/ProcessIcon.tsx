import "../styles/process-motion.css";

/** Tabler automation (T013) / bulb (TH25), MIT; Lucide magnifier / pencil, ISC.
 * Read, edit, write and bash show only the operation symbol, without a file outline.
 * Outline viewBoxes include a stroke of 0.1em; dimensions follow the row font. */
export function ProcessIcon({ kind, active = false }: { kind: "tool" | "bash" | "read" | "edit" | "write" | "think"; active?: boolean }) {
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
    <svg className="tool-glyph" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="1.944 1.944 21.112 21.112" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 20.693c-.905.628-2.36.292-2.675-1.01a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37c1 .608 2.296.07 2.572-1.065c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.492.362 1.716 2.219.674 3.03" />
        <path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0-6 0m8 10l5-3l-5-3z" />
    </svg>
  </span>;
}
