import { BackendMaintenance } from "../maintenance/BackendMaintenance.js";
import { useEffect, useRef, useState } from "react";
import { LocalPath, ResourceLocation, PathNotice } from "../LocalPath.js";
import { SettingsSidebar } from "../components.js";
import { PathInput } from "../FilePicker.js";
import { JsonPathInput } from "../JsonPathInput.js";
import { skillImportName } from "../../shared/skill-import.js";
import { Select } from "../Select.js";
import { SettingsHeader } from "../settings/SettingsHeader.js";
import { BuiltinMark } from "../BuiltinMark.js";
import { command, useConnectionState, useScope } from "../transport.js";
import type { ResourceDetail, ResourceItem, ResourceState } from "../../shared/resources.js";
import "../styles/settings.css";
import "../styles/builtin-tools.css";
import "../styles/resources.css";
const empty: ResourceState = { revision: "", items: [], scopes: [], warnings: [] };
const dismissedJobKey = "axiom.resources.dismissed-error";
function readDismissedJob() {
  try { return localStorage.getItem(dismissedJobKey) ?? ""; } catch { return ""; }
}
type View = "skill" | "mcp";
export default function Resources() {
  const state = useScope("resources", empty), connection = useConnectionState();
  const [view, setView] = useState<View>("skill"), [scopeId, setScopeId] = useState("global");
  const [selected, setSelected] = useState<string>(), [creating, setCreating] = useState(false), [query, setQuery] = useState("");
  const [kind, setKind] = useState<"skill" | "package">("skill");
  const [name, setName] = useState(""), [source, setSource] = useState(""), [config, setConfig] = useState(""), [bin, setBin] = useState("");
  const [detail, setDetail] = useState<ResourceDetail>(), [documentIndex, setDocumentIndex] = useState(0), [content, setContent] = useState("");
  const [loading, setLoading] = useState(false), [sending, setSending] = useState<string[]>([]), [error, setError] = useState("");
  const [moveScopeId, setMoveScopeId] = useState("");
  const [picking, setPicking] = useState(false);
  const [operations, setOperations] = useState<{ id: string; op: string; target?: string; destinationScopeId?: string; epoch: number }[]>([]);
  const viewEpoch = useRef(0);
  const [notice, setNotice] = useState("");
  const [dismissedJob, setDismissedJob] = useState(readDismissedJob);
  const jobs = state.jobs ?? (state.job ? [state.job] : []);
  const failedJob = jobs.findLast(job => !job.running && job.error);
  const failedJobKey = failedJob ? JSON.stringify([failedJob.id, failedJob.error]) : "";
  function dismissJob() {
    setDismissedJob(failedJobKey);
    try { localStorage.setItem(dismissedJobKey, failedJobKey); } catch { /* Keep dismissal for this page when storage is unavailable. */ }
  }
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === dismissedJobKey || event.key === null) setDismissedJob(readDismissedJob()); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const [modal, setModal] = useState<{ kind: "remove"; item: ResourceItem; revision: string; clearCredentials?: boolean } | { kind: "move"; item: ResourceItem; revision: string; destinationScopeId: string } | { kind: "discard" | "template"; run: () => void; template?: string }>();
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLElement | null>(null), request = useRef(0);
  const item = state.items.find(row => row.id === selected);
  const moveScopes = state.scopes.filter(s => item?.scopeId === "global" ? s.kind === "project" : s.kind === "global");
  const moveDestination = moveScopes.find(s => s.id === moveScopeId)?.id ?? moveScopes[0]?.id;
  const scope = state.scopes.find(row => row.id === scopeId);
  const scopeName = (id: string) => state.scopes.find(s => s.id === id)?.name ?? "未知范围";
  const group = state.items.filter(row => row.scopeId === scopeId && (view === "mcp" ? row.kind === "mcp" : row.kind !== "mcp"));
  const rows = group.filter(row => `${row.name} ${row.description} ${row.source}`.toLowerCase().includes(query.toLowerCase()));
  const navigationBusy = picking || !connection.connected;
  const selectedJob = !creating && selected ? jobs.findLast(job => job.running && (job.targetId === selected || job.resourceId === selected)) : undefined;
  const pendingHere = operations.some(operation => operation.epoch === viewEpoch.current);
  const busy = navigationBusy || sending.includes(selected ?? `form:${viewEpoch.current}`) || !!selectedJob || pendingHere;
  const localImport = view === "skill" && kind === "skill" && !source.trim().startsWith("npm:");
  const doc = detail?.documents[documentIndex];
  const draftDirty = creating ? !!(name || source || config || bin) : !!(detail && (config !== (detail.config ?? "") || content !== (doc?.content ?? "")));
  const dirty = !pendingHere && draftDirty;
  const stale = !!detail && detail.revision !== state.revision;
  function clear() { viewEpoch.current++; request.current++; setDetail(undefined); setContent(""); setConfig(""); setSource(""); setBin(""); setName(""); setDocumentIndex(0); setError(""); setNotice(""); setLoading(false); }
  function navigate(run: () => void) {
    if (navigationBusy) return;
    if (dirty) { trigger.current = document.activeElement as HTMLElement; setModal({ kind: "discard", run }); }
    else run();
  }
  function applyTemplate(template: string, value: string) {
    if (busy) return;
    if (!config) { setConfig(value); return; }
    trigger.current = document.activeElement as HTMLElement;
    setModal({ kind: "template", template, run: () => setConfig(value) });
  }
  function choose(id?: string) { clear(); setSelected(id); setCreating(!id); if (id && id === selected) void load(id); }
  async function load(id: string, preserveError = false) {
    const ticket = ++request.current; setLoading(true); if (!preserveError) setError("");
    try {
      const result = await command<ResourceDetail>("resources.detail", { id });
      if (request.current !== ticket) return;
      setDetail(result); setConfig(result.config ?? ""); setDocumentIndex(0); setContent(result.documents[0]?.content ?? "");
    } catch (cause) { if (ticket === request.current) setError(current => preserveError && current ? current : (cause as Error).message); }
    finally { if (ticket === request.current) setLoading(false); }
  }
  function changeSource(value: string) {
    if (localImport && (!name || name === skillImportName(source))) setName(skillImportName(value));
    setSource(value);
  }
  async function act(op: string, params: Record<string, unknown> = {}) {
    const epoch = viewEpoch.current, key = selected ?? `form:${epoch}`, target = typeof params.id === "string" ? params.id : undefined;
    setSending(current => [...current, key]); setError(""); setNotice("");
    try {
      const result = await command<ResourceState>(op, { ...(op === "resources.get" ? {} : { revision: state.revision, scopeId }), ...params });
      const id = result.acceptedJobId ?? result.job?.id;
      if (op !== "resources.get" && id) setOperations(current => [...current, { id, op, target, epoch, destinationScopeId: typeof params.destinationScopeId === "string" ? params.destinationScopeId : undefined }]);
    } catch (cause) { if (epoch === viewEpoch.current) setError((cause as Error).message); }
    finally { setSending(current => current.filter(value => value !== key)); }
  }
  useEffect(() => { if (connection.connected) void act("resources.get"); }, [connection.connected, connection.generation]);
  useEffect(() => {
    if (!dirty && !creating && !rows.some(row => row.id === selected)) {
      request.current++; setDetail(undefined); setConfig(""); setContent(""); setSelected(rows[0]?.id);
    }
  }, [state.revision, view, scopeId, query, creating]);
  useEffect(() => () => { request.current++; }, [selected, connection.connected]);
  useEffect(() => { if (selected && connection.connected && !draftDirty && !pendingHere && !selectedJob) void load(selected, true); }, [selected, connection.connected, selectedJob?.id, pendingHere]);
  useEffect(() => {
    const finished = operations.filter(operation => jobs.some(job => job.id === operation.id && !job.running));
    if (!finished.length) return;
    setOperations(current => current.filter(operation => !finished.some(done => done.id === operation.id)));
    const operation = finished.find(operation => operation.epoch === viewEpoch.current);
    if (!operation) return;
    const job = jobs.find(job => job.id === operation.id)!;
    if (job.error) { setError(job.error); return; }
    setNotice(operation.op === "resources.save" ? "配置已保存。" : "操作已完成。");
    setSource(""); setBin("");
    if (operation.op === "resources.install") {
      setName(""); setConfig(""); setCreating(false); setSelected(job.resourceId);
    } else if (operation.op === "resources.move") {
      clear(); setCreating(false); setQuery(""); setScopeId(operation.destinationScopeId!); setSelected(job.resourceId);
      setNotice(`${view === "mcp" ? "MCP" : "技能"}已移动到${scopeName(operation.destinationScopeId!)}。已有会话可重载资源后使用。`);
      if (job.resourceId) void load(job.resourceId);
    } else if (operation.op === "resources.remove") { clear(); setSelected(undefined); setNotice("已卸载，资源列表已刷新。"); }
    else if (operation.target === selected && selected) void load(selected);
  }, [state.jobs, state.job, operations]);
  useEffect(() => {
    if (modal) dialog.current?.showModal();
    else if (dialog.current?.open) { dialog.current.close(); trigger.current?.focus(); }
  }, [modal]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const changeView = (next: View) => navigate(() => { clear(); setView(next); setQuery(""); setSelected(undefined); setCreating(false); });
  const addLabel = view === "mcp" ? "添加 MCP" : "安装技能";
  const canSave = !!detail && !loading && !busy && dirty && (item?.kind === "mcp" || !!doc?.editable);
  const actions = <footer className="configuration-actions resources-actions"><div className="resources-save-state">{dirty ? "有未保存的修改" : detail ? "已读取实际配置" : ""}</div>{creating ? <button className="btn btn-primary" disabled={busy || !state.revision || (view === "mcp" ? !name.trim() || (!source.trim() && !config.trim()) : !source.trim() || localImport && !name.trim())} onClick={() => void act("resources.install", { kind: view === "mcp" ? "mcp" : kind, name, ...(source.trim() ? { source: source.trim() } : {}), ...(config.trim() ? { config } : {}), ...(bin.trim() ? { bin: bin.trim() } : {}) })}>{view === "mcp" ? "保存连接" : kind === "package" ? "安装资源包" : "安装技能"}</button> : item && <button className="btn btn-primary" disabled={!canSave} onClick={() => void act("resources.save", { id: item.id, revision: detail!.revision, ...(item.kind === "mcp" ? { config } : { path: doc?.path, content }) })}>保存{item.kind === "mcp" ? "配置" : "技能内容"}</button>}<button className="btn btn-ghost" disabled={navigationBusy} onClick={() => navigate(() => { clear(); void act("resources.get").then(() => { if (selected && !selectedJob) void load(selected); }); })}>刷新目录</button></footer>;
  return <div className="settings-app builtin-tools-app resources-app">
    <SettingsSidebar page="resources" />
    <main className="settings-main" id="content">
      <SettingsHeader page="resources" />
      <div className="resources-topbar">
        <div className="config-tabs" role="tablist" aria-label="资源类型" onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault(); const next = event.key === "Home" ? "skill" : event.key === "End" ? "mcp" : view === "skill" ? "mcp" : "skill";
          changeView(next); if (!dirty) document.getElementById(`resource-tab-${next}`)?.focus();
        }}>
          {(["skill", "mcp"] as const).map(value => <button key={value} id={`resource-tab-${value}`} role="tab" aria-selected={view === value} aria-controls="resource-panel" tabIndex={view === value ? 0 : -1} className={`config-tab ${view === value ? "active" : ""}`} disabled={navigationBusy} onClick={() => changeView(value)}>{value === "skill" ? "技能" : "MCP"}<span className="num">{state.items.filter(row => row.scopeId === scopeId && (value === "mcp" ? row.kind === "mcp" : row.kind !== "mcp")).length}</span></button>)}
        </div>
        <div className="resources-scope"><label htmlFor="resource-scope">作用范围</label><Select id="resource-scope" label="作用范围" value={scopeId} disabled={navigationBusy} onChange={id => navigate(() => { clear(); setScopeId(id); setSelected(undefined); setCreating(false); setQuery(""); })} options={[{ value: "global", label: "全局 · 所有项目" }, ...state.scopes.filter(s => s.kind === "project").map(s => ({ value: s.id, label: s.name, group: "项目" }))]} /></div>
      </div>
      <div className="configuration-layout" id="resource-panel" role="tabpanel" aria-labelledby={`resource-tab-${view}`}>
        <aside className="supplier-panel" aria-label={view === "skill" ? "技能列表" : "MCP 列表"}>
          <div className="supplier-toolbar"><h2>{view === "skill" ? "技能与资源包" : "MCP 服务"}<span className="meta num"> {group.length}</span></h2><button className="btn" disabled={navigationBusy} onClick={() => navigate(() => choose())}>{addLabel}</button></div>
          <div className="resources-search"><input className="input" aria-label="搜索资源" placeholder={view === "skill" ? "搜索技能或资源包" : "搜索 MCP"} value={query} onChange={event => { const value = event.target.value; navigate(() => { clear(); setSelected(undefined); setQuery(value); }); }} /></div>
          <p className="resources-list-caption">{scopeId === "global" ? "全局资源 · 可供所有项目使用" : `项目资源 · ${scopeName(scopeId)}`}</p>
          <nav className="supplier-list">{rows.map(row => <button key={row.id} type="button" className="supplier-option" aria-current={!creating && row.id === selected ? "true" : undefined} disabled={navigationBusy} onClick={() => navigate(() => choose(row.id))}><span><strong>{row.name}{row.builtin && <BuiltinMark kind={row.builtin} />}</strong><small>{row.kind === "package" ? "资源包" : row.kind === "mcp" ? row.description : "技能"}{row.version ? ` · ${row.version}` : ""}</small><small>{scopeName(row.scopeId)}{row.builtin ? "" : ` · ${row.managed ? "应用安装" : "本机配置"}`}</small></span></button>)}</nav>
          {!rows.length && <div className="resources-empty"><p>{query ? "没有匹配的资源" : `此范围还没有${view === "skill" ? "技能" : "MCP"}`}</p>{query ? <button className="btn btn-ghost" onClick={() => { setQuery(""); document.querySelector<HTMLInputElement>("[aria-label='搜索资源']")?.focus(); }}>清除搜索</button> : <p>使用上方“{addLabel}”开始配置。</p>}</div>}
          <p className="resources-list-caption">{scopeId === "global" ? view === "mcp" ? "项目可单独配置同名 MCP，项目定义优先。" : "项目专用技能请切换到对应项目管理。" : "这里只列出项目定义。共享资源请切换到全局管理。"}</p>
        </aside>
        <article className="supplier-detail tools-detail">
          <div className="detail-heading"><div><h2>{creating ? addLabel : item?.name ?? (view === "skill" ? "技能" : "MCP 配置")}{!creating && item?.builtin && <BuiltinMark kind={item.builtin} />}</h2><p className="meta">{creating ? `安装到${scopeId === "global" ? "全局" : `项目「${scopeName(scopeId)}」`}` : item?.description ?? "选择左侧资源查看内容，或添加新资源。"}</p></div><span className="tag">{scopeId === "global" ? "全局" : "项目"}</span></div>
          <div className="tools-content">
            <div className="tools-feedback" aria-live="polite">
              {error && <p className="tools-error" role="alert">{error}</p>}
              {failedJob && failedJobKey !== dismissedJob && <details key={failedJobKey} className="resources-job-history">
                <summary>上次资源操作未完成（查看记录）</summary>
                <p>{failedJob.error}</p><p className="resources-job-context">这是历史记录，不代表当前操作状态，也不会阻止新的操作。</p>
                <button type="button" className="btn btn-ghost" onClick={dismissJob} aria-label="关闭上次资源操作失败提示">关闭提示</button>
              </details>}
              {jobs.some(job => job.running) ? <p role="status">{jobs.filter(job => job.running).length} 个资源任务正在处理；可以浏览和维护其他资源。</p> : notice && <p role="status">{notice}</p>}
              {!connection.connected && <p>服务未连接，编辑内容已保留；重连后请核实实际配置。</p>}
              {state.warnings.map(warning => <p key={warning}>{warning}</p>)}
            </div>
            {jobs.some(job => job.running) ? jobs.filter(job => job.running).map(job => <BackendMaintenance key={job.id} resource={job.resource ?? "resources"} activeOnly label={job.label ?? state.items.find(item => item.id === job.targetId)?.name ?? "技能与 MCP"} location={`所连接后台 · ${scopeName(job.scopeId ?? "global")}`} />) : <BackendMaintenance resource="resources" activeOnly label="技能与 MCP" location={`所连接后台 · ${scopeName(scopeId)}`} />}
            {creating ? <section className="section tools-section"><div className="section-heading"><h3>{view === "mcp" ? "连接设置" : "安装来源"}</h3></div><fieldset className="tools-fields" disabled={busy}>
              {view === "skill" && <div className="field"><label htmlFor="resource-kind">安装方式</label><Select id="resource-kind" label="安装方式" value={kind} disabled={busy} onChange={value => setKind(value as "skill" | "package")} options={[{ value: "skill", label: "本机文件 / 文件夹 / npm 技能" }, { value: "package", label: "pi 资源包" }]} /></div>}
              {view === "mcp" && <div className="field"><label htmlFor="resource-name">MCP 名称</label><input className="input" id="resource-name" value={name} maxLength={128} onChange={e => setName(e.target.value)} placeholder="例如 docs" /><p className="field-help">名称在当前作用范围内唯一；项目同名配置会覆盖全局定义。</p></div>}
              <div className="field"><label htmlFor="resource-source">{view === "mcp" ? "npm 包（可选）" : "资源来源"}</label>{view === "skill" && kind === "skill" ? <PathInput id="resource-source" value={source} onChange={changeSource} request={{ purpose: "resource", kind: "mixed", multiple: false }} onError={setError} onPickingChange={setPicking} onPick={picked => { if (!name || name === skillImportName(source, "file") || name === skillImportName(source, "folder")) setName(skillImportName(picked.path, picked.kind === "folder" ? "folder" : "file")); }} placeholder="技能文件夹或 .md 文件的绝对路径，或 npm:包名" /> : <input className="input" id="resource-source" value={source} onChange={e => changeSource(e.target.value)} placeholder={view === "mcp" ? "@scope/mcp-server@latest" : "npm:包名 或 git:仓库地址"} />}<p className="field-help">{view === "mcp" ? "已安装的命令或远程服务可留空；填写包名则独立安装依赖。" : kind === "package" ? "整个包统一管理，包内技能、扩展和提示词会一起安装。" : "文件夹须包含 SKILL.md，会连同附件完整复制；单个 .md 文件会放入独立技能目录。原始来源保留。"}</p></div>
              {localImport && <div className="field"><label htmlFor="resource-name">技能名称</label><input className="input" id="resource-name" value={name} maxLength={200} onChange={e => setName(e.target.value)} placeholder="默认使用文件夹名或文件名（不含扩展名）" /><p className="field-help">可在安装前重命名；目录名与技能名称保持一致。名称不能包含空白或文件名特殊字符。单文件如依赖脚本或附件，请改选完整文件夹。</p></div>}
              {view === "mcp" && <><div className="field"><label htmlFor="resource-bin">npm 入口名称（可选）</label><input className="input" id="resource-bin" value={bin} onChange={e => setBin(e.target.value)} placeholder="只有一个可执行入口时自动选择" /></div><div className="field"><div className="resources-field-heading"><label htmlFor="resource-config">MCP 连接配置（JSON）</label><span className="resources-templates"><button className="btn btn-ghost" type="button" onClick={() => applyTemplate("远程", '{\n  "url": "https://example.com/mcp",\n  "enabled": true\n}')}>远程模板</button><button className="btn btn-ghost" type="button" onClick={() => applyTemplate("本机已有程序", '{\n  "command": "node",\n  "args": ["/absolute/path/mcp-server.mjs"],\n  "env": {}\n}')}>本地模板</button></span></div><JsonPathInput className="input resources-json" id="resource-config" value={config} onChange={setConfig} onError={setError} onPickingChange={setPicking} placeholder={'{\n  "url": "https://example.com/mcp"\n}'} /><p className="field-help">填写单个服务器对象。本地模板需替换为已有程序的入口；需要下载依赖时填写上方 npm 包，由安装任务管理。自定义外部命令按其自身行为运行。保存不表示已连接成功。</p></div></>}
            </fieldset><p className="resources-scope-note">{scope?.path ? <>仅写入此项目配置：<LocalPath path={scope.path} /></> : "全局技能由应用管理；全局 MCP 写入共享 pi 配置。"}</p></section> : item ? <>
              <section className="section tools-section resources-content-section"><div className="section-heading"><h3>{item.kind === "mcp" ? "连接配置" : "技能内容"}</h3><button className="btn btn-ghost" disabled={busy || loading} onClick={() => navigate(() => void load(item.id))}>重新读取</button></div>
                {loading ? <p className="meta" role="status">正在读取实际内容…</p> : !detail ? <p className="meta">配置尚未加载，请重新读取。</p> : <>
                  {stale && <p className="resources-scope-note">资源目录已有变化。当前编辑内容保留，保存将核对读取时的版本；如发生冲突，请重新读取。</p>}
                  {item.kind === "mcp" ? detail.config !== undefined ? <div className="field"><label htmlFor="resource-config">MCP 连接配置（JSON）</label><JsonPathInput className="input resources-json" id="resource-config" value={config} disabled={busy} onChange={setConfig} onError={setError} onPickingChange={setPicking} /><p className="field-help">{detail.masked ? "已隐藏保存的敏感值及命令参数。保持原位置的占位文字可保留原值，填写新值则替换，删除字段则移除。" : "显示当前已保存配置。保存配置不会重新安装 npm 包。"}</p></div> : <p className="meta">{item.removable ? "连接配置已不存在，可在维护区清理遗留安装文件。" : item.note}</p> : <>
                    {detail.documents.length > 1 && <div className="field"><label htmlFor="resource-document">包内技能</label><Select id="resource-document" label="包内技能" value={String(documentIndex)} disabled={busy} onChange={value => { const index = Number(value); navigate(() => { setDocumentIndex(index); setContent(detail.documents[index].content); }); }} options={detail.documents.map((d, i) => ({ value: String(i), label: d.name }))} /></div>}
                    {doc ? <div className="field"><label htmlFor="resource-content">SKILL.md {doc.editable ? "· 可编辑" : "· 只读"}</label><textarea id="resource-content" className="input resources-json resources-guide" value={content} readOnly={!doc.editable} disabled={busy} onChange={e => setContent(e.target.value)} spellCheck={false} /><p className="tools-path"><LocalPath path={doc.path} /></p><p className="field-help">保留开头的名称和说明。技能脚本及附属文件不受正文编辑影响。</p></div> : <p className="meta">{item.removalPending ? "此资源包卸载尚未完成，可在下方核实来源与清理范围后继续清理。" : "此资源包没有可读取的技能正文，可在下方查看来源和更新整个包。"}</p>}
                  </>}
                  {detail.warnings.map(w => <p key={w} className="field-help">{w}</p>)}
                </>}
                {actions}
              </section>
              <section className="section tools-section"><div className="section-heading"><h3>来源与作用范围</h3></div><dl className="resources-facts"><div><dt>作用范围</dt><dd>{scopeId === "global" ? "全局 · 所有项目" : `项目 · ${scopeName(scopeId)}`}</dd></div>{scope?.path && <div><dt>项目目录</dt><dd><LocalPath path={scope.path} /></dd></div>}<div><dt>{item.kind === "mcp" ? "配置文件" : "文件位置"}</dt><dd><ResourceLocation value={detail?.location ?? item.source} /></dd></div>{detail?.source && <div><dt>安装来源</dt><dd><ResourceLocation value={detail.source} /></dd></div>}<div><dt>管理方式</dt><dd>{item.builtin ? <><BuiltinMark kind={item.builtin} />{`随 ${item.builtin === "rea" ? "REA" : "OpenCLI"} 安装包提供`}</> : <>{item.managed ? "应用独立安装" : item.kind === "package" ? "pi 资源包" : "本机已有资源"}{item.version && ` · ${item.version}`}</>}</dd></div></dl><p className="field-help"><PathNotice text={item.note ?? ""} /></p></section>
              {(item.kind === "skill" || item.kind === "mcp") && <section className="section tools-section"><div className="section-heading"><h3>移动{item.kind === "mcp" ? " MCP" : "技能"}</h3></div>{item.kind === "mcp" && <p className="field-help">支持全局与项目之间双向移动。要将项目 MCP 移到全局，请先在上方“作用范围”选择对应项目，再选择 MCP。</p>}{item.movable && <p className="field-help">{item.kind === "mcp" ? `${item.scopeId === "global" ? "将此全局连接移入指定项目后，其他项目不再继承此连接。" : "将此项目连接移到全局后，其他项目也可以使用；项目同名配置仍优先。"}连接配置、已安装依赖和登录状态会保留。` : `${item.scopeId === "global" ? "移入项目后，仅该项目可以使用此技能。" : "移到全局后，所有项目都可以使用此技能。"}技能正文与附属文件一并保留。`}</p>}
                {item.movable ? moveScopes.length ? <div className="resources-move"><div className="field"><label htmlFor="resource-move-scope">目标范围</label><Select id="resource-move-scope" label="目标范围" value={moveDestination!} disabled={busy} onChange={setMoveScopeId} options={moveScopes.map(s => ({ value: s.id, label: s.kind === "global" ? "全局 · 所有项目" : s.name }))} /></div><button className="btn" disabled={busy || loading || stale || !detail} onClick={() => navigate(() => { trigger.current = document.activeElement as HTMLElement; setModal({ kind: "move", item, revision: state.revision, destinationScopeId: moveDestination! }); })}>{item.scopeId === "global" ? "移动到项目" : "移动到全局"}</button></div> : <p className="field-help">请先添加并授权项目，再移动{item.kind === "mcp" ? " MCP" : "技能"}。</p> : <p className="field-help">{item.moveBlockedReason}</p>}
              </section>}
              <section className="section tools-section resources-maintenance"><div className="section-heading"><h3>资源维护</h3><p>更新安装来源与卸载单独执行。</p></div>
                {!item.removalPending && (item.kind !== "mcp" || item.managed) && <details><summary>更新{item.kind === "package" ? "整个资源包" : "安装来源"}</summary><fieldset className="tools-fields" disabled={busy || !item.removable}>{item.kind !== "package" && <div className="field"><label htmlFor="resource-update-source">新版来源</label>{item.kind === "skill" ? <PathInput id="resource-update-source" value={source} onChange={setSource} request={item.managed ? { purpose: "resource", kind: "mixed", multiple: false } : { purpose: "path", kind: "folder", multiple: false }} onError={setError} onPickingChange={setPicking} placeholder={detail?.source ?? "另一份包含 SKILL.md 的新版目录"} /> : <input id="resource-update-source" className="input" value={source} onChange={e => setSource(e.target.value)} placeholder={detail?.source ?? "npm:包名@版本"} />}<p className="field-help">应用安装的资源留空沿用原来源。外部技能需提供新版目录；固定包版本不会自动跳到 latest。</p></div>}<button className="btn" onClick={() => navigate(() => void act("resources.update", { id: item.id, ...(source.trim() ? { source: source.trim() } : {}) }))}>更新{item.kind === "package" ? "资源包" : "安装"}</button></fieldset></details>}
                <div className="resources-remove"><div><strong>{item.removalPending ? "清理卸载残留" : `卸载${item.kind === "mcp" && !item.managed ? "连接" : "资源"}`}</strong><p className="field-help">只处理此作用范围。确认前会列出实际清理路径与保留内容。</p></div><button className="btn resources-danger" disabled={busy || !item.removable} onClick={() => navigate(() => { trigger.current = document.activeElement as HTMLElement; setModal({ kind: "remove", item, revision: state.revision }); })}>{item.removalPending ? "继续清理" : `卸载${item.kind === "mcp" && !item.managed ? "连接" : "资源"}`}</button></div>{!item.removable && <p className="field-help">{item.note}</p>}
              </section>
            </> : <div className="resources-welcome"><h3>{query ? "没有匹配的资源" : `管理${scopeId === "global" ? "全局" : "项目"}${view === "skill" ? "技能" : " MCP"}`}</h3><p>选择一个资源，查看实际内容、来源与维护选项。</p><button className="btn btn-primary" disabled={navigationBusy} onClick={() => choose()}>{addLabel}</button></div>}
            {(creating || !item) && actions}
          </div>
        </article>
      </div>
    </main>
    <dialog ref={dialog} className="resources-dialog" aria-labelledby="resource-dialog-title" onCancel={() => setModal(undefined)} onClose={() => setModal(undefined)}>
      <h2 id="resource-dialog-title">{modal?.kind === "remove" ? `${modal.item.removalPending ? "继续清理" : "卸载"} ${modal.item.name}？` : modal?.kind === "move" ? `移动 ${modal.item.name}？` : modal?.kind === "template" ? `使用${modal.template}配置模板？` : "放弃未保存的修改？"}</h2>
      {modal?.kind === "remove" ? <><p>作用范围：{scopeName(modal.item.scopeId)}。将执行以下清理：</p><ul>{modal.item.cleanup.map((line, i) => <li key={i}><PathNotice text={line} /></li>)}</ul><p>{modal.item.note}</p><p>历史会话内容保留。确认后立即按上述范围清理；已有会话中的旧技能目录或连接可通过重载更新。</p>{modal.item.kind === "mcp" && <label><input type="checkbox" checked={!!modal.clearCredentials} onChange={event => setModal({ ...modal, clearCredentials: event.target.checked })} /> 同时清理此 MCP 的登录凭据（默认保留）</label>}</> : modal?.kind === "move" ? <><p>将{modal.item.kind === "mcp" ? " MCP" : "技能"}从「{scopeName(modal.item.scopeId)}」移动到「{scopeName(modal.destinationScopeId)}」。</p>{modal.item.kind === "mcp" ? <p>{modal.destinationScopeId === "global" ? "其他项目也可以使用此连接；项目同名配置仍优先。" : "其他项目不再继承此全局连接，各项目独立配置的连接保留。"}连接配置、已安装依赖和登录状态会保留，目标范围存在同名 MCP 时会停止移动。</p> : <p>{modal.destinationScopeId === "global" ? "所有项目都可以使用此技能。" : "移动后仅目标项目可以使用此技能，其他项目将无法继续加载。"}正文与附属文件会保留，目标范围存在同名技能时会停止移动。</p>}<p>已有会话可在操作完成后重载资源。</p></> : <p>{modal?.kind === "template" ? "当前 MCP 连接配置将被模板替换，其他输入保留。" : "当前编辑尚未保存。继续操作将放弃这些修改。"}</p>}
      <div className="resources-dialog-actions"><button className="btn" autoFocus onClick={() => setModal(undefined)}>{modal?.kind === "remove" || modal?.kind === "move" ? "取消" : "继续编辑"}</button><button className="btn resources-danger" disabled={busy} onClick={() => { const action = modal; setModal(undefined); if (action?.kind === "remove") void act("resources.remove", { id: action.item.id, confirm: true, revision: action.revision, clearCredentials: action.clearCredentials === true }); else if (action?.kind === "move") void act("resources.move", { id: action.item.id, destinationScopeId: action.destinationScopeId, revision: action.revision }); else action?.run(); }}>{modal?.kind === "remove" ? modal.item.removalPending ? "确认清理" : "确认卸载" : modal?.kind === "move" ? "确认移动" : modal?.kind === "template" ? "替换配置" : "放弃修改"}</button></div>
    </dialog>
  </div>;
}
