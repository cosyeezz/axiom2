import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { command } from "../transport.js";
import type { MemoryDocument } from "../../shared/memory.js";
import type { Scope } from "../../shared/protocol.js";
import { memoryOutline, type MemoryNode } from "../../shared/memory-outline.js";
import { memoryDetailPaths } from "../../shared/memory-detail-paths.js";
import { Markdown } from "../chat/Markdown.js";
import { Icon } from "../Icon.js";
import { BubbleLoadingIcon } from "../StatusIcons.js";
import { MemoryStateIcon } from "./MemoryStateIcon.js";
import { MemoryTaskTitle, memoryTitleLabel } from "./MemoryTaskTitle.js";
import { reconcileMemoryTree, type MemoryTreeItem as TreeItem } from "./memory-task-tree.js";
export { MemoryStateIcon } from "./MemoryStateIcon.js";

/** Read only the selected independent file, with revision-safe pagination. */
function InlineDetail({ scope, path }: { scope: Scope; path: string }) {
  const [document, setDocument] = useState<MemoryDocument | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState("");
  const generation = useRef(0);
  const read = async (previous?: MemoryDocument) => {
    const current = ++generation.current; setBusy(true); setError("");
    try {
      const next = await command<MemoryDocument>("memory.read", { path, ...(previous ? { offset: previous.nextOffset } : {}) }, scope);
      if (current !== generation.current) return;
      if (next.available === false) throw Error("此条详情暂不可读，请重试");
      if (previous && previous.revision !== next.revision) { setDocument(null); throw Error("详情已变化，请重新读取，不能拼接不同修订"); }
      setDocument({ ...next, content: (previous?.content ?? "") + next.content });
    } catch (e) { if (current === generation.current) setError((e as Error).message || "无法读取此条详情"); }
    finally { if (current === generation.current) setBusy(false); }
  };
  useEffect(() => { void read(); return () => { generation.current++; }; }, [path, scope.workspaceId, scope.sessionId]);
  return <section className="memory-inline-detail" aria-label="详情内容">
    {busy && <p className="memory-loading" role="status"><BubbleLoadingIcon />正在读取此条详情…</p>}
    {error && <p className="memory-error" role="alert">{error} <button type="button" className="memory-text-button" disabled={busy} onClick={() => { setDocument(null); void read(); }}>重新读取</button></p>}
    {document && <div className="markdown"><Markdown text={document.content} pathScope={scope} pathBase="memory" sourceFile={path} /></div>}
    {!error && document?.nextOffset != null && <button type="button" className="memory-text-button" disabled={busy} onClick={() => void read(document)}>继续读取此条详情</button>}
  </section>;
}
type OpenDetail = (item: TreeItem, trigger: HTMLButtonElement) => void;
function TaskBranch({ item, goal, paths, openDetail }: { item: TreeItem; goal: boolean; paths: Map<MemoryNode, string>; openDetail: OpenDetail }) {
  const { node, children } = item, id = useId(), path = paths.get(node);
  const defaultOpen = !node.abandoned && node.state !== "已完成";
  const [expanded, setExpanded] = useState(defaultOpen), [visited, setVisited] = useState(defaultOpen);
  const previousState = useRef(node.state);
  useEffect(() => {
    if (node.state !== previousState.current && node.state === "进行中" && !node.abandoned) { setExpanded(true); setVisited(true); }
    previousState.current = node.state;
  }, [node.state, node.abandoned]);
  return <li data-state={node.state} data-abandoned={node.abandoned || undefined} data-kind={node.kind} data-goal={goal || undefined}>
    <div className="memory-task-row">
      <span className="memory-task-marker">{node.state && <MemoryStateIcon state={node.state} motion={!node.abandoned} />}</span>
      {!!children.length && <button type="button" className="memory-branch-toggle memory-branch-disclosure" aria-label={`${expanded ? "收起" : "展开"}：${memoryTitleLabel(node.title)}`} aria-expanded={expanded} aria-controls={id} onClick={() => { setVisited(true); setExpanded(!expanded); }}><Icon name="chevron-right" className="memory-task-chevron" /></button>}
      <span className="memory-task-title"><MemoryTaskTitle text={node.title} path={path} onOpen={(_path, event) => openDetail(item, event.currentTarget)} /></span>
      {node.state && <span className="memory-task-state">{node.state === "阻塞" ? "等待" : node.state}</span>}
      {path && <button type="button" className="memory-task-detail-button" aria-label={`查看详情：${memoryTitleLabel(node.title)}`} data-task-key={item.key} onClick={event => openDetail(item, event.currentTarget)}><Icon name="file-text" /></button>}
    </div>
    {!!children.length && <div id={id} hidden={!expanded} className="memory-branch">
      {goal && <div className="memory-execution-label">执行树 <span>{children.length} 个步骤</span></div>}
      {visited && <ul>{children.map(child => <TaskBranch key={child.key} item={child} goal={false} paths={paths} openDetail={openDetail} />)}</ul>}
    </div>}
  </li>;
}
export function MemoryTaskTree({ nodes, files = [], scope, revision, goals = true, onDetailChange, openLink }: { nodes: MemoryNode[]; files?: ReadonlyArray<{ path: string }>; scope: Scope; revision: string; goals?: boolean; onDetailChange?: (open: boolean) => void; openLink?: (path: string) => void }) {
  const container = useRef<HTMLDivElement>(null), returnTo = useRef<{ top: number; key: string } | null>(null), back = useRef<HTMLButtonElement>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const previous = useRef<TreeItem[]>([]), sequence = useRef(0);
  const roots = reconcileMemoryTree(nodes, previous.current, () => `task-${++sequence.current}`);
  previous.current = roots;
  const paths = new Map<MemoryNode, string>(), existing = new Set(files.map(file => file.path.normalize("NFC")));
  try { memoryDetailPaths(nodes).forEach((path, index) => { if (existing.has(path)) paths.set(nodes[index], path); }); } catch { /* Invalid trees never acquire speculative detail actions. */ }
  const find = (items: TreeItem[], key: string): TreeItem | undefined => {
    for (const item of items) { if (item.key === key) return item; const child = find(item.children, key); if (child) return child; }
  };
  const current = detail ? find(roots, detail) : null, selected = current ? paths.get(current.node) : undefined;
  const openDetail: OpenDetail = (item) => {
    const path = paths.get(item.node); if (!path) return;
    if (openLink) { openLink(path); return; }
    returnTo.current = { top: container.current?.closest(".toolbar-detail-body")?.scrollTop ?? 0, key: item.key };
    setDetail(item.key); onDetailChange?.(true);
  };
  const closeDetail = () => { setDetail(null); onDetailChange?.(false); };
  useLayoutEffect(() => {
    const body = container.current?.closest(".toolbar-detail-body");
    if (body) body.scrollTop = detail ? 0 : returnTo.current?.top ?? body.scrollTop;
    if (detail) back.current?.focus({ preventScroll: true });
    else if (returnTo.current) {
      const target = container.current?.querySelector<HTMLButtonElement>(`[data-task-key="${returnTo.current.key}"]`);
      if (target?.getClientRects().length) target.focus({ preventScroll: true }); else container.current?.focus({ preventScroll: true });
    }
  }, [!!detail]);
  return <div ref={container} className="memory-execution-view" tabIndex={-1} aria-label="目标与执行树">
    <div hidden={!!detail}>
      <div className="memory-section-head"><h3>{goals ? "目标" : "执行树"}</h3><span className="memory-task-count">{roots.length} {goals ? "个目标" : "个步骤"}</span></div>
      <ul className="memory-goals">{roots.map(item => <TaskBranch key={item.key} item={item} goal={goals} paths={paths} openDetail={openDetail} />)}</ul>
    </div>
    {detail && <section className="memory-detail-page" aria-label="任务详情">
      <button ref={back} type="button" className="memory-text-button memory-detail-back" onClick={closeDetail}><Icon name="arrow-left" />返回执行树</button>
      {current && <div className="memory-detail-heading"><span className="memory-task-marker">{current.node.state && <MemoryStateIcon state={current.node.state} motion={false} />}</span><h3><MemoryTaskTitle text={current.node.title} /></h3></div>}
      {current && selected ? <InlineDetail key={`${scope.workspaceId}:${scope.sessionId}:${revision}:${selected}`} scope={scope} path={selected} /> : <p role="status">此项或其详情文件已移除，可返回查看最新执行树。</p>}
    </section>}
  </div>;
}
/** Main memory has no links: file metadata supplies all detail actions. */
export function MemoryEntry({ text, files = [], scope, navigate }: { text: string; files?: ReadonlyArray<{ path: string }>; scope: Scope; navigate: (path: string) => void }) {
  return <div className="memory-entry"><MemoryTaskTree nodes={memoryOutline(text).nodes} files={files} scope={scope} revision={text} openLink={navigate} /></div>;
}
