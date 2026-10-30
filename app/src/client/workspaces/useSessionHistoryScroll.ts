import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { SessionListGroup } from "../../shared/session-list.js";
import type { useSessionListPages } from "./useSessionListPages.js";

type Pages = ReturnType<typeof useSessionListPages>;
type Anchor = { context: string; key: string; offset: number };
const rowKey = (row: HTMLElement) => JSON.stringify([row.dataset.workspaceId, row.dataset.sessionId]);

/** Scroll position belongs to the visible row, not a page number. In particular,
 * appending to the top group must not push an already visible workspace row away.
 * The loaded DOM grows with scrolling; this is not a virtualized/constant-memory list. */
export function useSessionHistoryScroll(root: RefObject<HTMLDivElement | null>, context: string, pages: Pages) {
  const top = useRef<HTMLDivElement>(null), workspace = useRef<HTMLDivElement>(null);
  const anchor = useRef<Anchor | null>(null);
  const previousContext = useRef(context);
  const capture = useCallback(() => {
    const element = root.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    for (const row of element.querySelectorAll<HTMLElement>(".history-row[data-session-id]:not([hidden])")) {
      const box = row.getBoundingClientRect();
      if (box.bottom > bounds.top && box.top < bounds.bottom) {
        anchor.current = { context, key: rowKey(row), offset: box.top - bounds.top };
        return;
      }
    }
    anchor.current = null;
  }, [root, context]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    if (previousContext.current !== context) element.scrollTop = 0;
    else if (anchor.current?.context === context) {
      const saved = anchor.current;
      const row = [...element.querySelectorAll<HTMLElement>(".history-row[data-session-id]:not([hidden])")]
        .find(row => rowKey(row) === saved.key);
      if (row) {
        const delta = row.getBoundingClientRect().top - element.getBoundingClientRect().top - saved.offset;
        if (Math.abs(delta) > 0.5) element.scrollTop += delta;
      }
    }
    previousContext.current = context;
    capture();
  });
  useEffect(() => {
    const element = root.current;
    if (!element || !pages.enabled || pages.state.loading || pages.epoch !== pages.acceptedEpoch) return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const group = (entry.target as HTMLElement).dataset.historyTail as SessionListGroup;
        // Do not repeatedly prefetch a group the user has already scrolled past.
        if (entry.target.getBoundingClientRect().bottom < element.getBoundingClientRect().top) continue;
        void pages.next(group);
      }
    }, { root: element, rootMargin: "0px 0px 160px 0px" });
    for (const group of ["top", "workspace"] as const) {
      const frame = pages.state[group], tail = group === "top" ? top.current : workspace.current;
      // Failures require the explicit retry button; intersection must not spin.
      if (tail && frame.page?.next && !frame.loading && !frame.error) observer.observe(tail);
    }
    return () => observer.disconnect();
  }, [root, pages.enabled, pages.state, pages.epoch, pages.acceptedEpoch, pages.next]);
  return { onScroll: capture, top, workspace };
}
