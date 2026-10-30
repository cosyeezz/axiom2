import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import { imageFitScale, imageScrollLayout, imageZoomAt, imageWheelScale, clampImageScale, type ImageView } from "./image-zoom.js";

export type ImageZoomState = { percent: number | null; atMin: boolean; atMax: boolean };
export type ImageZoomControls = { step: (direction: number) => void; fit: () => void };
type Size = { width: number; height: number };
type Point = { x: number; y: number };

type ImageFileProps = {
  url: string; name: string; controls: Ref<ImageZoomControls>; onZoomChange: (state: ImageZoomState) => void;
};
export function ImageFile(props: ImageFileProps) {
  // A new source gets fresh state before it can load, including cached images.
  return <ImageFileView key={props.url} {...props} />;
}
function ImageFileView({ url, name, controls, onZoomChange }: ImageFileProps) {
  const scroller = useRef<HTMLDivElement>(null), image = useRef<HTMLImageElement>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [natural, setNatural] = useState<Size>({ width: 0, height: 0 });
  const [error, setError] = useState(false);
  const [view, setView] = useState<ImageView>({ scale: 1, x: 0, y: 0 });
  const fitted = useRef(true), target = useRef<number | null>(null);
  const animation = useRef<{ scale: number; point: Point; world: Point } | null>(null);
  const frame = useRef<number | null>(null);
  const fitScale = imageFitScale(natural, viewport);
  const ready = natural.width > 0 && viewport.width > 0 && viewport.height > 0;

  const cancel = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);
  const snapshot = useCallback((): ImageView => {
    const rect = image.current!.getBoundingClientRect(), box = scroller.current!.getBoundingClientRect();
    return { scale: rect.width / image.current!.naturalWidth, x: rect.left - box.left, y: rect.top - box.top };
  }, []);
  const fit = useCallback(() => {
    cancel(); target.current = null; fitted.current = true;
    setView({ scale: fitScale, x: (viewport.width - natural.width * fitScale) / 2, y: (viewport.height - natural.height * fitScale) / 2 });
  }, [cancel, fitScale, viewport, natural]);
  const zoomTo = useCallback((scale: number, point: Point) => {
    if (!ready || error) return;
    const current = snapshot();
    target.current = clampImageScale(scale, fitScale); fitted.current = false;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      cancel(); setView(imageZoomAt(current, target.current, point)); return;
    }
    animation.current = { scale: current.scale, point, world: { x: (point.x - current.x) / current.scale, y: (point.y - current.y) / current.scale } };
    if (frame.current !== null) return;
    let previous = performance.now();
    const animate = (now: number) => {
      const state = animation.current!, goal = target.current!;
      const remaining = goal - state.scale;
      const done = Math.abs(remaining) * natural.width < .05;
      // Advance ideal scale, not rounded DOM geometry: WebKit can otherwise
      // stall just short of a target and keep scheduling frames forever.
      const next = done ? goal : state.scale + remaining * (1 - Math.exp(-(now - previous) / 40));
      previous = now; state.scale = next;
      setView({ scale: next, x: state.point.x - state.world.x * next, y: state.point.y - state.world.y * next });
      frame.current = done ? null : requestAnimationFrame(animate);
    };
    frame.current = requestAnimationFrame(animate);
  }, [ready, error, fitScale, cancel, snapshot, natural.width]);
  useImperativeHandle(controls, () => ({
    fit,
    step: direction => { if (ready && !error) zoomTo((target.current ?? snapshot().scale) + direction * .05, { x: viewport.width / 2, y: viewport.height / 2 }); },
  }), [fit, zoomTo, snapshot, viewport, ready, error]);

  useEffect(() => {
    const node = scroller.current!;
    let measured = { width: 0, height: 0 };
    const measure = () => {
      if (node.clientWidth === measured.width && node.clientHeight === measured.height) return;
      // Capture native scrollbar panning before a new viewport projects layout.
      if (!fitted.current && image.current?.naturalWidth) {
        const current = snapshot();
        if (frame.current !== null && animation.current) {
          const point = animation.current.point;
          animation.current = { scale: current.scale, point, world: { x: (point.x - current.x) / current.scale, y: (point.y - current.y) / current.scale } };
        } else target.current = current.scale;
        setView(current);
      }
      measured = { width: node.clientWidth, height: node.clientHeight }; setViewport(measured);
    };
    const observer = new ResizeObserver(measure); observer.observe(node); measure();
    return () => { observer.disconnect(); cancel(); };
  }, [cancel, snapshot]);
  useLayoutEffect(() => { if (fitted.current && ready) fit(); }, [ready, fit]);

  useEffect(() => {
    const node = scroller.current!;
    const wheel = (event: WheelEvent) => {
      if (!ready || error || !event.deltaY) return;
      event.preventDefault(); event.stopPropagation();
      const box = node.getBoundingClientRect();
      zoomTo(imageWheelScale(target.current ?? snapshot().scale, event.deltaY, event.deltaMode, node.clientHeight, fitScale), { x: event.clientX - box.left, y: event.clientY - box.top });
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [ready, error, zoomTo, snapshot, fitScale]);

  // Explicit gutters allow exact pointer anchoring even before an image fills
  // the viewport. Native scrollbars still reach every part of a large image.
  const layout = imageScrollLayout(view, natural, viewport);
  useLayoutEffect(() => {
    const node = scroller.current!;
    node.scrollLeft = layout.scrollX; node.scrollTop = layout.scrollY;
  }, [layout.scrollX, layout.scrollY, layout.width, layout.height]);
  useLayoutEffect(() => {
    onZoomChange({ percent: fitted.current ? null : view.scale * 100, atMin: ready && view.scale <= Math.min(.05, fitScale) + .00001, atMax: ready && view.scale >= 3 - .00001 });
  }, [view, fitScale, ready, onZoomChange]);

  return <div className="file-image-scroll" ref={scroller} tabIndex={0} aria-label="图片预览内容" title="滚轮缩放 · 以鼠标位置为中心">
    {error ? <div className="file-empty" role="alert"><strong>图片无法解码</strong><p>请重新加载，或打开本地位置查看原文件。</p></div> : <div className="file-image-stage" style={{ width: layout.width, height: layout.height }}>
      {url && <img ref={image} src={url} alt={name} draggable={false} style={{ width: natural.width * view.scale, height: natural.height * view.scale, left: layout.x, top: layout.y }} onLoad={event => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setError(true)} />}
    </div>}
  </div>;
}
