import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openPopover, popoverHost } from "./popover.js";
import "./styles/tooltip.css";

type Tip = { anchor: Element; text: string };

// One delegated tooltip for all pages, including dynamically mounted thread content.
export function TooltipLayer() {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    let anchor: Element | null = null;
    let opening: ReturnType<typeof setTimeout> | undefined;
    let closing: ReturnType<typeof setTimeout> | undefined;
    let visible = false;
    let pointerFocus = false;
    let focusAnchor: Element | null = null;
    const hide = () => {
      clearTimeout(opening);
      clearTimeout(closing);
      anchor = null;
      focusAnchor = null;
      visible = false;
      setTip(null);
    };
    const find = (target: EventTarget | null) => target instanceof Element
      ? target.closest("[data-tooltip]") : null;
    const show = (next: Element | null, immediate = false) => {
      clearTimeout(closing);
      if (next === anchor) return;
      hide();
      if (!next?.getAttribute("data-tooltip")?.trim()) return;
      anchor = next;
      opening = setTimeout(() => {
        if (!next.isConnected || !next.getClientRects().length) return hide();
        visible = true;
        setTip({ anchor: next, text: next.getAttribute("data-tooltip")! });
      }, immediate ? 0 : 450);
    };
    const over = (event: PointerEvent) => {
      if (event.pointerType === "touch" || event.buttons || focusAnchor) return;
      if (event.target instanceof Node && ref.current?.contains(event.target)) {
        clearTimeout(closing);
        return;
      }
      const next = find(event.target);
      if (next) show(next);
      else if (visible) {
        // Crossing the small gap to the hint must not cancel the leave grace period.
        clearTimeout(closing);
        closing = setTimeout(hide, 120);
      } else hide();
    };
    const out = (event: PointerEvent) => {
      if (focusAnchor) return;
      if (event.relatedTarget instanceof Node && ref.current?.contains(event.relatedTarget)) return;
      if (find(event.relatedTarget) === anchor && anchor) return;
      if (!visible) return hide();
      closing = setTimeout(hide, 120);
    };
    const focus = (event: FocusEvent) => {
      if (!pointerFocus && event.target instanceof Element && event.target.matches(":focus-visible")) {
        const next = find(event.target);
        show(next, true);
        focusAnchor = anchor;
      }
    };
    const blur = () => {
      focusAnchor = null;
      // Selecting hint text may move focus off its trigger; retain the hovered hint.
      if (!ref.current?.matches(":hover")) hide();
    };
    const down = (event: PointerEvent) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return;
      pointerFocus = true;
      hide();
    };
    const key = (event: KeyboardEvent) => {
      pointerFocus = false;
      const selected = document.getSelection()?.anchorNode;
      if (["Control", "Meta", "Shift", "Alt"].includes(event.key) ||
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && selected && ref.current?.contains(selected))) return;
      // Input shortcuts and completion own Escape even when a nearby hint is visible.
      const editing = event.target instanceof Element && !!event.target.closest("input,textarea,[contenteditable=true]");
      if (event.key === "Escape" && visible && !editing) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      if (event.key !== "Tab") hide();
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return;
      hide();
    };
    const observer = new MutationObserver(() => {
      if (!anchor) return;
      const text = anchor.getAttribute("data-tooltip");
      if (!anchor.isConnected || !anchor.getClientRects().length || !text?.trim()) return hide();
      setTip(current => current && current.text !== text ? { anchor: anchor!, text } : current);
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-tooltip", "hidden", "open"] });
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", blur);
    document.addEventListener("keydown", key, true);
    document.addEventListener("scroll", scroll, true);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("blur", hide);
    window.addEventListener("resize", hide);
    return () => {
      hide();
      observer.disconnect();
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", blur);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("scroll", scroll, true);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("blur", hide);
      window.removeEventListener("resize", hide);
    };
  }, []);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!tip || !node) return;
    // Native popover puts the hint above modal dialogs without changing focus.
    const disposePopover = openPopover(node);
    const position = () => {
      const rect = tip.anchor.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0, viewportTop = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? innerWidth, viewportHeight = viewport?.height ?? innerHeight;
      const gutter = 10, gap = 8;
      node.style.setProperty("--tooltip-viewport-width", `${Math.max(0, viewportWidth - gutter * 2)}px`);
      node.style.setProperty("--tooltip-viewport-height", `${Math.max(0, viewportHeight - gutter * 2)}px`);
      const { width, height } = node.getBoundingClientRect();
      const left = Math.max(viewportLeft + gutter, Math.min(rect.left + (rect.width - width) / 2, viewportLeft + viewportWidth - width - gutter));
      const above = rect.top - height - gap;
      const top = Math.max(viewportTop + gutter, Math.min(above >= viewportTop + gutter ? above : rect.bottom + gap, viewportTop + viewportHeight - height - gutter));
      node.style.left = `${left}px`;
      node.style.top = `${top}px`;
      node.style.visibility = "visible";
    };
    position();
    const resize = new ResizeObserver(position);
    resize.observe(node);
    resize.observe(tip.anchor);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    const previous = tip.anchor.getAttribute("aria-describedby")?.split(/\s+/).filter(Boolean) ?? [];
    tip.anchor.setAttribute("aria-describedby", [...new Set([...previous, id])].join(" "));
    return () => {
      resize.disconnect();
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      disposePopover();
      const remaining = tip.anchor.getAttribute("aria-describedby")?.split(/\s+/).filter(value => value && value !== id);
      if (remaining?.length) tip.anchor.setAttribute("aria-describedby", remaining.join(" "));
      else tip.anchor.removeAttribute("aria-describedby");
    };
  }, [tip, id]);

  // Mount within a modal when necessary so the hint remains hoverable there.
  return tip ? createPortal(
    <div ref={ref} id={id} role="tooltip" className="axiom-tooltip" popover="manual">{tip.text}</div>,
    popoverHost(tip.anchor),
  ) : null;
}
