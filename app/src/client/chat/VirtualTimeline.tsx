import { Fragment, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import { nextDelivery, type ScrollDirection } from "./delivery-navigation.js";
import { createPortal } from "react-dom";
import { FoldIcon } from "../StatusIcons.js";

export interface TimelineNavigation {
  step: (direction: ScrollDirection) => boolean;
  cancel: () => void;
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
  ranges?: { id: string; label: string; key: string; collapse: () => void }[];
  segmentId?: string;
  collapseKey?: string;
  render: () => ReactNode;
  collapse?: () => void;
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
  useLayoutEffect(() => { deliveryCursor.current = null; setReveal(editReveal); }, [editReveal?.key, editReveal?.revision]);
  const heights = useRef(new Map<string, number>());
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  const [, invalidate] = useState(0);
  const anchor = useRef<{ key: string; offset: number; fallback?: string; messageId?: string } | null>(null);
  const positioning = useRef(false);
  const collapseFocus = useRef<string | null>(null);
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
    const { rows, offsets } = geometry.current;
    const top = el.scrollTop - topInScroller();
    const i = rows.findIndex((_, i) => offsets[i + 1] > top);
    if (i >= 0) anchor.current = { key: rows[i].key, offset: offsets[i] - top, fallback: rows[i].collapseKey, messageId: rows[i].messageIds?.[0] };
  };
  const measureViewport = () => {
    const el = scrollElement();
    if (!el || !hasLayout()) return;
    const top = el.scrollTop - topInScroller(), height = el.clientHeight;
    setViewport(old => old.top === top && old.height === height ? old : { top, height });
  };
  const restore = () => {
    const el = scrollElement(), saved = anchor.current;
    if (!el || !saved || following.current || !hasLayout()) return;
    const { rows, offsets } = geometry.current;
    let i = rows.findIndex(row => row.key === saved.key);
    const fallback = i < 0;
    if (i < 0 && saved.messageId) i = rows.findIndex(row => row.messageIds?.includes(saved.messageId!));
    if (i < 0 && saved.fallback) i = rows.findIndex(row => row.key === saved.fallback);
    if (i < 0) return;
    const offset = fallback ? Math.max(0, Math.min(24, saved.offset)) : saved.offset;
    const top = topInScroller() + offsets[i] - offset;
    if (Math.abs(el.scrollTop - top) > .5) el.scrollTop = top;
    if (scrollPosition) scrollPosition.current = el.scrollTop;
  };
  useImperativeHandle(navigation, () => ({
    cancel: () => { deliveryCursor.current = null; positioning.current = false; setReveal(undefined); },
    step: direction => {
      const el = scrollElement(), node = root.current;
      if (!el || !node || !hasLayout()) return false;
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
    if (collapseFocus.current) {
      const key = collapseFocus.current;
      const card = root.current?.querySelector<HTMLElement>(`[data-timeline-key="${CSS.escape(key)}"] .history-disclosure`);
      if (card) { card.focus({ preventScroll: true }); collapseFocus.current = null; }
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
  if (collapseFocus.current) pinned.add(collapseFocus.current);
  const expandedKey = expandFocus.current && rows.find(row => row.messageIds?.includes(expandFocus.current!))?.key;
  if (expandedKey) pinned.add(expandedKey);
  const overscan = Math.max(600, viewport.height);
  const visible = rows.map((row, i) => ({ row, i })).filter(({ row, i }) =>
    offsets[i + 1] >= viewport.top - overscan && offsets[i] <= viewport.top + viewport.height + overscan || pinned.has(row.key));
  let end = 0;
  const shell = root.current?.closest<HTMLElement>(".thread-shell");
  const shellBounds = shell?.getBoundingClientRect();
  const threadBounds = scrollElement()?.getBoundingClientRect();
  const base = (threadBounds?.top ?? 0) - (shellBounds?.top ?? 0);
  const mobile = !!shell?.closest(".mobile-workbench,.android-workbench") || matchMedia("(max-width: 700px)").matches;
  const ranges = new Map<string, { range: NonNullable<TimelineRow["ranges"]>[number]; top: number; distance: number }>();
  for (const { row, i } of visible) {
    if (offsets[i + 1] <= viewport.top || offsets[i] >= viewport.top + viewport.height) continue;
    const start = Math.max(offsets[i], viewport.top), end = Math.min(offsets[i + 1], viewport.top + viewport.height);
    const distance = Math.max(0, start - viewport.top - viewport.height / 2, viewport.top + viewport.height / 2 - end);
    for (const range of row.ranges ?? []) if (!ranges.has(range.id)) ranges.set(range.id, {
      range, top: base + Math.max(8, start - viewport.top + 20), distance,
    });
  }
  const controls = [...ranges.values()];
  const current = controls.reduce<typeof controls[number] | undefined>((best, next) => !best || next.distance < best.distance ? next : best, undefined);
  const nav = shell?.querySelector<HTMLElement>(".thread-navigation")?.getBoundingClientRect();
  const controlTops: number[] = [];
  const collapse = (range: NonNullable<TimelineRow["ranges"]>[number]) => {
    following.current = false;
    deliveryCursor.current = null;
    positioning.current = true;
    anchor.current = { key: range.key, offset: 24 };
    collapseFocus.current = range.key;
    setReveal(previous => ({ key: range.key, selector: `[data-timeline-key="${CSS.escape(range.key)}"] .history-disclosure`, revision: (previous?.revision ?? 0) + 1 }));
    range.collapse();
  };
  return <><div ref={root} className="virtual-timeline" data-total-rows={rows.length} data-window-top={Math.round(viewport.top)}>
    {visible.map(({ row, i }) => {
      const gap = offsets[i] - end; end = offsets[i + 1];
      return <Fragment key={row.key}>
        {gap > 0 && <div className="timeline-spacer" style={{ height: gap }} aria-hidden="true" />}
        <div data-timeline-key={row.key} data-history-segment={row.segmentId} data-history-segments={row.ranges?.map(range => range.id).join(" ") || undefined} className="timeline-row"
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
  </div>{shell && createPortal(<div className="history-range-controls" data-mobile={mobile || undefined} aria-label="历史范围收起">
    {(mobile ? current ? [current] : [] : controls).map(({ range, top }) => {
      if (!mobile) {
        const height = shellBounds?.height ?? viewport.height;
        const preferred = Math.max(4, Math.min(top, height - 48));
        const options = [preferred, ...Array.from({ length: Math.max(0, Math.floor((height - 8) / 46)) }, (_, i) => 4 + 46 * i)]
          .filter(y => y + 44 <= height - 4 && !controlTops.some(other => Math.abs(other - y) < 46)
            && !(nav && shellBounds && nav.width > 0 && nav.height > 0 && y + 44 > nav.top - shellBounds.top - 4 && y < nav.bottom - shellBounds.top + 4))
          .sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred));
        if (!options.length) return null;
        top = options[0]; controlTops.push(top);
      }
      return <button key={range.id} type="button" className="history-range-collapse" data-collapse-segment={range.id}
        style={mobile ? undefined : { top }} aria-label={range.label} data-tooltip={range.label} onClick={() => collapse(range)}>
        <span aria-hidden="true"><FoldIcon /></span>
      </button>;
    })}
  </div>, shell)}</>;
}
