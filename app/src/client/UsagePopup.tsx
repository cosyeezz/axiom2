import { useEffectEvent, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { popupAnchorVisible, useAnchoredPopup } from "./useAnchoredPopup.js";
import { closePopover } from "./popover.js";
import "./styles/usage-controls.css";

/** Reveal focus only inside this layer; never scroll the enclosing page/dialog. */
export function focusUsageControl(control: HTMLElement | null) {
  if (!control) return;
  control.focus({ preventScroll: true });
  const popup = control.closest<HTMLElement>(".usage-popup");
  if (!popup) return;
  const box = popup.getBoundingClientRect(), bounds = control.getBoundingClientRect();
  if (bounds.top < box.top + 6) popup.scrollTop -= box.top + 6 - bounds.top;
  else if (bounds.bottom > box.bottom - 6) popup.scrollTop += bounds.bottom - box.bottom + 6;
}

/** Non-modal usage-page controls share the existing modal-owned, bounded popup layer. */
export function UsagePopup({ anchor, id, label, className, children, onClose, width = 360 }: {
  anchor: HTMLButtonElement; id: string; label: string; className: string; children: ReactNode;
  onClose: () => void; width?: number;
}) {
  const viewport = window.visualViewport, bounds = anchor.getBoundingClientRect(), top = viewport?.offsetTop ?? 0;
  const preferBelow = (viewport?.height ?? innerHeight) - (bounds.bottom - top) >= bounds.top - top;
  const { panel, host } = useAnchoredPopup(anchor, { maxWidth: width, maxHeight: 640, fillMobile: true, preferBelow });
  const dismiss = useEffectEvent(onClose);
  useLayoutEffect(() => {
    const node = panel.current!;
    focusUsageControl(node.querySelector<HTMLElement>("[data-autofocus]"));
    const outside = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && !node.contains(target) && !anchor.contains(target)) dismiss();
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && node.contains(event.target)) return;
      if (!popupAnchorVisible(anchor)) dismiss();
    };
    const blur = () => dismiss();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    window.addEventListener("blur", blur);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      window.removeEventListener("blur", blur);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [anchor, panel]);
  return createPortal(<div ref={panel} id={id} popover="manual" role="dialog" aria-label={label} className={`usage-popup ${className}`}
    onKeyDown={event => {
      if (event.key !== "Escape" || event.nativeEvent.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
      event.preventDefault(); event.stopPropagation();
      // Close the native layer and commit the React removal before restoring
      // focus; otherwise unmounting a focused descendant can leave BODY active.
      closePopover(event.currentTarget); onClose();
      queueMicrotask(() => { if (anchor.isConnected && !anchor.disabled) anchor.focus({ preventScroll: true }); });
    }}>{children}</div>, host);
}
