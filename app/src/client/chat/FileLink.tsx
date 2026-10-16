import { createContext, useContext, type ReactNode } from "react";
import type { FileReference } from "../../shared/file-preview.js";
import type { MarkdownImageOwner } from "./MarkdownImage.js";
import { FileIcon } from "./FileIcon.js";
export interface OpenFileReference extends FileReference { owner: MarkdownImageOwner; trigger: HTMLElement }
export const FilePreviewContext = createContext<((reference: OpenFileReference) => void) | null>(null);
export function FileLink({ href, owner, children }: { href: string; owner: MarkdownImageOwner; children: ReactNode }) {
  const open = useContext(FilePreviewContext);
  if (!open) return <span>{children}</span>;
  return <button type="button" className="file-reference" title={href} onClick={event => open({ href, messageId: owner.messageId, owner, trigger: event.currentTarget })}>
    <FileIcon name="file" /><span>{children}</span>
  </button>;
}
