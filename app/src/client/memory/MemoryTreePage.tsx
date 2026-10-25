import { useEffect, useMemo, useState } from "react";
import { command, useScope } from "../transport.js";
import type { Scope, Workspace } from "../../shared/protocol.js";
import { memoryTreeScope, memoryBatchSize, memoryBatchWaitMs, memoryDirectoryMaxChars, memoryOrganizationWatermarks, type MemoryTree } from "../../shared/memory-tree.js";
import { memoryCatalogScope, type MemoryCatalogEntry, type MemoryPreferences } from "../../shared/memory.js";
import { ModelPicker } from "../chat/ModelPicker.js";
import { MemoryFilter } from "./MemoryFilter.js";
import { publicMemoryError } from "./memory-errors.js";
import type { ProcessingOpening } from "../pages/ProcessingPage.js";
import { MemoryMindMap } from "./MemoryMindMap.js";
import { MemoryNodeInspector } from "./MemoryNodeInspector.js";
import { OrganizationFeedback } from "./OrganizationFeedback.js";
import { memoryMapNodes, type MemoryMapNode } from "./memory-map-layout.js";
import "../styles/memory-tree.css";
function NumberSetting({ label, value, min = 1, max = 1000000, save }: { label: string; value: number; min?: number; max?: number; save: (value: number) => Promise<void> }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <label>{label}<input type="number" min={min} max={max} step={1} required value={draft} onChange={(e) => setDraft(e.target.value)}
    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} onBlur={(e) => { if (e.currentTarget.reportValidity() && Number(draft) !== value) void save(Number(draft)).catch(() => {}); }} /></label>;
}
export function MemoryTreePage({ workspaceId, workspaces, select, open, openRecords, fullscreen, toggleFullscreen, visible = true }: { workspaceId: string; workspaces: Workspace[]; select: (id: string) => void; open: (scope: Scope, path: string) => void; openRecords: (initial: ProcessingOpening) => void; fullscreen?: boolean; toggleFullscreen?: () => void; visible?: boolean }) {
  const tree = useScope<(MemoryTree & { unavailable?: boolean }) | null>(memoryTreeScope(workspaceId), null);
  const catalog = useScope<MemoryCatalogEntry[] | null>(memoryCatalogScope(workspaceId), null);
  const [query, setQuery] = useState(""), [selected, setSelected] = useState<string>();
  const [settings, setSettings] = useState(false), [prefs, setPrefs] = useState<MemoryPreferences | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { setSelected(undefined); setPrefs(null); setQuery(""); setError(""); }, [workspaceId]);
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
  const roots = useMemo(() => memoryMapNodes(tree?.roots ?? [], tree?.purposes ?? []), [tree]);
  const all = useMemo(() => { const map = new Map<string, MemoryMapNode>(); const visit = (node: MemoryMapNode) => { map.set(node.id, node); node.children.forEach(visit); }; roots.forEach(visit); return map; }, [roots]);
  const chosen = selected ? all.get(selected) : undefined;
  useEffect(() => { if (selected && !all.has(selected)) setSelected(undefined); }, [selected, all]);
  const pending = tree?.pending ?? 0;
  const failures = catalog?.filter((entry) => entry.organizationError) ?? [];
  return <section className="memory-tree-page" onKeyDown={(event) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing || fullscreen) return;
    if (chosen || settings || query) { event.preventDefault(); event.stopPropagation(); if (chosen) setSelected(undefined); else if (settings) setSettings(false); else setQuery(""); }
  }}>
    <div className="memory-tree-toolbar"><MemoryFilter label="记忆工作空间" value={workspaceId} onChange={select} options={workspaces.map((w) => ({ value: w.id, label: w.name }))} />
      <input aria-label="搜索记忆" placeholder="搜索分类、目的或来源文件" value={query} onChange={(event) => setQuery(event.target.value)} />
      {query && <button className="btn" onClick={() => setQuery("")}>清除搜索</button>}
      <button className="btn" onClick={() => openRecords({})}>处理记录</button>
      <button className="btn" aria-label="记忆设置" aria-expanded={settings} onClick={() => setSettings(!settings)}>设置</button>
    </div>
    <div className="memory-tree-status"><span>{tree?.roots.length ?? 0} 个一级分类 · {tree?.purposes.length ?? 0} 个目的 · 语义目录 {tree?.nameChars ?? 0}/{memoryOrganizationWatermarks.maximum} 码点{pending ? ` · 待整理 ${pending} 个目的` : ""}</span></div>
    {visible && <OrganizationFeedback workspaceId={workspaceId} tree={tree} openRecords={openRecords} />}
    {error && <p role="alert">{error}</p>}
    {!!failures.length && <details className="memory-tree-errors"><summary>整理出错 {failures.length}</summary>{failures.map((entry) => <p key={entry.id}>{entry.sourceTitle ?? entry.title}：{publicMemoryError(entry.organizationError!)} <button className="btn" onClick={() => openRecords({ kind: "memory.organize", sessionId: entry.sessionId, id: entry.processingId, legacyError: publicMemoryError(entry.organizationError!) })}>查看详情</button></p>)}</details>}
    {settings && <div className="memory-tree-settings"><h3>全局记忆设置</h3>{prefs ? <fieldset disabled={busy}>
      <h4>查询模型</h4><ModelPicker value={prefs.queryModel} inheritLabel="使用查询会话模型" onDefaultSelect={(queryModel) => configure({ queryModel })} />
      <h4>整理模型</h4><ModelPicker value={prefs.organizerModel} inheritLabel="使用来源会话模型" onDefaultSelect={(organizerModel) => configure({ organizerModel })} />
      <p className="meta">完成目的自动入队；积累 {memoryBatchSize} 条或最早目的等待 {memoryBatchWaitMs / 60000} 分钟后互斥批量分类。一级目录最多 {memoryDirectoryMaxChars} 码点；语义目录达到 {memoryOrganizationWatermarks.early} 码点先重整至 {memoryOrganizationWatermarks.target}，发布上限 {memoryOrganizationWatermarks.maximum}。不符合目的结构的记忆跳过。配置适用于所有工作空间。</p>
      <NumberSetting label="执行时限（秒）" value={prefs.timeoutMs / 1000} max={3600} save={(value) => configure({ timeoutMs: value * 1000 })} />
      <NumberSetting label="完整分类输入上限（字符）" value={prefs.readChars} min={16000} save={(readChars) => configure({ readChars })} />
      <p className="meta">离开输入框自动保存。目的终态只入队一次，整理模型只接收旧树和去重原标题，不接收来源标识、正文或邻近语境。查询模型只匹配语义目录，由程序展开后代文档；浏览索引不调用模型。</p>
    </fieldset> : <p role="status">正在读取设置…</p>}</div>}
    <div className="memory-tree-workspace">
      <MemoryMindMap key={workspaceId} roots={roots} query={query} workspaceName={workspaces.find(workspace => workspace.id === workspaceId)?.name ?? "记忆"}
        loading={!tree} unavailable={tree?.unavailable} selected={selected} onSelect={setSelected} fullscreen={fullscreen} toggleFullscreen={toggleFullscreen} />
      {chosen && <MemoryNodeInspector key={chosen.id} node={chosen} workspaceId={workspaceId} catalog={catalog ?? []} open={open} close={() => setSelected(undefined)} />}
    </div>
  </section>;
}
