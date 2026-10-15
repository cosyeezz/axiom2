import { useEffectEvent, useLayoutEffect, useRef } from "react";

/** A non-modal settings sheet keeps its toolbar reachable, including inside a child dialog. */
export function useSettingsPopover(trigger: HTMLButtonElement, onClose: () => void) {
  const panel = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const dismiss = useEffectEvent(onClose);
  const host = trigger.closest("dialog") ?? document.body;

  useLayoutEffect(() => {
    const node = panel.current!;
    const toolbar = trigger.closest(".usage-settings") ?? trigger;
    const position = () => {
      const bottom = Math.max(0, toolbar.getBoundingClientRect().top - 8);
      node.style.setProperty("--settings-bottom", `${Math.max(0, window.innerHeight - bottom)}px`);
    };
    const restoreFocus = () => {
      if (document.activeElement === document.body || node.contains(document.activeElement)) {
        trigger.focus({ preventScroll: true });
      }
    };
    const toggle = (event: ToggleEvent) => {
      if (event.target === node && event.newState === "closed") {
        restoreFocus();
        dismiss();
      }
    };
    position();
    node.addEventListener("toggle", toggle);
    node.showPopover({ source: trigger });
    close.current!.focus({ preventScroll: true });
    const observer = new ResizeObserver(position);
    observer.observe(toolbar);
    observer.observe(trigger.closest(".composer-area") ?? toolbar);
    observer.observe(host);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      node.removeEventListener("toggle", toggle);
      if (node.matches(":popover-open")) node.hidePopover();
      restoreFocus();
    };
  }, [trigger, host]);

  return { panel, close, host };
}
