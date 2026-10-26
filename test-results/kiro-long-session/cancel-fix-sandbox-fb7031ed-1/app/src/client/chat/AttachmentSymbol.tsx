import { Icon } from "../components.js";
import "../styles/attachment-symbol.css";

export type AttachmentReferenceInfo = { id?: string; kind?: string; name?: string };

/** One glyph and label layout for files, folders and images in every attachment surface. */
export function AttachmentSymbol({ kind, id }: AttachmentReferenceInfo) {
  return <span className={`attachment-symbol attachment-symbol-${kind ?? "file"}`}>
    <Icon name={kind === "image" ? "image" : kind === "folder" ? "folder-open" : "file-text"} />
    {id && <small>{id}</small>}
  </span>;
}

/** Shared compact badge for the composer mirror and sent message text. */
export function AttachmentReference({ kind, id, name }: AttachmentReferenceInfo) {
  return <span className="attachment-reference" data-tooltip={name ? `${id} · ${name}` : undefined}>
    <AttachmentSymbol kind={kind} id={id} />
  </span>;
}
