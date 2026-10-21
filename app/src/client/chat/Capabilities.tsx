import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Scope } from "../../shared/protocol.js";
import { capabilityPreferencesScope, capabilitiesScope, type CapabilityCatalog, type CapabilityState } from "../../shared/capabilities.js";
import { command, useConnectionState, useScope } from "../transport.js";
import { getDraft, updateDraft, useDraft } from "../drafts.js";
import { SkillFileActions } from "./SkillCards.js";
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
  const preferences = useScope<{ revision: number } | null>(capabilityPreferencesScope, null);
  const connection = useConnectionState(), connected = connection.connected;
  const draft = useDraft(scope);
  const [view, setView] = useState<"defaults" | "session">("defaults");
  const [catalog, setCatalog] = useState<CapabilityCatalog | null>(null);
  const [tab, setTab] = useState<"skills" | "mcp">("skills");
  const [query, setQuery] = useState("");
  const [reload, setReload] = useState(0), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  useEffect(() => {
    if (!connected) return;
    let current = true;
    setLoading(true);
    command<CapabilityCatalog>("capabilities.get", {}, scope).then(value => {
      if (current) setCatalog(value);
    }, error => { if (current) setError(error.message); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [scope.workspaceId, scope.sessionId, connected, connection.generation, preferences?.revision, live?.revision, reload]);
  const state = live && (!catalog || live.revision > catalog.state.revision) ? live : catalog?.state;
  const selected = (kind: "skills" | "mcp"): string[] => view === "session" && state?.legacy ? kind === "skills" ? catalog?.sessionSkills?.map(item => item.id) ?? [] : [] : view === "session" && state?.selection?.[kind] ? state.selection[kind]! : catalog?.[kind].filter(item => item.defaultSelected).map(item => item.id) ?? [];
  const disabled = !connected || !catalog || !state || view === "session" || loading || saving;
  const toggle = async (kind: "skills" | "mcp", itemId: string, checked: boolean) => {
    if (disabled || !catalog || !state) return;
    setSaving(true); setError(""); setMessage("");
    try {
      await command("capabilities.defaults.save", { revision: catalog.preferencesRevision, catalogRevision: catalog.revision, kind, id: itemId, checked }, scope);
      setReload(value => value + 1);
      setMessage("已保存选择；重新加载后应用到当前会话");
    } catch (error) {
      setError((error as Error).message);
      setReload(value => value + 1);
    } finally { setSaving(false); }
  };
  const skillUseState = (item: { id: string; available: boolean; defaultSelected: boolean }) => {
    const loaded = !!(state?.legacy ? catalog?.sessionSkills?.some(skill => skill.id === item.id && skill.available)
      : state?.locked ? state.selection?.skills === null || state.selection?.skills?.includes(item.id) : item.defaultSelected);
    const reason = !connected ? "连接断开，暂时无法添加" : loading ? "正在读取技能状态" : saving ? "正在保存选择"
      : !item.available ? "技能资源已不可用" : draft.skills?.some(skill => skill.id === item.id) ? "已添加到本次输入"
      : !loaded ? item.defaultSelected ? "请重新加载当前会话后添加" : "请先勾选技能；已启动会话还需重新加载" : "";
    const pending = state?.locked && loaded !== item.defaultSelected
      ? loaded ? "当前会话仍已加载；重新加载后应用取消选择" : "已勾选；重新加载后可用于当前会话" : "";
    return { disabled: !!reason, hint: reason || (pending ? `${pending}，目前可添加到本次输入` : "添加到本次输入"), pending };
  };
  const items = (view === "session" && state?.legacy ? tab === "skills" ? catalog?.sessionSkills : [] : catalog?.[tab])?.filter(item => `${item.name} ${item.description} ${item.source}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [];
  return createPortal(<dialog ref={panel} open popover="auto" id={id} className="compression-page capability-settings"
    aria-labelledby={`${id}-heading`} aria-describedby={`${id}-note`} onKeyDown={event => event.stopPropagation()}>
    <header><div><h2 id={`${id}-heading`}>技能与 MCP</h2><p id={`${id}-note`}>{view === "defaults" ? "全局默认 · 自动保存" : "当前会话 · 运行选择"}</p></div>
      <button ref={close} type="button" className="icon-btn" aria-label="关闭技能与 MCP" data-tooltip="返回会话（Esc）" onClick={onClose}><Icon name="x" /></button></header>
    <div className="compression-body">
      <p className="capability-note">勾选会全局记住，并同步到其他窗口及未启动会话。已启动会话点击重新加载后应用最新勾选；使用按钮将已加载的技能添加到本次输入。</p>
      {state?.locked && <div className="capability-filters"><div role="group" aria-label="选择范围">
        <button type="button" aria-pressed={view === "defaults"} onClick={() => setView("defaults")}>全局默认</button>
        <button type="button" aria-pressed={view === "session"} onClick={() => setView("session")}>当前会话</button>
      </div></div>}
      {view === "session" && state?.legacy && <p className="meta">历史会话沿用原有技能加载方式；实际可用性在发送时核验，MCP 未因升级自动启用。</p>}
      <div className="capability-filters"><div role="group" aria-label="能力类型">
        <button type="button" aria-pressed={tab === "skills"} onClick={() => setTab("skills")}>Skills <span>{catalog?.skills.length ?? "—"}</span></button>
        <button type="button" aria-pressed={tab === "mcp"} onClick={() => setTab("mcp")}>MCP <span>{catalog?.mcp.length ?? "—"}</span></button>
      </div><button type="button" className="icon-btn" aria-label="刷新能力列表" data-tooltip="重新读取本机资源" disabled={!connected || loading || saving}
        onClick={() => { setError(""); setMessage(""); setReload(value => value + 1); }}><Icon name="refresh-cw" /></button></div>
      <input type="search" className="input" aria-label="搜索能力" placeholder={tab === "skills" ? "搜索技能" : "搜索 MCP"} value={query} onChange={event => setQuery(event.target.value)} />
      <p className="meta">{tab === "skills" ? "技能提供专门的工作方法，Agent 按需读取。" : "勾选后在会话启动或重新加载时连接；列表不代表连接状态。"}</p>
      {catalog && <div className="capability-list" aria-label={tab === "skills" ? "技能列表" : "MCP 列表"}>
        {items.map(item => { const useState = skillUseState(item); return <div key={item.id} className="capability-item" data-unavailable={!item.available || undefined}>
          <label className="capability-choice"><input type="checkbox" checked={selected(tab).includes(item.id)} aria-label={item.name} disabled={disabled || !item.available && !selected(tab).includes(item.id)}
            onChange={event => void toggle(tab, item.id, event.target.checked)} />
          <span><strong>{item.name}</strong>{!item.available && <small className="capability-unavailable">资源已不可用</small>}
            <span className="capability-description">{item.description}</span><small className="capability-source">{item.source}</small>{tab === "skills" && useState.pending && <small className="capability-runtime">{useState.pending}</small>}</span></label>
          {tab === "skills" && <div className="capability-item-actions">
            <button type="button" className="icon-btn capability-use" aria-label={`使用技能：${item.name}`} data-tooltip={useState.hint}
              disabled={useState.disabled}
              onClick={() => { const current = getDraft(scope); if ((current.skills?.length ?? 0) >= 32) { setError("每条消息最多使用 32 个技能"); return; }
                if (!current.skills?.some(skill => skill.id === item.id)) updateDraft(scope, { skills: [...current.skills ?? [], { id: item.id, name: item.name, description: item.description }] });
                setMessage(`已添加 ${item.name} 到本次输入`); }}><Icon name="hand-click" /></button>
            <SkillFileActions skill={item} scope={scope} disabled={!item.available} onPreview={onClose} />
          </div>}
        </div>; })}
        {!items.length && <p className="capability-empty">{query.trim() ? "没有匹配的能力。" : tab === "skills" ? "未发现可用技能。" : "未发现 MCP 配置。"}</p>}
      </div>}
      {tab === "mcp" && !!catalog && !catalog.mcp.length && !state?.legacy && <details className="capability-sources"><summary>配置文件位置</summary>
        {catalog.mcpPaths.map(path => <code key={path}>{path}</code>)}<p className="meta">读取这些文件中的 mcpServers；添加配置后刷新列表。</p></details>}
      {catalog?.warnings.map(warning => <p className="capability-warning" key={warning}>{warning}</p>)}
      {error && <p className="error" role="alert">{error}</p>}
      <p className="meta" role="status">{!connected ? "连接断开，暂时无法读取或保存。" : saving ? "保存中…" : loading ? "正在读取能力目录…" : message}</p>
    </div>
    <footer><small>{`${view === "defaults" ? "全局默认" : "当前会话"}：${selected("skills").length} 个技能 · ${selected("mcp").length} 个 MCP`}</small></footer>
  </dialog>, host);
}
