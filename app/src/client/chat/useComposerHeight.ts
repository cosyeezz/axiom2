import { useLayoutEffect, useRef, type RefObject } from "react";
import { subscribeDisplaySettings } from "../display-settings.js";

/** Measure offscreen: collapsing the real field also collapses the chat viewport. */
export function useComposerHeight(input: RefObject<HTMLTextAreaElement | null>, text: string) {
  const measure = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const node = input.current;
    if (!node) return;
    const mirror = document.createElement("textarea");
    mirror.tabIndex = -1;
    mirror.setAttribute("aria-hidden", "true");
    mirror.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;height:0;min-height:0;max-height:none;overflow:hidden;resize:none";
    document.body.append(mirror);
    const form = node.closest<HTMLElement>(".composer");
    const resize = () => {
      let style = getComputedStyle(node);
      for (const property of ["box-sizing", "width", "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "padding-top", "padding-right", "padding-bottom", "padding-left", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "border-style", "white-space", "overflow-wrap", "word-break", "tab-size", "text-indent"])
        mirror.style.setProperty(property, style.getPropertyValue(property));
      mirror.value = node.value;
      if (form) {
        const layout = getComputedStyle(form);
        const mobile = layout.getPropertyValue("--composer-mobile-layout").trim() === "1";
        // Always test the compact column, even after expanding to full width.
        // Otherwise a soft-wrapped draft could alternate between the two layouts.
        const compactWidth = parseFloat(layout.gridTemplateColumns.split(/\s+/)[1]);
        if (mobile && compactWidth > 0) {
          mirror.style.width = `${compactWidth}px`;
          const singleLine = parseFloat(style.lineHeight) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
          form.toggleAttribute("data-multiline", mirror.scrollHeight > singleLine + 1);
        } else form.removeAttribute("data-multiline");
        style = getComputedStyle(node);
        mirror.style.width = style.width;
      }
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const content = mirror.scrollHeight + (style.boxSizing === "border-box" ? border : -padding);
      const minimum = parseFloat(style.minHeight) || 44;
      const maximum = parseFloat(style.maxHeight) || 180;
      const height = `${Math.min(maximum, Math.max(minimum, content))}px`;
      if (node.style.height !== height) node.style.setProperty("height", height, "important");
    };
    measure.current = resize;
    resize();
    let width = node.clientWidth;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth === width) return;
      width = node.clientWidth;
      resize();
    });
    observer.observe(node);
    const unsubscribeDisplay = subscribeDisplaySettings(resize);
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    return () => {
      measure.current = () => {};
      observer.disconnect(); unsubscribeDisplay();
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      mirror.remove();
    };
  }, [input]);
  useLayoutEffect(() => measure.current(), [text]);
}
