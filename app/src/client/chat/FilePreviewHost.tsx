import { createContext, useContext, useState, type ReactNode } from "react";
import { FilePreviewContext, type OpenFileReference } from "./FileLink.js";
import { FilePreviewPanel } from "./FilePreview.js";
import { guardFileNavigation } from "../file-edit-guard.js";
const PreviewOutlet = createContext<ReactNode>(null);

/** Covers the thread, composer and capability popovers; panel stays in the thread. */
export function FilePreviewHost({ children }: { children: ReactNode }) {
  const [reference, setReference] = useState<OpenFileReference | null>(null);
  const close = () => guardFileNavigation(() => {
    setReference(null);
    if (reference?.trigger.isConnected) reference.trigger.focus({ preventScroll: true });
    else document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus({ preventScroll: true });
  });
  const open = (next: OpenFileReference) => guardFileNavigation(() => setReference(next));
  return <FilePreviewContext.Provider value={open}><PreviewOutlet.Provider value={reference &&
    <FilePreviewPanel key={`${reference.owner.scope.sessionId}:${reference.skillId ?? reference.messageId}:${reference.href ?? "skill"}`} reference={reference} onClose={close} />}>
    {children}
  </PreviewOutlet.Provider></FilePreviewContext.Provider>;
}
export function FilePreviewOutlet() { return useContext(PreviewOutlet); }
