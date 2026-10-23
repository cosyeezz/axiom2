import { useEffectEvent, useLayoutEffect, useRef } from "react";
import { openPopover, popoverHost } from "./popover.js";
import "./styles/toolbar-details.css";

/** A non-modal settings sheet keeps its toolbar reachable, including inside a child dialog. */
export function useSettingsPopover(trigger: HTMLButtonElement, onClose: () => void, placement: "drawer" | "anchored" = "drawer") {
  const panel = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const dismiss = useEffectEvent(onClose);
  const host = popoverHost(trigger);

  useLayoutEffect(() => {
    const node = panel.current!;
    const toolbar = trigger.closest(".usage") ?? trigger;
    node.classList.add("toolbar-detail-panel");
    node.classList.toggle("toolbar-detail-drawer", placement === "drawer");
    const position = () => {
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0, left = viewport?.offsetLeft ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const bottom = Math.max(top + 80, toolbar.getBoundingClientRect().top - 8);
      const preferredWidth = node.classList.contains("cache-detail") ? 360 : node.classList.contains("cost-popover") ? 480 : 520;
      const panelWidth = Math.min(preferredWidth, width - 24);
      node.style.setProperty("--settings-bottom", `${Math.max(12, window.innerHeight - bottom)}px`);
      node.style.setProperty("--toolbar-panel-left", `${Math.max(left + 12, Math.min(trigger.getBoundingClientRect().left, left + width - panelWidth - 12))}px`);
      node.style.setProperty("--toolbar-panel-height", `${Math.max(68, bottom - top - 12)}px`);
      node.style.setProperty("--toolbar-panel-width", `${panelWidth}px`);
    };
    const restoreFocus = () => {
      if (document.activeElement === document.body || node.contains(document.activeElement)) {
        trigger.focus({ preventScroll: true });
      }
    };
    let positionFrame = 0;
    const schedulePosition = (event?: Event) => {
      if (event?.target instanceof Node && node.contains(event.target)) return;
      if (!positionFrame) positionFrame = requestAnimationFrame(() => { positionFrame = 0; position(); });
    };
    position();
    const disposePopover = openPopover(node, { source: trigger, onClose: () => { restoreFocus(); dismiss(); } });
    close.current!.focus({ preventScroll: true });
    const observer = new ResizeObserver(() => schedulePosition());
    observer.observe(toolbar);
    observer.observe(trigger.closest(".composer-area") ?? toolbar);
    observer.observe(host);
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", schedulePosition);
    window.addEventListener("scroll", schedulePosition, true);
    return () => {
      cancelAnimationFrame(positionFrame);
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", schedulePosition);
      window.removeEventListener("scroll", schedulePosition, true);
      disposePopover();
      restoreFocus();
    };
  }, [trigger, host, placement]);

  return { panel, close, host };
}
