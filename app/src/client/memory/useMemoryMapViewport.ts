import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";

type View = { x: number; y: number; scale: number };
type Point = { x: number; y: number };
const clamp = (scale: number) => Math.min(2, Math.max(.05, scale));
export function useMemoryMapViewport() {
  const canvas = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const current = useRef(view), frame = useRef<number | null>(null), [moving, setMoving] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const pointers = useRef(new Map<number, Point>()), travel = useRef(0), suppressClick = useRef(false);
  const update = useCallback((value: View) => {
    current.current = value;
    if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; setView(current.current); });
  }, []);
  useEffect(() => {
    const element = canvas.current; if (!element) return;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth && element.clientHeight) setSize({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);
    return () => { observer.disconnect(); if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, []);
  const zoomAt = useCallback((scale: number, point?: Point) => {
    const old = current.current, next = clamp(scale), element = canvas.current;
    const anchor = point ?? { x: (element?.clientWidth ?? 0) / 2, y: (element?.clientHeight ?? 0) / 2 };
    update({ x: anchor.x - (anchor.x - old.x) * next / old.scale, y: anchor.y - (anchor.y - old.y) * next / old.scale, scale: next });
  }, [update]);
  const fit = useCallback((width: number, height: number, reset = false) => {
    const element = canvas.current; if (!element?.clientWidth || !element.clientHeight) return;
    const scale = reset ? 1 : clamp(Math.min(1, (element.clientWidth - 64) / width, (element.clientHeight - 100) / height));
    update({ x: (element.clientWidth - width * scale) / 2, y: (element.clientHeight - height * scale) / 2, scale });
  }, [update]);
  useEffect(() => {
    const element = canvas.current; if (!element) return;
    let timer: ReturnType<typeof setTimeout>;
    const wheel = (event: WheelEvent) => {
      if ((event.target as Element).closest(".memory-tree-zoom, .memory-map-actions")) return;
      event.preventDefault(); setMoving(true); clearTimeout(timer); timer = setTimeout(() => setMoving(false), 120);
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect();
        zoomAt(current.current.scale * Math.exp(-event.deltaY * .01), { x: event.clientX - rect.left, y: event.clientY - rect.top });
      } else {
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
        update({ ...current.current, x: current.current.x - event.deltaX * unit, y: current.current.y - event.deltaY * unit });
      }
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => { element.removeEventListener("wheel", wheel); clearTimeout(timer); };
  }, [update, zoomAt]);
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    if (!pointers.current.size && event.button === 0) { travel.current = 0; suppressClick.current = false; }
    if (event.button !== 0 || target.closest(".memory-tree-zoom, .memory-map-actions") || (event.pointerType !== "touch" && target.closest("button"))) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    // Native implicit capture keeps a touch tap on its button; dragging still bubbles to the canvas.
    if (!target.closest("button")) event.currentTarget.setPointerCapture(event.pointerId);
    setMoving(true);
  };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const old = pointers.current.get(event.pointerId); if (!old) return;
    const point = { x: event.clientX, y: event.clientY }, other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)?.[1];
    const previous = current.current;
    travel.current += Math.hypot(point.x - old.x, point.y - old.y);
    if (travel.current > 6 || other) suppressClick.current = true;
    if (other) {
      const distance = Math.hypot(old.x - other.x, old.y - other.y), nextDistance = Math.hypot(point.x - other.x, point.y - other.y);
      const rect = event.currentTarget.getBoundingClientRect(), scale = clamp(previous.scale * nextDistance / Math.max(1, distance));
      const before = { x: (old.x + other.x) / 2 - rect.left, y: (old.y + other.y) / 2 - rect.top };
      const after = { x: (point.x + other.x) / 2 - rect.left, y: (point.y + other.y) / 2 - rect.top };
      update({ x: after.x - (before.x - previous.x) * scale / previous.scale, y: after.y - (before.y - previous.y) * scale / previous.scale, scale });
    } else update({ ...previous, x: previous.x + point.x - old.x, y: previous.y + point.y - old.y });
    pointers.current.set(event.pointerId, point);
  };
  const pointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (!pointers.current.size) setMoving(false);
  };
  const reveal = (x: number, y: number, width: number, height: number) => {
    const old = current.current, element = canvas.current; if (!element) return;
    const left = x * old.scale + old.x, top = y * old.scale + old.y;
    const dx = left < 24 ? 24 - left : left + width * old.scale > element.clientWidth - 24 ? element.clientWidth - 24 - left - width * old.scale : 0;
    const dy = top < 56 ? 56 - top : top + height * old.scale > element.clientHeight - 72 ? element.clientHeight - 72 - top - height * old.scale : 0;
    if (dx || dy) update({ ...old, x: old.x + dx, y: old.y + dy });
  };
  return { canvas, view, current, update, moving, size, fit, zoomAt, reveal,
    handlers: { onPointerDown: pointerDown, onPointerMove: pointerMove, onPointerUp: pointerEnd, onPointerCancel: pointerEnd, onLostPointerCapture: pointerEnd,
      onClickCapture: (event: ReactMouseEvent<HTMLDivElement>) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } } } };
}
