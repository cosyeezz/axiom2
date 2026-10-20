import { useLayoutEffect, type RefObject } from "react";

/** Only user scrolling away from the tail cancels following; layout scroll events do not. */
export function useThreadScrollIntent(scroller: RefObject<HTMLElement | null>, following: RefObject<boolean>, position: RefObject<number>) {
  useLayoutEffect(() => {
    const thread = scroller.current;
    if (!thread) return;
    let touchY: number | undefined;
    let scrollbarPointer: number | undefined;
    const pauseFollowing = () => {
      following.current = false;
      // Ignore older scroll events still in flight when this upward gesture begins.
      position.current = thread.scrollTop;
    };
    // An independently scrolling detail consumes its own gesture before the thread does.
    const reachesThread = (target: EventTarget | null) => {
      for (let node = target instanceof Element ? target : null; node && node !== thread; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (/auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight &&
          (node.scrollTop > 0 || /contain|none/.test(style.overscrollBehaviorY))) return false;
      }
      return true;
    };
    const wheel = (event: WheelEvent) => {
      if (event.deltaY < 0 && !event.ctrlKey && reachesThread(event.target)) pauseFollowing();
    };
    const touchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY; };
    const touchMove = (event: TouchEvent) => {
      const next = event.touches[0]?.clientY;
      if (next !== undefined && touchY !== undefined && next > touchY && reachesThread(event.target)) pauseFollowing();
      touchY = next;
    };
    const pointerDown = (event: PointerEvent) => {
      // Native/overlay scrollbar dragging does not emit wheel or touch events.
      if (event.pointerType !== "mouse" || event.target !== thread) return;
      const rect = thread.getBoundingClientRect();
      const gutter = Math.max(14, thread.offsetWidth - thread.clientWidth);
      if (event.clientX >= rect.right - gutter || event.clientX <= rect.left + gutter) {
        scrollbarPointer = event.pointerId;
        pauseFollowing();
      }
    };
    const pointerMove = (event: PointerEvent) => {
      if (event.pointerId === scrollbarPointer) pauseFollowing();
    };
    const pointerUp = () => { scrollbarPointer = undefined; };
    const keyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.defaultPrevented || target?.closest("input, textarea, select, [contenteditable=true]")) return;
      // Buttons consume Space, but their PageUp/Home/ArrowUp still scroll the thread.
      if (event.key === " " && target?.closest("button, summary, [role=button]")) return;
      if ((event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home" || event.key === " " && event.shiftKey)
        && reachesThread(event.target)) pauseFollowing();
    };
    thread.addEventListener("wheel", wheel, { passive: true });
    thread.addEventListener("touchstart", touchStart, { passive: true });
    thread.addEventListener("touchmove", touchMove, { passive: true });
    thread.addEventListener("pointerdown", pointerDown);
    window.addEventListener("pointermove", pointerMove);
    window.addEventListener("pointerup", pointerUp);
    window.addEventListener("pointercancel", pointerUp);
    thread.addEventListener("keydown", keyDown);
    return () => {
      thread.removeEventListener("wheel", wheel);
      thread.removeEventListener("touchstart", touchStart);
      thread.removeEventListener("touchmove", touchMove);
      thread.removeEventListener("pointerdown", pointerDown);
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("pointercancel", pointerUp);
      thread.removeEventListener("keydown", keyDown);
    };
  }, [scroller, following, position]);
}
