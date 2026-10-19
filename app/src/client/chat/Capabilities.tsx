import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Scope } from "../../shared/protocol.js";
import { capabilitiesScope, type CapabilityCatalog, type CapabilitySelection, type CapabilityState } from "../../shared/capabilities.js";
import { command, useConnection, useScope } from "../transport.js";
import { Icon } from "../Icon.js";
import { useSettingsPopover } from "../useSettingsPopover.js";
import "../styles/capabilities.css";

export function Capabilities({ scope }: { scope?: Scope }) {
  const [open, setOpen] = useState(false), id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={trigger} type="button" className="compression-trigger capability-trigger action-icon"
      aria-label="技能与 MCP" data-tooltip="技能与 MCP" aria-haspopup="dialog" aria-expanded={open}
      aria-controls={id} popoverTarget={id} disabled={!scope}
      onClick={event => { event.preventDefault(); setOpen(value => !value); }}><Icon name="hand-click" /></button>
    {open && scope && <CapabilityDialog id={id} scope={scope} trigger={trigger.current!} onClose={() => setOpen(false)} />}
  </>;
}
function CapabilityDialog({ id, scope, trigger, onClose }: { id: string; scope: Scope; trigger: HTMLButtonElement; onClose: () => void }) {
  const { panel, close, host } = useSettingsPopover(trigger, onClose);
  const live = useScope<CapabilityState | null>(capabilitiesScope(scope), null);
  const connected = useConnection() === "已连接本地服务";
  const [catalog, setCatalog] = useState<CapabilityCatalog | null>(null);
  const [tab, setTab] = useState<"skills" | "mcp">("skills");
  const [query, setQuery] = useState("");
  const [reload, setReload] = useState(0), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<CapabilitySelection | null>(null);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  useEffect(() => {
    if (!connected) return;
    let current = true;
    setLoading(true);
    command<CapabilityCatalog>("capabilities.get", {}, scope).then(value => {
      if (current) setCatalog(previous => previous && previous.state.revision > value.state.revision ? previous : value);
    }, error => { if (current) setError(error.message); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [scope.workspaceId, scope.sessionId, connected, live?.revision, reload]);
  const state = live && (!catalog || live.revision > catalog.state.revision) ? live : catalog?.state;
  const selected = (kind: "skills" | "mcp"): string[] => (!state?.locked ? pendingSelection?.[kind] : undefined) ?? state?.selection?.[kind] ?? catalog?.[kind].filter(item => item.defaultSelected).map(item => item.id) ?? [];
  const disabled = !connected || !catalog || !state || state.locked || loading || saving;
  const toggle = async (kind: "skills" | "mcp", itemId: string, checked: boolean) => {
    if (disabled || !catalog || !state) return;
    setSaving(true); setError(""); setMessage("");
    const changed = new Set(selected(kind));
    if (checked) changed.add(itemId); else changed.delete(itemId);
    const selection = { skills: selected("skills"), mcp: selected("mcp"), [kind]: [...changed] };
    setPendingSelection(selection);
    try {
      const next = await command<CapabilityState>("capabilities.save", { revision: state.revision, catalogRevision: catalog.revision, ...selection }, scope);
      setCatalog(previous => previous && previous.state.revision <= next.revision ? { ...previous, state: next } : previous);
      setMessage("已保存到当前会话");
    } catch (error) {
      setError((error as Error).message);
      setReload(value => value + 1);
    } finally { setPendingSelection(null); setSaving(false); }
  };
  const items = catalog?.[tab].filter(item => `${item.name} ${item.description} ${item.source}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [];
  return createPortal(<dialog ref={panel} open popover="auto" id={id} className="compression-page capability-settings"
    aria-labelledby={`${id}-heading`} aria-describedby={`${id}-note`} onKeyDown={event => event.stopPropagation()}>
    <header><div><h2 id={`${id}-heading`}>技能与 MCP</h2><p id={`${id}-note`}>{state?.locked ? "当前会话 · 已锁定" : "当前会话 · 自动保存"}</p></div>
      <button ref={close} type="button" className="icon-btn" aria-label="关闭技能与 MCP" data-tooltip="返回会话（Esc）" onClick={onClose}><Icon name="x" /></button></header>
    <div className="compression-body">
      <p className="capability-note">{state?.legacy ? "历史会话沿用原有技能加载方式。以下技能来自最近一次加载记录；MCP 未因升级自动启用。" : state?.locked
        ? "会话已启动，选择已锁定。可在这里查看；如需调整，请新建会话。"
        : "选择本会话使用的技能和 MCP。首次启动后锁定，执行结束后仍保持当前选择。"}</p>
      <div className="capability-filters"><div role="group" aria-label="能力类型">
        <button type="button" aria-pressed={tab === "skills"} onClick={() => setTab("skills")}>Skills <span>{catalog?.skills.length ?? "—"}</span></button>
        <button type="button" aria-pressed={tab === "mcp"} onClick={() => setTab("mcp")}>MCP <span>{catalog?.mcp.length ?? "—"}</span></button>
      </div><button type="button" className="icon-btn" aria-label="刷新能力列表" data-tooltip="重新读取本机资源" disabled={!connected || loading || saving}
        onClick={() => { setError(""); setMessage(""); setReload(value => value + 1); }}><Icon name="refresh-cw" /></button></div>
      <input type="search" className="input" aria-label="搜索能力" placeholder={tab === "skills" ? "搜索技能" : "搜索 MCP"} value={query} onChange={event => setQuery(event.target.value)} />
      <p className="meta">{tab === "skills" ? "技能提供专门的工作方法，Agent 按需读取。" : "勾选后在会话启动时连接；列表不代表连接状态。"}</p>
      {catalog && <div className="capability-list" aria-label={tab === "skills" ? "技能列表" : "MCP 列表"}>
        {items.map(item => <label key={item.id} className="capability-item" data-unavailable={!item.available || undefined}>
          <input type="checkbox" checked={selected(tab).includes(item.id)} aria-label={item.name} disabled={disabled || !item.available && !selected(tab).includes(item.id)}
            onChange={event => void toggle(tab, item.id, event.target.checked)} />
          <span><strong>{item.name}</strong>{!item.available && <small className="capability-unavailable">资源已不可用</small>}
            <span className="capability-description">{item.description}</span><small className="capability-source">{item.source}</small></span>
        </label>)}
        {!items.length && <p className="capability-empty">{query.trim() ? "没有匹配的能力。" : tab === "skills" ? "未发现可用技能。" : "未发现 MCP 配置。"}</p>}
      </div>}
      {tab === "mcp" && !!catalog && !catalog.mcp.length && !state?.legacy && <details className="capability-sources"><summary>配置文件位置</summary>
        {catalog.mcpPaths.map(path => <code key={path}>{path}</code>)}<p className="meta">读取这些文件中的 mcpServers；添加配置后刷新列表。</p></details>}
      {catalog?.warnings.map(warning => <p className="capability-warning" key={warning}>{warning}</p>)}
      {error && <p className="error" role="alert">{error}</p>}
      <p className="meta" role="status">{!connected ? "连接断开，暂时无法读取或保存。" : saving ? "保存中…" : loading ? "正在读取能力目录…" : message}</p>
    </div>
    <footer><small>{state?.legacy ? "历史会话仅供查看" : `已选择 ${selected("skills").length} 个技能 · ${selected("mcp").length} 个 MCP`}</small></footer>
  </dialog>, host);
}
