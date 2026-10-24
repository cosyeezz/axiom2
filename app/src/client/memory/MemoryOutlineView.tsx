import { useEffect, useRef, useState } from "react";
import { command } from "../transport.js";
import type { MemoryDocument } from "../../shared/memory.js";
import type { Scope } from "../../shared/protocol.js";
import { memoryBody } from "../../shared/memory.js";
import { detailFile, memoryOutline, type MemoryNode, type MemoryState } from "../../shared/memory-outline.js";
import { Markdown } from "../chat/Markdown.js";
import { Icon } from "../Icon.js";
import { BubbleLoadingIcon } from "../StatusIcons.js";

const stateIcons: Record<MemoryState, string> = { 未开始: "circle", 进行中: "circle-dot", 已完成: "circle-check", 等待: "clock", 已放弃: "circle-slash", 失败: "circle-x", 阻塞: "clock" };
export function MemoryStateIcon({ state }: { state: MemoryState }) { return <Icon name={stateIcons[state]} />; }

/** Read only this numbered block, including on pagination. Never fall back to the whole file. */
function InlineDetail({ scope, id }: { scope: Scope; id: number }) {
  const path = `${detailFile}#detail:${id}`;
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
  return <section className="memory-inline-detail" aria-label={`详情 ${id}`}>
    <h4>详情 {id}</h4>
    {busy && <p className="memory-loading" role="status"><BubbleLoadingIcon />正在读取此条详情…</p>}
    {error && <p className="memory-error" role="alert">{error} <button type="button" className="memory-text-button" disabled={busy} onClick={() => { setDocument(null); void read(); }}>重新读取</button></p>}
    {document && <div className="markdown"><Markdown text={document.content} pathScope={scope} pathBase="memory" sourceFile={detailFile} /></div>}
    {!error && document?.nextOffset != null && <button type="button" className="memory-text-button" disabled={busy} onClick={() => void read(document)}>继续读取此条详情</button>}
  </section>;
}
function TaskRow({ node, scope, revision }: { node: MemoryNode; scope: Scope; revision: string }) {
  const [expanded, setExpanded] = useState(false), [selected, setSelected] = useState(node.details[0]);
  const content = <><span className="memory-task-marker" aria-hidden="true">{node.state && <MemoryStateIcon state={node.state} />}</span>
    <span className="memory-task-title">{node.title}</span>{node.state && <span className="memory-task-state">{node.state}</span>}
    {!!node.details.length && <><span className="memory-task-refs">{node.details.map(id => `〔${id}〕`).join("")}</span><Icon name="chevron-right" className="memory-task-chevron" /></>}</>;
  return node.details.length ? <details className="memory-task-disclosure" onToggle={event => { if (event.target === event.currentTarget) setExpanded(event.currentTarget.open); }}>
    <summary className="memory-task-row">{content}</summary>
    {expanded && <div className="memory-task-details">{node.details.length > 1 && <div className="memory-detail-choices" aria-label="选择详情">{node.details.map(id => <button type="button" className="memory-text-button" key={id} aria-pressed={selected === id} onClick={() => setSelected(id)}>详情 {id}</button>)}</div>}<InlineDetail key={`${scope.workspaceId}:${scope.sessionId}:${revision}:${selected}`} scope={scope} id={selected} /></div>}
  </details> : <div className="memory-task-row">{content}</div>;
}
export function MemoryTaskTree({ nodes, scope, revision }: { nodes: MemoryNode[]; scope: Scope; revision: string }) {
  const children = new Map<number | null, Array<{ node: MemoryNode; index: number }>>();
  nodes.forEach((node, index) => children.set(node.parent, [...children.get(node.parent) ?? [], { node, index }]));
  const branch = (parent: number | null) => <ul>{children.get(parent)?.map(({ node, index }) => <li key={node.line} data-state={node.state} data-abandoned={node.abandoned || undefined} data-kind={node.kind}>
    <TaskRow key={`${scope.workspaceId}:${scope.sessionId}:${node.title}:${node.details.join(",")}`} node={node} scope={scope} revision={revision} />
    {children.has(index) && branch(index)}
  </li>)}</ul>;
  return branch(null);
}
/** Preserve source Markdown; inherited cancellation is presentation, never a rewrite. */
export function MemoryEntry({ text, scope, navigate }: { text: string; scope: Scope; navigate: (path: string) => void }) {
  const body = memoryBody(text), semanticLines = body.split(/\r?\n/), outline = memoryOutline(body), lines = text.split(/\r?\n/);
  // Parse one document so footnotes and reference links retain their global scope.
  const linked = lines.map((line, index) => semanticLines[index]?.trim() ? line.replace(/〔([1-9]\d*)〕/g, `[$&](${detailFile}#detail:$1)`) : line).join("\n");
  return <div className="memory-entry"><Markdown text={linked} abandonedLines={outline.abandonedLines} pathScope={scope} pathBase="memory" sourceFile="MEMORY.md" onLocalLink={navigate} /></div>;
}
