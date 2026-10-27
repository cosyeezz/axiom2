import { Fragment, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import { nextDelivery, type ScrollDirection } from "./delivery-navigation.js";
import { flushSync } from "react-dom";

export interface TimelineNavigation {
  step: (direction: ScrollDirection) => boolean;
  cancel: () => void;
  /** Owns the viewport for an explicit jump to a physical edge. */
  edge: (target: "top" | "bottom", behavior?: "instant" | "smooth") => void;
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
  /** A mounted lazy body still has only its loading placeholder. */
  isPending?: () => boolean;
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
/**
 * Keys that mean "go to an edge" (Home/End, macOS Cmd+Up/Down). A native
 * Home/End animation targets the estimated edge: rows mounting on the way change
 * it (Chrome stops short) and anchor correction cancels it (WebKit stops
 * midway). Callers route these to the controlled `edge()` jump instead.
 */
export function timelineKeyEdge(event: Pick<KeyboardEvent, "key" | "metaKey" | "shiftKey" | "altKey" | "ctrlKey">) {
  if (event.shiftKey || event.altKey || event.ctrlKey) return null;
  return event.key === "Home" || event.metaKey && event.key === "ArrowUp" ? "top"
    : event.key === "End" || event.metaKey && event.key === "ArrowDown" ? "bottom" : null;
}
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
  const edgeWatch = useRef<(() => void) | null>(null);
  const releaseEdge = () => {
    edgeHold.current = null;
    cancelAnimationFrame(edgeFrame.current);
    edgeFrame.current = 0;
    edgeWatch.current?.(); edgeWatch.current = null;
  };
  useLayoutEffect(() => () => releaseEdge(), []);
  useLayoutEffect(() => { deliveryCursor.current = null; setReveal(editReveal); }, [editReveal?.key, editReveal?.revision]);
  const heights = useRef(new Map<string, number>());
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  const renderedViewport = useRef(viewport); renderedViewport.current = viewport;
  const fillBudget = useRef({ passes: 0, frame: 0, pending: false });
  const [, invalidate] = useState(0);
  const anchor = useRef<{ key: string; offset: number; messageId?: string } | null>(null);
  const positioning = useRef(false);
  const scrollGesture = useRef({ active: false, position: 0 });
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
  const record = (manual = false) => {
    const el = scrollElement();
    if (!el || !hasLayout() || positioning.current) return;
    const mounted = [...root.current?.querySelectorAll<HTMLElement>(':scope > [data-timeline-key]') ?? []];
    // A native disclosure can clamp scrollTop before its new height is measured.
    // Preserve the old anchor for layout-only scrolling, but never discard a
    // reader's new position just because an unrelated row is still resizing.
    if (!manual) for (const row of mounted) {
      const measured = heights.current.get(row.dataset.timelineKey!);
      if (measured !== undefined && Math.abs(row.getBoundingClientRect().height - measured) > .5) return;
    }
    const { rows, offsets } = geometry.current;
    const viewTop = el.getBoundingClientRect().top;
    const visible = mounted.find(row => row.getBoundingClientRect().bottom > viewTop);
    if (visible && (visible.getBoundingClientRect().top <= viewTop || visible.dataset.timelineKey === rows[0]?.key)) {
      // Newly mounted rows already have real DOM heights while offsets can still
      // contain estimates. Anchor to what the reader sees, not that stale model.
      const key = visible.dataset.timelineKey!;
      anchor.current = { key, offset: visible.getBoundingClientRect().top - viewTop,
        messageId: rows.find(row => row.key === key)?.messageIds?.[0] };
      return;
    }
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
  const captureGesture = () => {
    const el = scrollElement();
    // Capture against the DOM/offset generation that received the gesture,
    // before replacing offsets with a new batch of measured heights.
    if (el && scrollGesture.current.active && Math.abs(el.scrollTop - scrollGesture.current.position) > .5) record(true);
  };
  const restore = () => {
    const el = scrollElement();
    if (!el || following.current || !hasLayout() || edgeHold.current) return;
    const saved = anchor.current;
    if (!saved) return;
    const { rows, offsets } = geometry.current;
    let i = rows.findIndex(row => row.key === saved.key);
    const fallback = i < 0;
    if (i < 0 && saved.messageId) i = rows.findIndex(row => row.messageIds?.includes(saved.messageId!));
    if (i < 0) return;
    // Storage promotion/renaming is not expansion to a different body. Keep a
    // reader's negative inset inside the same first message, even after a key
    // changes; clamping it to 0 would jump a tall reply back to its beginning.
    const sameMessage = saved.messageId && rows[i].messageIds?.[0] === saved.messageId;
    const offset = fallback && !sameMessage ? Math.max(0, Math.min(24, saved.offset)) : saved.offset;
    const top = topInScroller() + offsets[i] - offset;
    if (Math.abs(el.scrollTop - top) > .5) el.scrollTop = top;
    scrollGesture.current.position = el.scrollTop;
    if (scrollPosition) scrollPosition.current = el.scrollTop;
  };
  const commitHeights = () => {
    captureGesture();
    const current = geometry.current, offsets = [0];
    for (const row of current.rows) offsets.push(offsets.at(-1)! + (heights.current.get(row.key) ?? row.estimate));
    geometry.current = { ...current, offsets };
    restore(); invalidate(n => n + 1); measureViewport();
  };
  useImperativeHandle(navigation, () => ({
    cancel: () => {
      const controlled = positioning.current || edgeHold.current !== null;
      releaseEdge(); deliveryCursor.current = null; positioning.current = false;
      // A gesture can interrupt a smooth/streaming jump before its first scroll
      // event. Transfer the DOM position now, not the anchor from before the jump.
      if (controlled) record(true);
      setReveal(undefined);
    },
    edgeActive: () => edgeHold.current !== null,
    edge: (target, behavior = "instant") => {
      const el = scrollElement();
      if (!el) return;
      releaseEdge();
      edgeHold.current = target;
      positioning.current = true;
      // Native smooth scrolling runs on the compositor: even a synchronous
      // scroll listener can mount the body AFTER a blank spacer was painted.
      // Keep smooth motion, but commit each position and its virtual window in
      // one main-thread frame. Newly measured rows can change the destination.
      const start = performance.now();
      const distance = Math.abs((target === "top" ? 0 : el.scrollHeight - el.clientHeight) - el.scrollTop);
      const duration = behavior === "smooth" ? Math.min(1000, 180 + Math.sqrt(distance) * 2.5) : 0;
      let previousProgress = 0, previousHeight = -1, stable = 0, frames = 0;
      const settle = (now: number) => {
        edgeFrame.current = 0;
        const current = scrollElement();
        if (!current || edgeHold.current !== target || ++frames > 240) { releaseEdge(); positioning.current = false; record(); return; }
        const elapsed = duration ? Math.min(1, (now - start) / duration) : 1;
        const progress = 1 - (1 - elapsed) ** 3;
        const fraction = previousProgress < 1 ? (progress - previousProgress) / (1 - previousProgress) : 1;
        previousProgress = progress;
        const edge = target === "top" ? 0 : current.scrollHeight - current.clientHeight;
        current.scrollTo({ top: current.scrollTop + (edge - current.scrollTop) * fraction, behavior: "instant" });
        if (scrollPosition) scrollPosition.current = current.scrollTop;
        flushSync(measureViewport);
        const measuredEdge = target === "top" ? 0 : current.scrollHeight - current.clientHeight;
        // Engines snap scrollTop to (device) pixels: WebKit to whole CSS px, so a
        // fractional edge or target is reached within 1px, never within .5px.
        stable = elapsed === 1 && Math.abs(measuredEdge - current.scrollTop) < 1 && current.scrollHeight === previousHeight ? stable + 1 : 0;
        previousHeight = current.scrollHeight;
        if (stable >= 2) {
          const mounted = new Set([...root.current?.querySelectorAll<HTMLElement>("[data-timeline-key]") ?? []].map(row => row.dataset.timelineKey!));
          if (geometry.current.rows.some(row => mounted.has(row.key) && row.isPending?.())) {
            // Stable placeholder height is not a settled edge. Sleep until a
            // body/measurement changes, retaining ownership without a busy rAF
            // loop; the arriving body must get its own committed final position.
            frames = 0;
            return;
          }
          releaseEdge(); positioning.current = false; record(); return;
        }
        edgeFrame.current = requestAnimationFrame(settle);
      };
      const schedule = () => {
        if (!edgeFrame.current && edgeHold.current === target) edgeFrame.current = requestAnimationFrame(settle);
      };
      const changes = new MutationObserver(schedule), resize = new ResizeObserver(schedule);
      if (root.current) { changes.observe(root.current, { childList: true, subtree: true, characterData: true }); resize.observe(root.current); }
      resize.observe(el);
      edgeWatch.current = () => { changes.disconnect(); resize.disconnect(); };
      schedule();
    },
    step: direction => {
      const el = scrollElement(), node = root.current;
      if (!el || !node || !hasLayout()) return false;
      // A reveal still in flight owns the cursor (rapid clicks).
      const revealing = positioning.current && edgeHold.current === null;
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
      // The cursor also covers a delivery clamped at an edge, which can never sit
      // on the reading line. Any other scroll since the reveal (selection or
      // find autoscroll, programmatic jumps) leaves it off-screen: the reading
      // line is then authoritative, not a stale step from an old position.
      const top = el.scrollTop - origin, cursor = candidates.find(candidate => candidate.key === deliveryCursor.current);
      const current = cursor && (revealing || cursor.start >= top - 1 && cursor.start <= top + el.clientHeight) ? cursor.key : null;
      const target = nextDelivery(candidates, top + 24, direction, current);
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
    let gestureFrame = 0;
    let scrollbarPointer: number | undefined;
    // Keep ownership through touch/keyboard inertia, not just the first scroll
    // event. Release after movement settles, including browsers without scrollend.
    const settleGesture = () => {
      cancelAnimationFrame(gestureFrame);
      let top = el.scrollTop, stable = 0;
      const settle = () => {
        stable = Math.abs(el.scrollTop - top) <= .5 ? stable + 1 : 0;
        top = el.scrollTop;
        if (stable >= 2 && scrollbarPointer === undefined) { scrollGesture.current.active = false; gestureFrame = 0; }
        else gestureFrame = requestAnimationFrame(settle);
      };
      gestureFrame = requestAnimationFrame(settle);
    };
    const gesture = () => {
      if (!scrollGesture.current.active) scrollGesture.current.position = el.scrollTop;
      scrollGesture.current.active = true; settleGesture();
    };
    const wheel = (event: WheelEvent) => { if (event.deltaY && !event.ctrlKey) gesture(); };
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable=true]"))) return;
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) gesture();
    };
    const pointer = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.target !== el) return;
      const rect = el.getBoundingClientRect(), gutter = Math.max(14, el.offsetWidth - el.clientWidth);
      if (event.clientX >= rect.right - gutter || event.clientX <= rect.left + gutter) { scrollbarPointer = event.pointerId; gesture(); }
    };
    const pointerMove = (event: PointerEvent) => { if (event.pointerId === scrollbarPointer) gesture(); };
    const pointerUp = () => { scrollbarPointer = undefined; };
    const update = () => {
      record(scrollGesture.current.active);
      scrollGesture.current.position = el.scrollTop;
      if (scrollGesture.current.active) settleGesture();
      const top = el.scrollTop - topInScroller(), previous = renderedViewport.current;
      const buffer = Math.max(600, previous.height);
      if (top < previous.top - buffer || top + el.clientHeight > previous.top + previous.height + buffer) {
        // A thumb drag / large wheel step can outrun overscan in one event.
        // Do not paint the old spacer for another frame before mounting its body.
        cancelAnimationFrame(frame.current); frame.current = 0;
        flushSync(measureViewport);
      } else if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; measureViewport(); });
    };
    el.addEventListener("scroll", update, { passive: true });
    el.addEventListener("wheel", wheel, { passive: true });
    el.addEventListener("touchmove", gesture, { passive: true });
    el.addEventListener("keydown", key);
    el.addEventListener("pointerdown", pointer);
    window.addEventListener("pointermove", pointerMove);
    window.addEventListener("pointerup", pointerUp);
    window.addEventListener("pointercancel", pointerUp);
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
        captureGesture();
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
    return () => {
      el.removeEventListener("scroll", update);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("touchmove", gesture);
      el.removeEventListener("keydown", key);
      el.removeEventListener("pointerdown", pointer);
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("pointercancel", pointerUp);
      document.removeEventListener("selectionchange", selection);
      resize.disconnect(); cancelAnimationFrame(gestureFrame); cancelAnimationFrame(frame.current); frame.current = 0;
    };
  }, []);
  useLayoutEffect(() => {
    if (previousSignature.current !== signature) { captureGesture(); restore(); previousSignature.current = signature; }
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
      stable = Math.abs(previousTop - top) < .5 && Math.abs(el!.scrollTop - clamped) < 1 ? stable + 1 : 0;
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
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.timelineKey!;
        const height = entry.borderBoxSize[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
        // Empty/unloaded messages are real zero-height rows, not estimated gaps.
        if (height >= 0 && Math.abs((heights.current.get(key) ?? -1) - height) > .5) { heights.current.set(key, height); changed = true; }
      }
      if (!changed) return;
      commitHeights();
    });
    const mounted = new Set(node.querySelectorAll<HTMLElement>(":scope > [data-timeline-key]"));
    for (const row of observed.current) if (!mounted.has(row)) observer.unobserve(row);
    for (const row of mounted) if (!observed.current.has(row)) observer.observe(row);
    observed.current = mounted;
    if (!hasLayout()) return;
    const unknown = [...mounted].filter(row => !heights.current.has(row.dataset.timelineKey!));
    if (!unknown.length) return;
    const budget = fillBudget.current;
    if (budget.passes >= 24) { budget.pending = true; return; }
    // Correct new rows before paint, rather than discovering a few short rows
    // per ResizeObserver frame while the rest of the viewport is still spacer.
    // Reads are batched, and pathological/empty histories get a bounded budget.
    for (const row of unknown) heights.current.set(row.dataset.timelineKey!, row.getBoundingClientRect().height);
    budget.passes++;
    if (!budget.frame) budget.frame = requestAnimationFrame(() => {
      budget.frame = 0; budget.passes = 0;
      if (budget.pending) { budget.pending = false; invalidate(n => n + 1); }
    });
    commitHeights();
  });
  useLayoutEffect(() => () => {
    rowObserver.current?.disconnect(); rowObserver.current = null; observed.current.clear();
    cancelAnimationFrame(fillBudget.current.frame);
  }, []);
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
  // A keyed thread follows its tail before the parent can scroll the new DOM.
  // Select that window from the current geometry on every render, including
  // late catalogues and row measurements; never hydrate a head window first.
  // Explicit navigation and selected/focused reading still own their viewport.
  const windowTop = following.current && !positioning.current && !edgeHold.current && !pinned.size
    ? Math.max(0, offsets.at(-1)! - viewport.height) : viewport.top;
  const visible = rows.map((row, i) => ({ row, i })).filter(({ row, i }) =>
    offsets[i + 1] >= windowTop - overscan && offsets[i] <= windowTop + viewport.height + overscan || pinned.has(row.key));
  let end = 0;
  // React deletes the old window's rows/spacers before inserting the new ones.
  // WebKit clamps scrollTop to that transiently short content (Chrome does not),
  // which threw a bottom/edge jump or a fast wheel back to 0. The root keeps the
  // virtual total during commit; its own style updates after the children.
  return <div ref={root} className="virtual-timeline" style={{ minHeight: offsets.at(-1) }} data-total-rows={rows.length} data-window-top={Math.round(windowTop)}>
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
