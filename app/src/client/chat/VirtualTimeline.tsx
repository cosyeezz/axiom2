import { Fragment, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import { nextDelivery, type ScrollDirection } from "./delivery-navigation.js";

export interface TimelineNavigation {
  step: (direction: ScrollDirection) => boolean;
  cancel: () => void;
  /** Owns the viewport for an explicit jump to a physical edge. */
  edge: (target: "top" | "bottom") => void;
  /** The jump's own scrolling must not be mistaken for a manual gesture. */
  edgeActive: () => boolean;
}

export interface TimelineRow {
  key: string;
  messageIds?: string[];
  delivery?: boolean;
  /** Cached message fallback for catalogues from an older running backend. */
  isDelivery?: () => boolean;
  estimate: number;
  revision?: string;
  /** The card disappears on expansion; anchor to its first source message. */
  expandTo?: string;
  segmentId?: string;
  render: () => ReactNode;
}
/** A composer's caret must not invalidate an unrelated history window. */
function selectedRows(root: HTMLElement | null) {
  const keys = new Set<string>();
  const selection = typeof getSelection === "function" ? getSelection() : null;
  if (root && selection?.toString()) for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    root.querySelectorAll<HTMLElement>(":scope > [data-timeline-key]").forEach(node => {
      if (range.intersectsNode(node)) keys.add(node.dataset.timelineKey!);
    });
  }
  return keys;
}
/** Variable-height windowing at whole-message/process boundaries. No visible pagination. */
export function VirtualTimeline({ rows, scroller, following, scrollPosition, reveal: editReveal, navigation }: {
  rows: TimelineRow[]; scroller: RefObject<HTMLElement | null>; following: RefObject<boolean>;
  scrollPosition?: RefObject<number>;
  reveal?: { key: string; selector: string; revision: number };
  navigation?: Ref<TimelineNavigation>;
}) {
  const root = useRef<HTMLDivElement>(null);
  // A reveal is a request, not a fallback. Cancelling a delivery must never
  // reactivate an already-handled editor request that is still present in props.
  const [reveal, setReveal] = useState(editReveal);
  const deliveryCursor = useRef<string | null>(null);
  // Rows above the viewport mount while a jump to an edge is in flight. Restoring
  // the old anchor there would stop the jump short of the physical edge, which
  // looks like a jump to a nearby delivery instead of the real top or bottom.
  const edgeHold = useRef<"top" | "bottom" | null>(null);
  const edgeFrame = useRef(0);
  const releaseEdge = () => {
    edgeHold.current = null;
    cancelAnimationFrame(edgeFrame.current);
    edgeFrame.current = 0;
  };
  useLayoutEffect(() => () => releaseEdge(), []);
  useLayoutEffect(() => { deliveryCursor.current = null; setReveal(editReveal); }, [editReveal?.key, editReveal?.revision]);
  const heights = useRef(new Map<string, number>());
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  const [, invalidate] = useState(0);
  const anchor = useRef<{ key: string; offset: number; messageId?: string } | null>(null);
  const positioning = useRef(false);
  const expandFocus = useRef<string | null>(null);
  const signature = rows.map(row => `${row.key}:${row.revision ?? ""}`).join("\n");
  const previousSignature = useRef(signature);
  const frame = useRef(0);
  const selectionSignature = useRef("[]");
  const rowObserver = useRef<ResizeObserver | null>(null);
  const observed = useRef(new Set<HTMLElement>());
  const offsets = [0];
  for (const row of rows) offsets.push(offsets.at(-1)! + (heights.current.get(row.key) ?? row.estimate));
  const geometry = useRef({ rows, offsets }); geometry.current = { rows, offsets };
  // Child layout effects can run before the parent's host ref is attached.
  const scrollElement = () => scroller.current ?? root.current?.closest<HTMLElement>(".thread") ?? null;
  // display:none is not an empty message: preserve measurements while the pane has no layout.
  const hasLayout = () => {
    const el = scrollElement();
    return !!el?.clientWidth && !!el.clientHeight && !!root.current?.getClientRects().length;
  };
  const topInScroller = () => {
    const el = scrollElement(), node = root.current;
    return el && node ? node.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop : 0;
  };
  const record = () => {
    const el = scrollElement();
    if (!el || !hasLayout() || positioning.current) return;
    // A native disclosure can shrink before ResizeObserver updates the window.
    // The browser may temporarily clamp scrollTop while following rows are
    // still estimated. Do not replace the reading anchor with that clamp.
    for (const row of root.current?.querySelectorAll<HTMLElement>(':scope > [data-timeline-key]') ?? []) {
      const measured = heights.current.get(row.dataset.timelineKey!);
      if (measured !== undefined && Math.abs(row.getBoundingClientRect().height - measured) > .5) return;
    }
    const { rows, offsets } = geometry.current;
    const top = el.scrollTop - topInScroller();
    const i = rows.findIndex((_, i) => offsets[i + 1] > top);
    if (i >= 0) anchor.current = { key: rows[i].key, offset: offsets[i] - top, messageId: rows[i].messageIds?.[0] };
  };
  const measureViewport = () => {
    const el = scrollElement();
    if (!el || !hasLayout()) return;
    const top = el.scrollTop - topInScroller(), height = el.clientHeight;
    setViewport(old => old.top === top && old.height === height ? old : { top, height });
  };
  const restore = () => {
    const el = scrollElement(), saved = anchor.current;
    if (!el || !saved || following.current || !hasLayout() || edgeHold.current) return;
    const { rows, offsets } = geometry.current;
    let i = rows.findIndex(row => row.key === saved.key);
    const fallback = i < 0;
    if (i < 0 && saved.messageId) i = rows.findIndex(row => row.messageIds?.includes(saved.messageId!));
    if (i < 0) return;
    const offset = fallback ? Math.max(0, Math.min(24, saved.offset)) : saved.offset;
    const top = topInScroller() + offsets[i] - offset;
    if (Math.abs(el.scrollTop - top) > .5) el.scrollTop = top;
    if (scrollPosition) scrollPosition.current = el.scrollTop;
  };
  useImperativeHandle(navigation, () => ({
    cancel: () => { releaseEdge(); deliveryCursor.current = null; positioning.current = false; setReveal(undefined); },
    edgeActive: () => edgeHold.current !== null,
    edge: target => {
      const el = scrollElement();
      if (!el) return;
      releaseEdge();
      edgeHold.current = target;
      positioning.current = true;
      // Mounting and measurement happen over several frames. Keep the anchor
      // untouched until the edge and the measured height both stop changing.
      let previousHeight = -1, previousTop = -1, stable = 0, frames = 0;
      const settle = () => {
        edgeFrame.current = 0;
        const current = scrollElement();
        if (!current || edgeHold.current !== target || ++frames > 240) { releaseEdge(); positioning.current = false; record(); return; }
        const top = current.scrollTop, moving = Math.abs(top - previousTop) > .5;
        previousTop = top;
        const edge = target === "top" ? 0 : current.scrollHeight - current.clientHeight;
        if (Math.abs(edge - top) > .5) {
          // A smooth jump is still travelling. Only re-assert the edge once it
          // stops, when newly mounted rows have displaced the final position.
          if (!moving) current.scrollTo({ top: edge, behavior: "instant" });
          stable = 0;
        } else stable = current.scrollHeight === previousHeight ? stable + 1 : 0;
        previousHeight = current.scrollHeight;
        if (stable >= 2) { releaseEdge(); positioning.current = false; record(); return; }
        edgeFrame.current = requestAnimationFrame(settle);
      };
      edgeFrame.current = requestAnimationFrame(settle);
    },
    step: direction => {
      const el = scrollElement(), node = root.current;
      if (!el || !node || !hasLayout()) return false;
      // Stepping returns to delivery control after a jump to an edge.
      releaseEdge(); positioning.current = false;
      const { rows, offsets } = geometry.current;
      const origin = topInScroller(), scrollerTop = el.getBoundingClientRect().top;
      const mounted = new Map([...node.querySelectorAll<HTMLElement>("[data-delivery-start]")].map(body =>
        [body.closest<HTMLElement>("[data-timeline-key]")!.dataset.timelineKey!, body.getBoundingClientRect()]));
      const candidates = rows.flatMap((row, i) => {
        const bounds = mounted.get(row.key);
        if (!row.delivery && !row.isDelivery?.() && !bounds) return [];
        return [{ key: row.key, start: bounds ? bounds.top - scrollerTop + el.scrollTop - origin : offsets[i] }];
      });
      const target = nextDelivery(candidates, el.scrollTop - origin + 24, direction, deliveryCursor.current);
      if (!target) return false;
      deliveryCursor.current = target.key;
      setReveal(previous => ({ key: target.key,
        selector: `[data-timeline-key="${CSS.escape(target.key)}"] [data-delivery-start]`, revision: (previous?.revision ?? 0) + 1 }));
      return true;
    },
  }));
  useLayoutEffect(() => {
    const el = scrollElement();
    if (!el) return;
    const update = () => {
      record();
      if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; measureViewport(); });
    };
    el.addEventListener("scroll", update, { passive: true });
    const selection = () => {
      const signature = JSON.stringify([...selectedRows(root.current)]);
      if (selectionSignature.current === signature) return;
      selectionSignature.current = signature;
      update(); invalidate(n => n + 1);
    };
    document.addEventListener("selectionchange", selection);
    let width = root.current?.getBoundingClientRect().width;
    const resize = new ResizeObserver(() => {
      if (!hasLayout()) return;
      const nextWidth = root.current?.getBoundingClientRect().width;
      if (width !== undefined && nextWidth !== undefined && Math.abs(nextWidth - width) > .5) {
        heights.current.clear();
        const current = geometry.current, offsets = [0];
        for (const row of current.rows) offsets.push(offsets.at(-1)! + row.estimate);
        geometry.current = { rows: current.rows, offsets };
        restore(); invalidate(n => n + 1);
      }
      width = nextWidth; measureViewport();
    });
    resize.observe(el); if (root.current) resize.observe(root.current);
    measureViewport(); record();
    return () => { el.removeEventListener("scroll", update); document.removeEventListener("selectionchange", selection); resize.disconnect(); cancelAnimationFrame(frame.current); frame.current = 0; };
  }, []);
  useLayoutEffect(() => {
    if (previousSignature.current !== signature) { restore(); previousSignature.current = signature; }
    measureViewport(); record();
  }, [rows]);
  useLayoutEffect(() => {
    if (!reveal) return;
    const el = scrollElement(), node = root.current;
    const i = geometry.current.rows.findIndex(row => row.key === reveal.key);
    if (!el || !node || i < 0) return;
    following.current = false;
    positioning.current = true;
    anchor.current = { key: reveal.key, offset: 24 };
    el.scrollTo({ top: topInScroller() + geometry.current.offsets[i] - 24, behavior: "instant" });
    if (scrollPosition) scrollPosition.current = el.scrollTop;
    measureViewport();
    // Mounting and row-height measurements can happen in different frames. Keep
    // the intended row anchor until its real body and geometry have both settled;
    // recording a clamped estimated jump instead would lose a tall tail's start.
    let frame = 0, stable = 0, previousTop = NaN;
    const observer = new MutationObserver(schedule);
    function schedule() { if (!frame) frame = requestAnimationFrame(position); }
    function position() {
      frame = 0;
      const target = node!.querySelector<HTMLElement>(reveal!.selector);
      const row = target?.closest<HTMLElement>("[data-timeline-key]");
      if (!target || !row) return; // Lazy history arrival schedules another attempt.
      const withinRow = target.getBoundingClientRect().top - row.getBoundingClientRect().top;
      anchor.current = { key: reveal!.key, offset: 24 - withinRow };
      following.current = false;
      const top = el!.scrollTop + target.getBoundingClientRect().top - el!.getBoundingClientRect().top - 24;
      el!.scrollTo({ top, behavior: "instant" });
      if (scrollPosition) scrollPosition.current = el!.scrollTop;
      measureViewport();
      // At either physical edge the requested inset can be impossible.
      const clamped = Math.max(0, Math.min(top, el!.scrollHeight - el!.clientHeight));
      stable = Math.abs(previousTop - top) < .5 && Math.abs(el!.scrollTop - clamped) < .5 ? stable + 1 : 0;
      previousTop = top;
      if (stable >= 2) { positioning.current = false; record(); observer.disconnect(); }
      else schedule();
    }
    observer.observe(node, { subtree: true, childList: true });
    schedule();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); positioning.current = false; };
  }, [reveal?.key, reveal?.revision]);
  useLayoutEffect(() => {
    if (expandFocus.current) {
      const key = rows.find(row => row.messageIds?.includes(expandFocus.current!))?.key;
      const row = key && root.current?.querySelector<HTMLElement>(`[data-timeline-key="${CSS.escape(key)}"]`);
      if (row) { row.tabIndex = -1; row.focus({ preventScroll: true }); expandFocus.current = null; }
    }
  });
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = rowObserver.current ??= new ResizeObserver(entries => {
      if (!hasLayout()) return;
      let changed = false;
      const current = geometry.current;
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.timelineKey!;
        const height = entry.borderBoxSize[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
        // Empty/unloaded messages are real zero-height rows, not estimated gaps.
        if (height >= 0 && Math.abs((heights.current.get(key) ?? -1) - height) > .5) { heights.current.set(key, height); changed = true; }
      }
      if (!changed) return;
      const offsets = [0];
      for (const row of current.rows) offsets.push(offsets.at(-1)! + (heights.current.get(row.key) ?? row.estimate));
      geometry.current = { ...current, offsets };
      restore(); invalidate(n => n + 1); measureViewport();
    });
    const mounted = new Set(node.querySelectorAll<HTMLElement>(":scope > [data-timeline-key]"));
    for (const row of observed.current) if (!mounted.has(row)) observer.unobserve(row);
    for (const row of mounted) if (!observed.current.has(row)) observer.observe(row);
    observed.current = mounted;
  });
  useLayoutEffect(() => () => { rowObserver.current?.disconnect(); rowObserver.current = null; observed.current.clear(); }, []);
  // Selection and focus pin only their own rows, never the entire history window.
  const pinned = selectedRows(root.current);
  const pin = (node: Node | null | undefined) => {
    const row = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>("[data-timeline-key]");
    if (row && root.current?.contains(row)) pinned.add(row.dataset.timelineKey!);
  };
  pin(document.activeElement);
  if (pinned.size) {
    // Preserve intermediate selected rows, not just the range endpoints.
    const positions = rows.flatMap((row, i) => pinned.has(row.key) ? [i] : []);
    if (positions.length) for (let i = Math.min(...positions); i <= Math.max(...positions); i++) pinned.add(rows[i].key);
  }
  // Navigation targets mount individually; do not pin every intervening row.
  if (reveal) pinned.add(reveal.key);
  const expandedKey = expandFocus.current && rows.find(row => row.messageIds?.includes(expandFocus.current!))?.key;
  if (expandedKey) pinned.add(expandedKey);
  const overscan = Math.max(600, viewport.height);
  const visible = rows.map((row, i) => ({ row, i })).filter(({ row, i }) =>
    offsets[i + 1] >= viewport.top - overscan && offsets[i] <= viewport.top + viewport.height + overscan || pinned.has(row.key));
  let end = 0;
  return <div ref={root} className="virtual-timeline" data-total-rows={rows.length} data-window-top={Math.round(viewport.top)}>
    {visible.map(({ row, i }) => {
      const gap = offsets[i] - end; end = offsets[i + 1];
      return <Fragment key={row.key}>
        {gap > 0 && <div className="timeline-spacer" style={{ height: gap }} aria-hidden="true" />}
        <div data-timeline-key={row.key} data-history-segment={row.segmentId} className="timeline-row"
          onClickCapture={event => {
            if (!(event.target instanceof Element) || !event.target.closest("[data-history-expand]")) return;
            following.current = false; deliveryCursor.current = null; positioning.current = false; setReveal(undefined);
            anchor.current = { key: row.key, offset: 24, messageId: row.expandTo };
            expandFocus.current = row.expandTo ?? null;
          }}>
          {row.render()}
        </div>
      </Fragment>;
    })}
    {offsets.at(-1)! - end > 0 && <div className="timeline-spacer" style={{ height: offsets.at(-1)! - end }} aria-hidden="true" />}
  </div>;
}
