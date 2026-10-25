import { useState } from "react";
import type { Scope } from "../../shared/protocol.js";
import type { MemoryCatalogEntry } from "../../shared/memory.js";
import type { MemoryMapNode } from "./memory-map-layout.js";

/** Metadata-only browsing: opening a document uses the existing scoped preview. */
export function MemoryNodeInspector({ node, workspaceId, catalog, open, close }: {
  node: MemoryMapNode; workspaceId: string; catalog: readonly MemoryCatalogEntry[];
  open: (scope: Scope, path: string) => void; close: () => void;
}) {
  const [filter, setFilter] = useState("");
  const documents = node.documents ?? [], sources = node.sources ?? (node.purpose ? [node.purpose] : []);
  const sourceName = (sessionId: string) => {
    const source = catalog.find(entry => entry.sessionId === sessionId);
    return source?.sourceTitle || source?.title || `来源会话 ${sessionId.slice(0, 8)}`;
  };
  const search = filter.trim().toLocaleLowerCase(), visible = documents.filter(ref => !search || `${ref.title} ${ref.path} ${sourceName(ref.sessionId)}`.toLocaleLowerCase().includes(search));
  return <aside className="memory-tree-inspector" aria-label="记忆详情">
    <header><h3>{node.label}</h3><button className="btn" aria-label="关闭记忆详情" onClick={close}>关闭</button></header>
    <p className="memory-node-path">{node.displayPath ?? node.titlePath ?? node.label}</p>
    <h4>关联文档 · {documents.length} 份</h4>
    <p className="meta">仅列当前节点直属文档，不包含子节点。</p>
    {documents.length > 8 && <input className="memory-document-filter" aria-label="筛选关联文档" placeholder="筛选文件名、路径或来源" value={filter} onChange={event => setFilter(event.target.value)} />}
    {!documents.length ? <p className="memory-document-empty">此节点暂无直接关联文档{node.children.length ? "，可继续查看子节点" : ""}。</p>
      : !visible.length ? <p className="memory-document-empty">没有符合筛选条件的文档。</p>
      : <ul className="memory-document-list">{visible.map(ref => <li key={JSON.stringify([ref.sessionId, ref.path])}>
        <button className="memory-document-open" onClick={() => open({ workspaceId, sessionId: ref.sessionId }, ref.path)} aria-label={`打开 ${ref.title || ref.path}，${sourceName(ref.sessionId)}`}>
          <strong>{ref.title || ref.path.split("/").at(-1)}</strong><span aria-hidden="true">打开 ↗</span>
        </button>
        <p className="meta">来源：{sourceName(ref.sessionId)}</p>
        <p className="memory-document-path">{ref.path}</p>
      </li>)}</ul>}
    {!!sources.length && <details className="memory-node-sources"><summary>来源信息 · {sources.length} 个目的</summary>
      {sources.map(source => <div key={source.id}><p>{source.text}</p><small>{sourceName(source.source.sessionId)}</small>
        <button className="memory-tree-source" onClick={() => open({ workspaceId, sessionId: source.source.sessionId }, source.source.path)}>查看原始目的记忆</button></div>)}
    </details>}
    <p className="meta">目录只用于定位，事实与过程请打开原文查看。</p>
  </aside>;
}
