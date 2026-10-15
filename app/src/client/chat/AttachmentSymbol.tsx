import { Icon } from "../components.js";

/** Shared outline icons for attachment chips and inline references. */
export function AttachmentSymbol({ kind, id }: { kind?: string; id?: string }) {
  return <span className={`attachment-symbol attachment-symbol-${kind ?? "file"}`}>
    {kind === "image" ? <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg> :
      <Icon name={kind === "folder" ? "workspace" : "tool-read"} />}
    {id && <small>{id.match(/\d+$/)?.[0]}</small>}
  </span>;
}
