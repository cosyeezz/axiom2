import { type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPopup } from "../useAnchoredPopup.js";

/** Keep suggestions outside the composer's scroll clip, but inside a modal's focus scope. */
export function FileCompletionPopup({ input, children }: {
  input: RefObject<HTMLTextAreaElement | null>;
  children: ReactNode;
}) {
  const anchor = input.current?.closest<HTMLElement>(".composer") ?? input.current;
  const { panel, host } = useAnchoredPopup(anchor, { maxWidth: 560, maxHeight: Infinity, matchWidth: true });
  return anchor ? createPortal(<div ref={panel} className="file-completion">{children}</div>, host) : null;
}
