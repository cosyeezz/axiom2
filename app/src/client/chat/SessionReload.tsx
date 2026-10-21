import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { useConnectionState, useScope } from "../transport.js";
import { reloadSessionAndPage } from "../session-page-reload.js";
import { useSettingsPopover } from "../useSettingsPopover.js";
import { Icon } from "../Icon.js";
import type { Scope } from "../../shared/protocol.js";
import { reloadScope, resourceChanges, resourceKinds, resourceLabels, type ReloadState, type ReloadStage } from "../../shared/reload.js";
import "../styles/session-reload.css";

const stageLabels: Record<ReloadStage, string> = { waiting: "等待当前回合与工具完成", preparing: "准备会话", reloading: "重新加载 pi 资源", comparing: "核对加载结果", completed: "重载完成", failed: "重载未完成" };
export function SessionReload({ scope }: { scope?: Scope }) {
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const state = useScope<ReloadState | null>(scope ? reloadScope(scope) : null, null);
  return <>
    <button type="button" className="usage-metric action-icon session-reload-trigger" aria-label="重新加载会话配置" aria-haspopup="dialog" aria-expanded={!!trigger} disabled={!scope}
      data-tooltip="重新加载会话配置与 Skills" onClick={event => setTrigger(trigger ? null : event.currentTarget)}>
      <Icon name="settings-reload" />{state?.status === "running" && <span className="reload-indicator" />}
    </button>
    {trigger && scope && <ReloadDialog scope={scope} state={state} trigger={trigger} onClose={() => setTrigger(null)} />}
  </>;
}
function ReloadDialog({ scope, state, trigger, onClose }: { scope: Scope; state: ReloadState | null; trigger: HTMLButtonElement; onClose: () => void }) {
  const { panel, close, host } = useSettingsPopover(trigger, onClose, "anchored");
  const id = useId(), connection = useConnectionState();
  const [sending, setSending] = useState(false), [error, setError] = useState("");
  const busy = sending || state?.status === "running";
  const reload = async () => {
    setSending(true); setError("");
    try { await reloadSessionAndPage(scope); }
    catch (error) { setError(error instanceof Error ? error.message : "重载请求未确认，请查看当前状态。"); }
    finally { setSending(false); }
  };
  return createPortal(<dialog ref={panel} open popover="auto" className="toolbar-detail-panel session-reload" aria-labelledby={id}>
    <header className="toolbar-detail-header"><div><h2 id={id}>重新加载会话</h2><p>配置与资源 · pi 原生重载</p></div><button ref={close} type="button" className="icon-btn" aria-label="关闭重载详情" onClick={onClose}><Icon name="close" /></button></header>
    <div className="toolbar-detail-body session-reload-body">
      <p>重新读取会话设置、Skills、扩展、提示词模板、主题和项目指令。成功后自动刷新当前页面，保留对话记录、输入草稿与当前模型选择。</p>
      <p className="reload-note">运行中会等待当前回合的整批工具执行完成，在下一次模型请求前暂停并重载，成功后继续。关闭此窗口不会取消重载。子会话仍遵守调研与测试权限。</p>
      <p className="reload-note">仅加载当前会话已授权的资源；模型认证与能力选择由各自设置入口管理。扩展重载可能重新连接服务。主题仅核对 pi 资源，不改变此页面外观。</p>
      {state && <section aria-label="重载过程" aria-live="polite" aria-busy={state.status === "running"}>
        <div className="reload-status"><strong>{stageLabels[state.stage]}</strong><time>{new Date(state.startedAt).toLocaleTimeString("zh-CN")}</time></div>
        <ol className="reload-steps">{state.steps.map((step, index) => <li key={`${step.stage}:${index}`}><span>{stageLabels[step.stage]}</span><time>{new Date(step.at).toLocaleTimeString("zh-CN")}</time></li>)}</ol>
        {state.status === "completed" && <p className="reload-note">{state.resumed ? "已放行当前执行，后续请求使用重新加载的资源。" : "当前会话资源已重新加载。"}</p>}
        {state.error && <p className="reload-error" role="alert">{state.error}</p>}
        {!!state.warnings?.length && <ul className="reload-warnings">{state.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
      </section>}
      {state?.after && <section aria-label="资源前后对比">
        <h3>前后对比</h3>
        {!state.before && <p className="reload-note">没有此前的已加载快照，仅展示本次结果。</p>}
        <div className="reload-table" role="table" aria-label="加载资源变化"><div role="row" className="reload-table-head"><span role="columnheader">资源</span><span role="columnheader">之前 → 之后</span><span role="columnheader">变化</span></div>
          {resourceKinds.map(kind => { const after = state.after![kind], before = state.before?.[kind], diff = resourceChanges(before, after); return <details key={kind}>
            <summary><span>{resourceLabels[kind]}</span><span>{before?.length ?? "—"} → {after.length}</span><span>{diff.unknown ? "首次快照" : diff.added.length + diff.removed.length + diff.changed.length ? `+${diff.added.length} −${diff.removed.length} ~${diff.changed.length}` : "无变化"}</span></summary>
            <ul>{[["新增", diff.added], ["移除", diff.removed], ["更新", diff.changed]].flatMap(([label, names]) => (names as string[]).map(name => <li key={`${label}:${name}`}><b>{label}</b> {name}</li>))}{!diff.added.length && !diff.removed.length && !diff.changed.length && <li>{diff.unknown ? after.map(item => item.name).join("、") || "未加载" : "名称与内容指纹均未变化。"}</li>}</ul>
          </details>; })}
        </div>
        <p className="reload-note">按加载时的内容指纹比较；不会展示配置值。扩展比较入口文件，未追踪其全部依赖。</p>
      </section>}
      {!connection.connected && <p className="reload-error" role="status">连接已断开；重连后将读取实际状态，不会自动重发。</p>}
      {error && <p className="reload-error" role="alert">{error}</p>}
    </div>
    <footer className="toolbar-detail-footer"><button type="button" className="reload-submit" disabled={busy || !connection.connected} onClick={() => void reload()}><Icon name="settings-reload" />{busy ? state ? stageLabels[state.stage] : "正在提交…" : "重新加载会话"}</button></footer>
  </dialog>, host);
}
