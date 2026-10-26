import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Scope } from "../../shared/protocol.js";
import { capabilityPreferencesScope, capabilitiesScope, type CapabilityCatalog, type CapabilityState, type CapabilityReloadSelection } from "../../shared/capabilities.js";
import { reloadScope, type ReloadState } from "../../shared/reload.js";
import { command, useConnectionState, useScope } from "../transport.js";
import { reloadSessionAndPage } from "../session-page-reload.js";
import { getComposerDraft as getDraft, updateComposerDraft as updateDraft, useComposerDraft as useDraft } from "./composer-edit.js";
import { LocalPath, isLocalPath } from "../LocalPath.js";
import { SkillFileActions } from "./SkillCards.js";
import { BuiltinMark } from "../BuiltinMark.js";
import { Icon } from "../Icon.js";
import { useSettingsPopover } from "../useSettingsPopover.js";
import { useCapabilityDrafts, type SelectionDrafts } from "../capability-drafts.js";
import "../styles/capabilities.css";

export function Capabilities({ scope }: { scope?: Scope }) {
  const key = scope ? `${scope.workspaceId}:${scope.sessionId}` : "";
  const { drafts: selections, update: setSelections } = useCapabilityDrafts(key);
  const [open, setOpen] = useState(false), id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={trigger} type="button" className="compression-trigger capability-trigger action-icon"
      aria-label="技能与 MCP" data-tooltip="技能与 MCP" aria-haspopup="dialog" aria-expanded={open}
      aria-controls={id} popoverTarget={id} disabled={!scope}
      onClick={event => { event.preventDefault(); setOpen(value => !value); }}><Icon name="hand-click" /></button>
    {open && scope && <CapabilityDialog key={key} id={id} scope={scope} selectionDrafts={selections} onSelections={setSelections} trigger={trigger.current!} onClose={() => setOpen(false)} />}
  </>;
}
function CapabilityDialog({ id, scope, trigger, onClose, selectionDrafts, onSelections: changeDraft }: { id: string; scope: Scope; trigger: HTMLButtonElement; onClose: () => void; selectionDrafts: SelectionDrafts; onSelections: (target: "session" | "defaults", value?: CapabilityReloadSelection) => void }) {
  const { panel, close, host } = useSettingsPopover(trigger, onClose);
  const live = useScope<CapabilityState | null>(capabilitiesScope(scope), null);
  const preferences = useScope<{ revision: number } | null>(capabilityPreferencesScope, null);
  const applying = useScope<ReloadState | null>(reloadScope(scope), null);
  const connection = useConnectionState(), connected = connection.connected;
  const draft = useDraft(scope);

  const [view, setView] = useState<"defaults" | "session">("session");
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
  const baseline = (kind: "skills" | "mcp"): string[] => view === "session" && state?.legacy ? kind === "skills" ? catalog?.sessionSkills?.filter(item => item.available).map(item => item.id) ?? [] : [] : view === "session" && state?.selection?.[kind] ? state.selection[kind]! : catalog?.[kind].filter(item => item.defaultSelected).map(item => item.id) ?? [];
  const pending = selectionDrafts[view];
  const selected = (kind: "skills" | "mcp") => pending?.[kind] ?? baseline(kind);
  const busy = saving || applying?.status === "running";
  const stale = !!pending && !!catalog && (pending.catalogRevision !== catalog.revision || pending.revision !== (view === "session" ? state?.revision : catalog.preferencesRevision));
  const disabled = !connected || !catalog || !state || loading || busy || !catalog.sessionSkillsEditable;
  const toggle = (kind: "skills" | "mcp", itemId: string, checked: boolean) => {
    if (disabled || !catalog || !state) return;
    const ids = new Set(selected(kind));
    if (checked) ids.add(itemId); else ids.delete(itemId);
    const next = { ...pending ?? { target: view, revision: view === "session" ? state.revision : catalog.preferencesRevision,
      catalogRevision: catalog.revision, skills: baseline("skills"), mcp: baseline("mcp") }, [kind]: [...ids] };
    const unchanged = (["skills", "mcp"] as const).every(key => next[key].length === baseline(key).length && next[key].every(id => baseline(key).includes(id)));
    changeDraft(view, unchanged ? undefined : next);
    setError(""); setMessage("");
  };
  const apply = async () => {
    if (disabled || stale || !pending) return;
    const target = view;
    setSaving(true); setError(""); setMessage("");
    try {
      await reloadSessionAndPage(scope, pending, () => { changeDraft(target); setMessage("选择已应用，会话资源已重新加载。"); });
    } catch (error) {
      setError((error as Error).message);
    } finally { setSaving(false); setReload(value => value + 1); }
  };
  const skillUseState = (item: { id: string; available: boolean; defaultSelected: boolean }) => {
    const automatic = !!(state?.legacy ? catalog?.sessionSkills?.some(skill => skill.id === item.id && skill.available)
      : state?.selection?.skills === null ? item.defaultSelected : state?.selection ? state.selection.skills?.includes(item.id) : item.defaultSelected);
    const reason = !connected ? "连接断开，暂时无法添加" : loading ? "正在读取技能状态" : saving ? "正在保存选择"
      : !item.available ? "技能资源已不可用" : draft.skills?.some(skill => skill.id === item.id) ? "已添加到本次输入" : "";
    const pending = state?.locked && automatic !== item.defaultSelected
      ? automatic ? "当前会话仍允许自动选用；重新加载后关闭" : "重新加载后允许自动选用；目前仍可手动使用" : "";
    return { disabled: !!reason, hint: reason || (pending ? `${pending}，可添加到本次输入` : "添加到本次输入（不受自动选用勾选影响）"), pending };
  };
  const items = (view === "session" && state?.legacy && !catalog?.sessionSkillsEditable ? tab === "skills" ? catalog?.sessionSkills : [] : catalog?.[tab])?.filter(item => `${item.name} ${item.description} ${item.source}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [];
  return createPortal(<dialog ref={panel} open popover="auto" id={id} className="compression-page capability-settings"
    aria-labelledby={`${id}-heading`} aria-describedby={`${id}-note`} onKeyDown={event => event.stopPropagation()}>
    <header><div><h2 id={`${id}-heading`}>技能与 MCP</h2><p id={`${id}-note`}>{view === "defaults" ? "全局默认 · 批量应用" : "当前会话 · 批量应用"}</p></div>
      <button ref={close} type="button" className="icon-btn" aria-label="关闭技能与 MCP" data-tooltip="返回会话（Esc）" onClick={onClose}><Icon name="x" /></button></header>
    <div className="compression-body">
      <p className="capability-note">Skills 勾选控制自动选用，未勾选仍可手动添加。MCP 勾选控制启用连接。可跨标签调整多项，点击“应用并重新加载”后统一生效。</p>
      <div className="capability-filters"><div role="group" aria-label="选择范围">
        <button type="button" aria-pressed={view === "session"} onClick={() => setView("session")}>当前会话</button>
        <button type="button" aria-pressed={view === "defaults"} onClick={() => setView("defaults")}>全局默认</button>
      </div></div>
      <p className="meta">{catalog?.sessionSkillsEditable === false ? "子任务沿用受限能力范围。" : view === "session" ? "只应用到当前会话，不改变全局默认。运行中会等待整批工具完成再重新加载。" : "应用后保存为全局默认，并重新加载当前会话。新会话使用此默认选择。"}</p>
      {view === "session" && state?.legacy && <p className="meta">历史会话沿用原有技能加载方式；实际可用性在发送时核验，MCP 未因升级自动启用。</p>}
      <div className="capability-filters"><div role="group" aria-label="能力类型">
        <button type="button" aria-pressed={tab === "skills"} onClick={() => setTab("skills")}>Skills <span>{catalog?.skills.length ?? "—"}</span></button>
        <button type="button" aria-pressed={tab === "mcp"} onClick={() => setTab("mcp")}>MCP <span>{catalog?.mcp.length ?? "—"}</span></button>
      </div><button type="button" className="icon-btn" aria-label="刷新能力列表" data-tooltip="重新读取本机资源" disabled={!connected || loading || saving}
        onClick={() => { setError(""); setMessage(""); setReload(value => value + 1); }}><Icon name="refresh-cw" /></button></div>
      <input type="search" className="input" aria-label="搜索能力" placeholder={tab === "skills" ? "搜索技能" : "搜索 MCP"} value={query} onChange={event => setQuery(event.target.value)} />
      <p className="meta">{tab === "skills" ? "勾选允许模型按需发现并读取；使用按钮直接添加技能正文，不要求勾选。" : "勾选仅暂存，点击应用后重新加载连接；支持新增、移除及配置更新。列表不代表连接状态。"}</p>
      {catalog && <div className="capability-list" data-kind={tab} aria-label={tab === "skills" ? "技能列表" : "MCP 列表"}>
        {items.map(item => { const useState = skillUseState(item); return <div key={item.id} className="capability-item" data-unavailable={!item.available || undefined}>
          <label className="capability-choice"><input type="checkbox" checked={selected(tab).includes(item.id)} aria-label={item.name} disabled={disabled || !item.available && !selected(tab).includes(item.id)}
            aria-description={tab === "skills" ? useState.pending || undefined : undefined}
            onChange={event => void toggle(tab, item.id, event.target.checked)} />
          <span><strong data-tooltip={tab === "skills" ? [item.source, useState.pending].filter(Boolean).join("\n") : undefined}>{item.name}</strong>{item.builtin && <BuiltinMark kind={item.builtin} fallback={item.fallback} />}{!item.available && <small className="capability-unavailable">资源已不可用</small>}
            <span className="capability-description">{item.description}</span></span></label>
          {tab === "skills" && <div className="capability-item-actions">
            <button type="button" className="icon-btn capability-use" aria-label={`使用技能：${item.name}`} data-tooltip={useState.hint}
              disabled={useState.disabled}
              onClick={() => { const current = getDraft(scope); if ((current.skills?.length ?? 0) >= 32) { setError("每条消息最多使用 32 个技能"); return; }
                if (!current.skills?.some(skill => skill.id === item.id)) updateDraft(scope, { skills: [...current.skills ?? [], { id: item.id, name: item.name, description: item.description }] });
                setMessage(`已添加 ${item.name} 到本次输入`); }}><Icon name="hand-click" /></button>
            <SkillFileActions skill={item} path={isLocalPath(item.source) ? item.source : undefined} scope={scope} disabled={!item.available} onPreview={onClose} />
          </div>}
        </div>; })}
        {!items.length && <p className="capability-empty">{query.trim() ? "没有匹配的能力。" : tab === "skills" ? "未发现可用技能。" : "未发现 MCP 配置。"}</p>}
      </div>}
      {tab === "mcp" && !!catalog && !catalog.mcp.length && !state?.legacy && <details className="capability-sources"><summary>配置文件位置</summary>
        {catalog.mcpPaths.map(path => <LocalPath key={path} path={path} />)}<p className="meta">读取这些文件中的 mcpServers；添加配置后刷新列表。</p></details>}
      {catalog?.warnings.map(warning => <p className="capability-warning" key={warning}>{warning}</p>)}
      {stale && <p className="capability-warning" role="alert">选择或资源目录已更新，待应用选择已保留；请重置选择后重新勾选。</p>}
      {(error || applying?.status === "failed") && <p className="error" role="alert">{error || applying?.error}</p>}
      <p className="meta" role="status">{!connected ? "连接断开，暂时无法读取或应用。" : busy ? "正在重新加载，等待当前步骤与工具完成…" :
        loading ? "正在读取能力目录…" : message || (pending ? "有待应用选择，尚未生效。" : "")}</p>
    </div>
    <footer><small>{`${view === "defaults" ? "全局默认" : "当前会话"}${pending ? "（待应用）" : ""}：${selected("skills").length} 个自动选用技能 · ${selected("mcp").length} 个启用 MCP`}</small>
      <div className="capability-apply-actions"><button type="button" className="btn" disabled={!pending || busy} onClick={() => { changeDraft(view); setError(""); setMessage(""); }}>重置选择</button>
        <button type="button" className="btn btn-primary" disabled={disabled || stale || !pending} onClick={() => void apply()}>{busy ? "正在重新加载…" : "应用并重新加载"}</button></div>
    </footer>
  </dialog>, host);
}
