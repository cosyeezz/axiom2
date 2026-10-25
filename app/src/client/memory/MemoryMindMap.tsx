import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { layoutMemoryMap, mapNodeHeight, type MemoryMapNode, type MapPosition } from "./memory-map-layout.js";
import { useMemoryMapViewport } from "./useMemoryMapViewport.js";

function MapIcon({ name }: { name: "fit" | "map" | "expand" | "collapse" | "fullscreen" | "exit-fullscreen" }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{name === "fullscreen" || name === "exit-fullscreen" ? <path d={name === "fullscreen" ? "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" : "M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5"} /> : name === "fit" ? <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 12h8m-4-4v8" /> : name === "map" ? <><path d="M9 12H5m10 0h4M12 9V5m0 10v4" /><circle cx="12" cy="12" r="3" /><path d="M2 10h3v4H2zm17 0h3v4h-3zM10 2h4v3h-4zm0 17h4v3h-4z" /></> : <path d={name === "expand" ? "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l5 5m13-5-5 5M3 21l5-5m13 5-5-5" : "M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5M3 3l5 5m13-5-5 5M3 21l5-5m13 5-5-5"} />}</svg>;
}
const tones = ["#739b8c", "#929ac4", "#c09a6b", "#729eaf", "#b88d9c", "#96a574"];
export function MemoryMindMap({ roots, query, workspaceName, loading, unavailable, selected, onSelect, fullscreen = false, toggleFullscreen }: {
  roots: MemoryMapNode[]; query: string; workspaceName: string; loading: boolean; unavailable?: boolean; selected?: string; onSelect: (id: string) => void; fullscreen?: boolean; toggleFullscreen?: () => void;
}) {
  const [expanded, setExpanded] = useState(new Set<string>());
  const viewport = useMemoryMapViewport(), { canvas, view, current, update, moving, size, fit, zoomAt, reveal, handlers } = viewport;
  const layout = useMemo(() => layoutMemoryMap(roots, expanded, query), [roots, expanded, query]);
  const positions = useMemo(() => new Map(layout.positions.map(node => [node.id, node])), [layout]);
  const buttons = useRef(new Map<string, HTMLButtonElement>()), pendingAnchor = useRef<{ id: string; x: number; y: number; opening: boolean } | null>(null);
  const dimensions = useRef(layout); dimensions.current = layout;
  const hasNodes = roots.length > 0;
  const previousViewport = useRef<{ width: number; height: number; fullscreen: boolean; windowWidth: number; windowHeight: number } | null>(null);
  // Fit on first data, ordinary resize and search. Fullscreen only changes the presentation:
  // retain zoom and the world point at the centre, using the observer's actual final size.
  useEffect(() => {
    const element = canvas.current;
    if (!element || !size.width || !size.height || element.clientWidth !== size.width || element.clientHeight !== size.height) return;
    const previous = previousViewport.current;
    previousViewport.current = { ...size, fullscreen, windowWidth: window.innerWidth, windowHeight: window.innerHeight };
    if (previous && previous.fullscreen !== fullscreen && previous.windowWidth === window.innerWidth && previous.windowHeight === window.innerHeight) {
      update({ ...current.current, x: current.current.x + (size.width - previous.width) / 2, y: current.current.y + (size.height - previous.height) / 2 });
      return;
    }
    if (!hasNodes) return;
    const map = dimensions.current;
    if (size.width < 700) {
      // A phone should open on a readable branch, not an illegible miniature of the whole map.
      const target = (query.trim() ? map.positions.find(node => node.kind === "Purpose") : undefined) ?? map.positions[0] ?? map.root;
      update({ x: size.width / 2 - target.x - target.width / 2, y: size.height / 2 - target.y - mapNodeHeight / 2, scale: 1 });
    } else fit(map.width, map.height);
  }, [hasNodes, size.width, size.height, query, fit, update, fullscreen, canvas, current]);
  const previousSelection = useRef(selected);
  useEffect(() => {
    if (previousSelection.current && !selected) buttons.current.get(previousSelection.current)?.focus({ preventScroll: true });
    previousSelection.current = selected;
  }, [selected]);
  useLayoutEffect(() => {
    const anchor = pendingAnchor.current; if (!anchor) return;
    const node = positions.get(anchor.id); pendingAnchor.current = null;
    if (node) {
      update({ ...current.current, x: current.current.x + (anchor.x - node.x) * current.current.scale, y: current.current.y + (anchor.y - node.y) * current.current.scale });
      // Keep the branch anchored where possible, but bring its next step into reach.
      if (anchor.opening) {
        const child = node.children.map(child => positions.get(child.id)).filter((child): child is MapPosition => !!child).sort((a, b) => Math.abs(a.y - node.y) - Math.abs(b.y - node.y))[0];
        if (child) reveal(child.x, child.y, child.width + 16, mapNodeHeight);
      }
    }
  }, [positions, update, current]);
  const toggle = (node: MapPosition, force?: boolean) => {
    if (query.trim()) return;
    pendingAnchor.current = { id: node.id, x: node.x, y: node.y, opening: force ?? !expanded.has(node.id) };
    setExpanded(previous => { const next = new Set(previous); if (force ?? !next.has(node.id)) next.add(node.id); else next.delete(node.id); return next; });
  };
  const focus = (id?: string) => { if (id) { const node = positions.get(id); if (node) reveal(node.x, node.y, node.width, mapNodeHeight); buttons.current.get(id)?.focus({ preventScroll: true }); } };
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, node: MapPosition) => {
    const forward = node.side === 1 ? "ArrowRight" : "ArrowLeft", backward = node.side === 1 ? "ArrowLeft" : "ArrowRight";
    if (event.key === forward) { event.preventDefault(); if (node.children.length && !node.open) toggle(node, true); else focus(node.children.find(child => positions.has(child.id))?.id); }
    else if (event.key === backward) { event.preventDefault(); if (node.children.length && node.open && !query.trim()) toggle(node, false); else focus(node.parent); }
    else if (event.key === "Home" || event.key === "End") { event.preventDefault(); focus(layout.positions[event.key === "Home" ? 0 : layout.positions.length - 1]?.id); }
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); const siblings = layout.positions.filter(other => other.parent === node.parent && other.side === node.side).sort((a, b) => a.y - b.y);
      focus(siblings[siblings.findIndex(other => other.id === node.id) + (event.key === "ArrowDown" ? 1 : -1)]?.id);
    }
  };
  const expandAll = () => {
    const ids = new Set<string>(); const visit = (node: MemoryMapNode) => { if (node.children.length) ids.add(node.id); node.children.forEach(visit); }; roots.forEach(visit); setExpanded(ids);
    const next = layoutMemoryMap(roots, ids, query); fit(next.width, next.height);
  };
  const collapseAll = () => { setExpanded(new Set()); const next = layoutMemoryMap(roots, new Set(), query); fit(next.width, next.height); };
  return <div ref={canvas} className="memory-tree-canvas" aria-label="记忆树画布" aria-describedby="memory-map-help" tabIndex={0} data-moving={moving || undefined} {...handlers}
    onKeyDown={event => {
      if (event.target !== event.currentTarget) return;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); update({ ...view, x: view.x + (event.key === "ArrowLeft" ? 60 : event.key === "ArrowRight" ? -60 : 0), y: view.y + (event.key === "ArrowUp" ? 60 : event.key === "ArrowDown" ? -60 : 0) }); }
      else if (["+", "=", "-", "0"].includes(event.key)) { event.preventDefault(); if (event.key === "0") fit(layout.width, layout.height); else zoomAt(view.scale + (event.key === "-" ? -.1 : .1)); }
    }}>
    <div className="memory-map-heading"><MapIcon name="map" /><span>记忆地图</span>{query.trim() && <small>{layout.positions.length} 个节点</small>}</div>
    <div className="memory-map-actions">{hasNodes && <><button aria-label="展开全部记忆" data-tooltip="展开全部" disabled={!!query.trim()} onClick={expandAll}><MapIcon name="expand" /></button><button aria-label="收起全部记忆" data-tooltip="收起全部" disabled={!!query.trim()} onClick={collapseAll}><MapIcon name="collapse" /></button></>}{toggleFullscreen && <button aria-label={fullscreen ? "退出全屏画布" : "全屏画布"} aria-pressed={fullscreen} data-tooltip={fullscreen ? "退出全屏（Esc）" : "全屏画布"} onClick={toggleFullscreen}><MapIcon name={fullscreen ? "exit-fullscreen" : "fullscreen"} /></button>}</div>
    {loading ? <p role="status">正在读取记忆树…</p> : unavailable ? <p role="alert">记忆树暂不可用，请稍后重试。</p> : !hasNodes ? <div className="memory-tree-empty"><MapIcon name="map" /><h3>让记忆慢慢生长</h3><p>已完成的目的整理后，会在这里长成可以探索的分支。</p></div> : !layout.positions.length ? <div className="memory-tree-empty"><h3>没有匹配的记忆</h3><p>试试其他分类、目的或来源文件关键词。</p></div> : <div className="memory-tree-stage" style={{ width: layout.width, height: layout.height, transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})` }}>
      <svg width={layout.width} height={layout.height} aria-hidden="true">{layout.edges.map(edge => <path key={edge.id} d={edge.path} style={{ stroke: tones[edge.branch % tones.length] }} />)}</svg>
      <div className="memory-map-root" style={{ width: layout.root.width, transform: `translate(${layout.root.x}px,${layout.root.y}px)` }}><MapIcon name="map" /><span><small>全局记忆</small><strong title={workspaceName}>{workspaceName}</strong></span></div>
      {layout.positions.map(node => <div key={node.id}
        className="memory-tree-node" data-kind={node.kind} data-side={node.side} data-selected={selected === node.id || undefined} data-branch={node.parent !== undefined ? undefined : "root"}
        style={{ width: node.width, transform: `translate(${node.x}px,${node.y}px)`, "--branch-tone": tones[node.branch % tones.length] } as CSSProperties}>
        <button className="memory-map-select" ref={element => { if (element) buttons.current.set(node.id, element); else buttons.current.delete(node.id); }}
          title={node.titlePath ?? node.label} aria-label={`查看 ${node.label} · ${node.documents?.length ?? 0} 份直属文档`}
          aria-pressed={selected === node.id} onKeyDown={event => navigate(event, node)}
          onFocus={event => { if (event.currentTarget.matches(":focus-visible")) reveal(node.x, node.y, node.width, mapNodeHeight); }}
          onClick={() => onSelect(node.id)}>
          <span className="memory-map-label"><strong>{node.label}</strong>{!!node.documents?.length && <small className="memory-map-document-count" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M4 2h5l3 3v9H4zM9 2v4h3M6 9h4M6 11h4" /></svg>{node.documents.length}</small>}</span>
          <span className="memory-map-line" />
        </button>
        {node.children.length > 0 && <button className="memory-map-toggle" aria-label={`${node.open ? "收起" : "展开"} ${node.label} 的分支`}
          aria-expanded={node.open} disabled={!!query.trim()} onClick={() => toggle(node)}>{node.open ? "−" : <span>{node.children.length}</span>}</button>}
      </div>)}
    </div>}
    <div className="memory-tree-zoom"><button aria-label="缩小记忆树" disabled={view.scale <= .05} onClick={() => zoomAt(view.scale - .1)}>−</button><span aria-live="polite">{Math.round(view.scale * 100)}%</span><button aria-label="放大记忆树" disabled={view.scale >= 2} onClick={() => zoomAt(view.scale + .1)}>＋</button><i /><button aria-label="适合画布" data-tooltip="适合画布（0）" onClick={() => fit(layout.width, layout.height)}><MapIcon name="fit" /></button><button className="memory-map-reset" onClick={() => fit(layout.width, layout.height, true)}>重置视图</button></div>
    <p className="memory-map-help" id="memory-map-help"><span className="memory-map-desktop-help">拖动平移 · Ctrl / ⌘ + 滚轮缩放 · 点击节点看文档 · 点击圆钮展开</span><span className="memory-map-touch-help">拖动探索分支 · 双指缩放</span></p>
  </div>;
}
