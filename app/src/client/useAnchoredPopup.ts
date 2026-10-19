import { useLayoutEffect, useRef } from "react";

/** Position a portalled layer in the visible viewport while retaining a modal's ownership. */
export function useAnchoredPopup(anchor: HTMLElement | null, {
  maxWidth = 400, maxHeight = 520, matchWidth = false, fillMobile = false, preferBelow = false,
}: { maxWidth?: number; maxHeight?: number; matchWidth?: boolean; fillMobile?: boolean; preferBelow?: boolean } = {}) {
  const panel = useRef<HTMLDivElement>(null);
  const host = anchor?.closest("dialog") ?? document.body;
  useLayoutEffect(() => {
    const node = panel.current;
    if (!anchor || !node) return;
    const position = () => {
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight;
      const rect = anchor.getBoundingClientRect();
      const gutter = 12, gap = 8;
      const availableAbove = Math.max(0, rect.top - top - gutter - gap);
      const availableBelow = Math.max(0, top + height - rect.bottom - gutter - gap);
      const above = preferBelow
        ? availableBelow < Math.min(200, availableAbove)
        : availableAbove >= Math.min(200, availableBelow);
      const limit = fillMobile && matchMedia("(max-width:640px), (pointer:coarse) and (max-height:500px)").matches ? width - gutter * 2 : maxWidth;
      const panelWidth = Math.max(0, Math.min(limit, matchWidth ? rect.width : limit, width - gutter * 2));
      node.style.width = `${panelWidth}px`;
      node.style.maxHeight = `${Math.max(0, Math.min(maxHeight, height - gutter * 2, above ? availableAbove : availableBelow))}px`;
      node.style.left = `${Math.max(left + gutter, Math.min(rect.left, left + width - gutter - panelWidth))}px`;
      const panelHeight = node.getBoundingClientRect().height;
      node.style.top = `${Math.max(top + gutter, Math.min(above ? rect.top - gap - panelHeight : rect.bottom + gap, top + height - gutter - panelHeight))}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(anchor);
    observer.observe(node);
    const composer = anchor.closest(".composer-area");
    if (composer) observer.observe(composer);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [anchor, maxWidth, maxHeight, matchWidth, fillMobile, preferBelow]);
  return { panel, host };
}
