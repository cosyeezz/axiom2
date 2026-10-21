import { Icon } from "../components.js";

/** Shared outline icons for attachment chips and inline references. */
export function AttachmentSymbol({ kind, id, label }: { kind?: string; id?: string; label?: string }) {
  return <span className={`attachment-symbol attachment-symbol-${kind ?? "file"}`}>
    <Icon name={kind === "image" ? "image" : kind === "folder" ? "workspace" : "tool-read"} />
    {id && <small>{label ?? id.match(/\d+$/)?.[0]}</small>}
  </span>;
}
