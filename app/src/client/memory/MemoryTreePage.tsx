import { useEffect, useMemo, useRef, useState } from "react";
import { command, useScope } from "../transport.js";
import type { Scope, Workspace } from "../../shared/protocol.js";
import { memoryTreeScope, type MemoryTree, type MemoryTreeItem, type MemoryTreeTopic } from "../../shared/memory-tree.js";
import { memoryCatalogScope, type MemoryCatalogEntry, type MemoryPreferences } from "../../shared/memory.js";
import { ModelPicker } from "../chat/ModelPicker.js";
import { MemoryFilter } from "./MemoryFilter.js";
import { MemoryOrganizeControl } from "./MemoryOrganizeControl.js";
import { publicMemoryError } from "./memory-errors.js";
import type { ProcessingOpening } from "../pages/ProcessingPage.js";
import "../styles/memory-tree.css";

type Node = { id: string; label: string; kind: string; parent?: string; item?: MemoryTreeItem; children: Node[] };
function nodes(topics: MemoryTreeTopic[]): Node[] {
  return topics.map((topic) => ({ id: topic.id, label: topic.name, kind: "Topic", children: topic.sections.map((section) => ({
    id: section.id, parent: topic.id, label: section.name, kind: "Section", children: section.items.map((item) => ({ id: item.id, parent: section.id, label: item.name, kind: "Item", item, children: [] })),
  })) }));
}
function NumberSetting({ label, value, min = 1, max = 1000000, save }: { label: string; value: number; min?: number; max?: number; save: (value: number) => Promise<void> }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <label>{label}<input type="number" min={min} max={max} step={1} required value={draft} onChange={(e) => setDraft(e.target.value)}
    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} onBlur={(e) => { if (e.currentTarget.reportValidity() && Number(draft) !== value) void save(Number(draft)).catch(() => {}); }} /></label>;
}
export function MemoryTreePage({ workspaceId, workspaces, select, open, openRecords }: { workspaceId: string; workspaces: Workspace[]; select: (id: string) => void; open: (scope: Scope, path: string) => void; openRecords: (initial: ProcessingOpening) => void }) {
  const tree = useScope<(MemoryTree & { unavailable?: boolean }) | null>(memoryTreeScope(workspaceId), null);
  const catalog = useScope<MemoryCatalogEntry[] | null>(memoryCatalogScope(workspaceId), null);
  const [query, setQuery] = useState(""), [expanded, setExpanded] = useState(new Set<string>()), [selected, setSelected] = useState<string>();
  const [view, setView] = useState({ x: 32, y: 28, scale: 1 }), [canvasWidth, setCanvasWidth] = useState(1000);
  const narrow = canvasWidth < 700;
  const [settings, setSettings] = useState(false), [prefs, setPrefs] = useState<MemoryPreferences | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLDivElement>(null), drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  useEffect(() => {
    const element = canvas.current; if (!element) return;
    const observer = new ResizeObserver(() => { if (element.clientWidth) setCanvasWidth(element.clientWidth); }); observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => { if (!settings) return; let current = true;
    command<MemoryPreferences>("memory.preferences", {}, { workspaceId }).then((value) => { if (current) setPrefs(value); }).catch((e) => { if (current) setError(publicMemoryError(e.message)); });
    return () => { current = false; };
  }, [settings, workspaceId]);
  const configure = async (patch: Partial<MemoryPreferences>) => {
    setBusy(true); setError("");
    try { setPrefs(await command<MemoryPreferences>("memory.configure", patch, { workspaceId })); }
    catch (e) { setError(publicMemoryError((e as Error).message)); throw e; }
    finally { setBusy(false); }
  };
  const roots = useMemo(() => nodes(tree?.topics ?? []), [tree]);
  const all = useMemo(() => { const map = new Map<string, Node>(); const visit = (node: Node) => { map.set(node.id, node); node.children.forEach(visit); }; roots.forEach(visit); return map; }, [roots]);
  const search = query.trim().toLocaleLowerCase();
  const visible = (node: Node): boolean => !search || `${node.label} ${node.item?.contents.map((c) => `${c.text} ${c.sources.map((s) => s.path).join(" ")}`).join(" ") ?? ""}`.toLocaleLowerCase().includes(search) || node.children.some(visible);
  const positioned: Array<Node & { x: number; y: number }> = [];
  let row = 0;
  const layout = (node: Node, depth: number) => {
    if (!visible(node)) return;
    const start = row;
    if (narrow) row++;
    if (search || expanded.has(node.id)) node.children.forEach((child) => layout(child, depth + 1));
    if (row === start) row++;
    positioned.push({ ...node, x: narrow ? depth * 20 : depth * 330, y: start * 96 });
  };
  roots.forEach((node) => layout(node, 0));
  const byId = new Map(positioned.map((node) => [node.id, node]));
  const chosen = selected ? all.get(selected) : undefined;
  const width = narrow ? Math.max(160, canvasWidth - 64) : 1000, height = Math.max(200, row * 96);
  const zoom = (scale: number) => setView((current) => ({ ...current, scale: Math.min(2, Math.max(.3, scale)) }));
  const pending = catalog?.filter((entry) => entry.status === "pending" || entry.status === "indexing").length ?? 0;
  const failures = catalog?.filter((entry) => entry.status === "error" || entry.reason) ?? [];
  return <section className="memory-tree-page" onKeyDown={(event) => {
    if (event.key !== "Escape") return;
    if (chosen || settings || query) { event.preventDefault(); event.stopPropagation(); if (chosen) setSelected(undefined); else if (settings) setSettings(false); else setQuery(""); }
  }}>
    <div className="memory-tree-toolbar"><MemoryFilter label="记忆工作空间" value={workspaceId} onChange={select} options={workspaces.map((w) => ({ value: w.id, label: w.name }))} />
      <input aria-label="搜索记忆" placeholder="搜索主题、事项、内容或文件" value={query} onChange={(event) => setQuery(event.target.value)} />
      {query && <button className="btn" onClick={() => setQuery("")}>清除搜索</button>}
      <button className="btn" onClick={() => openRecords({})}>处理记录</button>
      <button className="btn" aria-label="记忆设置" aria-expanded={settings} onClick={() => setSettings(!settings)}>设置</button>
    </div>
    <div className="memory-tree-status"><span>{tree?.topics.length ?? 0} 个主题 · 名称共 {tree?.nameChars ?? 0} 字{pending ? ` · 待整理 ${pending}` : ""}</span><MemoryOrganizeControl scope={{ workspaceId }} label="整理工作空间" /></div>
    {error && <p role="alert">{error}</p>}
    {!!failures.length && <details className="memory-tree-errors"><summary>整理出错 {failures.length}</summary>{failures.map((entry) => <p key={entry.id}>{entry.sourceTitle ?? entry.title}：{publicMemoryError(entry.error ?? "来源暂不可用")} <button className="btn" onClick={() => openRecords({ kind: "memory.organize", sessionId: entry.sessionId, id: entry.processingId, legacyError: publicMemoryError(entry.error ?? "来源暂不可用") })}>查看详情</button></p>)}</details>}
    {settings && <div className="memory-tree-settings"><h3>全局记忆设置</h3>{prefs ? <fieldset disabled={busy}>
      <h4>查询模型</h4><ModelPicker value={prefs.queryModel} inheritLabel="使用查询会话模型" onDefaultSelect={(queryModel) => configure({ queryModel })} />
      <h4>整理模型</h4><ModelPicker value={prefs.organizerModel} inheritLabel="使用来源会话模型" onDefaultSelect={(organizerModel) => configure({ organizerModel })} />
      <NumberSetting label="Topic 名称总文字量软审查阈值（字）" value={prefs.topicNameReviewThresholdChars} save={(topicNameReviewThresholdChars) => configure({ topicNameReviewThresholdChars })} />
      <p className="meta">当前共 {tree?.nameChars ?? 0} 字，约等于同数量汉字。超线后在下一次正常整理中检查归并。配置适用于所有工作空间。</p>
      <NumberSetting label="执行时限（秒）" value={prefs.timeoutMs / 1000} max={3600} save={(value) => configure({ timeoutMs: value * 1000 })} />
      <NumberSetting label="整理读取上限（字符）" value={prefs.readChars} min={16000} save={(readChars) => configure({ readChars })} />
      <p className="meta">离开输入框自动保存。自动整理需任务已完成且内容和会话活动超过30分钟无更新。浏览记忆不调用模型。</p>
    </fieldset> : <p role="status">正在读取设置…</p>}</div>}
    <div className="memory-tree-workspace">
      <div ref={canvas} className="memory-tree-canvas" aria-label="记忆树画布" tabIndex={0}
        onPointerDown={(event) => { if (event.button !== 0 || (event.target as Element).closest("button")) return; drag.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={(event) => { const start = drag.current; if (start) setView((current) => ({ ...current, x: start.vx + event.clientX - start.x, y: start.vy + event.clientY - start.y })); }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        {!tree ? <p role="status">正在读取记忆树…</p> : tree.unavailable ? <p role="alert">记忆树暂不可用，请稍后重试。</p> : !roots.length ? <div className="memory-tree-empty"><h3>暂无已整理记忆</h3><p>整理后，主题、事项与来源文件会显示在这里。</p></div> : !positioned.length ? <p>没有匹配的记忆</p> : <div className="memory-tree-stage" style={{ width, height, transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})` }}>
          <svg width={width} height={height} aria-hidden="true">{!narrow && positioned.filter((node) => node.parent && byId.has(node.parent)).map((node) => { const parent = byId.get(node.parent!)!; return <path key={node.id} d={`M${parent.x + 280},${parent.y + 34} C${parent.x + 305},${parent.y + 34} ${node.x - 25},${node.y + 34} ${node.x},${node.y + 34}`} />; })}</svg>
          {positioned.map((node) => <button key={node.id} className="memory-tree-node" data-kind={node.kind} style={{ left: node.x, top: node.y, width: narrow ? Math.max(120, canvasWidth - 64 - node.x) : 280 }} data-tooltip={node.label} aria-expanded={node.children.length ? !!search || expanded.has(node.id) : undefined}
            onClick={() => { if (node.item) setSelected(node.id); else setExpanded((current) => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; }); }}>
            <small>{node.kind}{node.children.length ? ` · ${node.children.length}` : node.item ? ` · ${node.item.contents.length} 份记录` : ""}</small><strong>{node.label}</strong>
          </button>)}
        </div>}
        <div className="memory-tree-zoom"><button aria-label="缩小记忆树" onClick={() => zoom(view.scale - .1)}>−</button><span>{Math.round(view.scale * 100)}%</span><button aria-label="放大记忆树" onClick={() => zoom(view.scale + .1)}>＋</button><button onClick={() => setView({ x: 32, y: 28, scale: 1 })}>重置视图</button><button onClick={() => { const bounds = canvas.current?.getBoundingClientRect(); if (bounds) setView({ x: 20, y: 20, scale: Math.min(1, (bounds.width - 40) / width, (bounds.height - 40) / height) }); }}>适合画布</button></div>
      </div>
      {chosen?.item && <aside className="memory-tree-inspector" aria-label="记忆详情"><header><h3>{chosen.label}</h3><button className="btn" aria-label="关闭记忆详情" onClick={() => setSelected(undefined)}>关闭</button></header>
        {chosen.item.contents.map((content) => <article key={content.id}><p>{content.text}</p><h4>来源文件</h4>{content.sources.map((source) => <button className="memory-tree-source" key={`${source.sessionId}:${source.path}`} onClick={() => open({ workspaceId, sessionId: source.sessionId }, source.path)}>{source.path}</button>)}</article>)}
      </aside>}
    </div>
  </section>;
}
