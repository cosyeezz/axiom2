import { useLayoutEffect, type RefObject } from "react";
import "../styles/sticky-disclosures.css";

const disclosureSelector = "details[open]";

/** CSS handles sticky headings without moving the reader when details change. */
export function useStickyDisclosures(container: RefObject<HTMLElement | null>, followBottom: RefObject<boolean>) {
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    let frame = 0;
    const observed = new Set<HTMLElement>();
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    const resize = new ResizeObserver(schedule);
    const measure = () => {
      const headings = new Map<Element, { node: HTMLElement; height: number; top: number; depth: number }>();
      for (const block of root.querySelectorAll(disclosureSelector)) {
        // Closed ancestors can retain mounted, individually open disclosures.
        if (block.parentElement?.closest("details:not([open])")) continue;
        const node = block.querySelector<HTMLElement>(":scope > summary");
        if (node) headings.set(block, { node, height: node.getBoundingClientRect().height, top: 0, depth: 0 });
      }
      // DOM order guarantees that an ancestor's offset is known before its children.
      for (const [block, heading] of headings) {
        const parent = block.parentElement?.closest(disclosureSelector);
        const above = parent && headings.get(parent);
        if (above) {
          heading.top = above.top + above.height;
          heading.depth = above.depth + 1;
        }
      }
      const current = new Set([...headings.values()].map(({ node }) => node));
      for (const node of observed) {
        if (current.has(node)) continue;
        resize.unobserve(node);
        node.removeAttribute("data-sticky-disclosure");
        node.style.removeProperty("--disclosure-top");
        node.style.removeProperty("--disclosure-layer");
        observed.delete(node);
      }
      for (const { node, top, depth } of headings.values()) {
        if (!node.hasAttribute("data-sticky-disclosure")) node.setAttribute("data-sticky-disclosure", "");
        if (node.style.getPropertyValue("--disclosure-top") !== `${top}px`) node.style.setProperty("--disclosure-top", `${top}px`);
        if (node.style.getPropertyValue("--disclosure-layer") !== String(100 - depth)) node.style.setProperty("--disclosure-layer", String(100 - depth));
        if (!observed.has(node)) { observed.add(node); resize.observe(node); }
      }
    };
    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes" && record.attributeName === "open"
          && record.target instanceof HTMLDetailsElement && record.target.open) {
          // Opening details pauses before resize, including asynchronous content.
          // User clicks already pause on capture; automatic final-process folding
          // must leave normal output following intact.
          followBottom.current = false;
        }
      }
      schedule();
    });
    mutations.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    measure();
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resize.disconnect();
      for (const node of observed) {
        node.removeAttribute("data-sticky-disclosure");
        node.style.removeProperty("--disclosure-top");
        node.style.removeProperty("--disclosure-layer");
      }
    };
  }, [container, followBottom]);
}
