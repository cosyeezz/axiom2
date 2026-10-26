import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

/** Reveal just the beginning of a user-opened disclosure when it would be below the composer. */
export function useDisclosureReveal(
  scroller: RefObject<HTMLElement | null>, following: RefObject<boolean>, position: RefObject<number>,
) {
  const cancelRef = useRef(() => {});
  useLayoutEffect(() => {
    const thread = scroller.current;
    if (!thread) return;
    let measureFrame = 0, motionFrame = 0;
    let pending: { block: HTMLElement; heading: HTMLElement | null; boundary: number; start: number; budget: number } | null = null;
    let motionTarget: number | null = null;
    const stopWatching = () => {
      pending = null;
      resize.disconnect(); mutations.disconnect();
      cancelAnimationFrame(measureFrame); measureFrame = 0;
    };
    const cancel = () => {
      stopWatching();
      cancelAnimationFrame(motionFrame); motionFrame = 0; motionTarget = null;
    };
    cancelRef.current = cancel;
    const move = (target: number) => {
      if (motionTarget !== null && Math.abs(target - motionTarget) < 1) return;
      cancelAnimationFrame(motionFrame); motionFrame = 0;
      const from = thread.scrollTop;
      motionTarget = target;
      const write = (top: number) => {
        following.current = false;
        thread.scrollTo({ top, behavior: "instant" });
        // The reveal's scroll event must not count as a reader returning to the tail.
        position.current = thread.scrollTop;
      };
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
        write(target); motionTarget = null;
        return;
      }
      const start = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / 180);
        write(from + (target - from) * (1 - (1 - progress) ** 3));
        if (progress < 1) motionFrame = requestAnimationFrame(tick);
        else { motionFrame = 0; motionTarget = null; }
      };
      motionFrame = requestAnimationFrame(tick);
    };
    const measure = () => {
      const item = pending;
      if (!item) return;
      const { block, heading } = item;
      if (!thread.contains(block) || block.closest("details:not([open])") || following.current) { cancel(); return; }
      const bounds = thread.getBoundingClientRect();
      const rect = block.getBoundingClientRect();
      // Use the heading's natural position: a sticky heading moves independently of its block.
      const border = parseFloat(getComputedStyle(block).borderTopWidth) || 0;
      const inset = heading ? parseFloat(heading.style.getPropertyValue("--disclosure-top")) || 0 : 0;
      const height = heading?.getBoundingClientRect().height ?? 0;
      const room = Math.max(0, thread.clientHeight - inset - height - 20);
      const preview = Math.min(item.budget, room);
      const beginning = rect.top + (heading ? border + height : item.boundary);
      const end = Math.min(rect.bottom, beginning + preview);
      const needed = Math.max(0, end + 12 - (bounds.top + thread.clientTop + thread.clientHeight));
      const target = Math.min(thread.scrollTop + needed, item.start + item.budget + 12, thread.scrollHeight - thread.clientHeight);
      if (target > thread.scrollTop + 1) move(target);
      // Only the initial load belongs to this click. Later stream updates never restart a reveal.
      const loading = block.querySelector('.tool-truncated[role="status"], .task-call-meta[role="status"], .message-full-control button:disabled');
      if (!loading) stopWatching();
    };
    const schedule = () => {
      if (!pending || measureFrame) return;
      // Allow React's lazy body/effects and sticky heading measurements to settle first.
      measureFrame = requestAnimationFrame(() => {
        measureFrame = requestAnimationFrame(() => { measureFrame = 0; measure(); });
      });
    };
    const resize = new ResizeObserver(schedule);
    const mutations = new MutationObserver(schedule);
    const click = (event: MouseEvent) => {
      cancel();
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const summary = target?.closest<HTMLElement>("summary");
      const details = summary?.parentElement;
      let block: HTMLElement | null = null, heading: HTMLElement | null = null, boundary = 0;
      if (details instanceof HTMLDetailsElement && (!details.open || details.dataset.folding)) {
        if (target?.closest("button, a, input, select, textarea")) return;
        block = details; heading = summary!;
      } else {
        const control = target?.closest<HTMLElement>(".message-full-control");
        if (control && target?.closest("button")) {
          block = control.closest<HTMLElement>(".compaction-body, article");
          if (block) boundary = control.getBoundingClientRect().top - block.getBoundingClientRect().top;
        }
      }
      if (!block || !thread.contains(block)) return;
      following.current = false;
      pending = { block, heading, boundary, start: thread.scrollTop, budget: Math.min(320, thread.clientHeight * 0.45) };
      resize.observe(block);
      mutations.observe(block, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["open", "disabled"] });
      schedule();
    };
    const key = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Escape", "Tab"].includes(event.key)) cancel();
    };
    thread.addEventListener("click", click, true);
    // Manual gestures always win, even while a slow detail request is still pending.
    thread.addEventListener("wheel", cancel, { passive: true });
    thread.addEventListener("touchstart", cancel, { passive: true });
    document.addEventListener("pointerdown", cancel, true);
    thread.addEventListener("keydown", key);
    return () => {
      cancel(); cancelRef.current = () => {};
      thread.removeEventListener("click", click, true);
      thread.removeEventListener("wheel", cancel);
      thread.removeEventListener("touchstart", cancel);
      document.removeEventListener("pointerdown", cancel, true);
      thread.removeEventListener("keydown", key);
    };
  }, [scroller, following, position]);
  return useCallback(() => cancelRef.current(), []);
}
