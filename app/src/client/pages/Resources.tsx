import { useEffect, useRef, useState } from "react";
import { SettingsSidebar } from "../components.js";
import { Select } from "../Select.js";
import { SettingsHeader } from "../settings/SettingsHeader.js";
import { command, useConnectionState, useScope } from "../transport.js";
import type { ResourceDetail, ResourceItem, ResourceState } from "../../shared/resources.js";
import "../styles/settings.css";
import "../styles/builtin-tools.css";
import "../styles/resources.css";
const empty: ResourceState = { revision: "", items: [], scopes: [], warnings: [] };
type View = "skill" | "mcp";
export default function Resources() {
  const state = useScope("resources", empty), connection = useConnectionState();
  const [view, setView] = useState<View>("skill"), [scopeId, setScopeId] = useState("global");
  const [selected, setSelected] = useState<string>(), [creating, setCreating] = useState(false), [query, setQuery] = useState("");
  const [kind, setKind] = useState<"skill" | "package">("skill");
  const [name, setName] = useState(""), [source, setSource] = useState(""), [config, setConfig] = useState(""), [bin, setBin] = useState("");
  const [detail, setDetail] = useState<ResourceDetail>(), [documentIndex, setDocumentIndex] = useState(0), [content, setContent] = useState("");
  const [loading, setLoading] = useState(false), [sending, setSending] = useState(false), [error, setError] = useState("");
  const [operation, setOperation] = useState<{ id: string; op: string; target?: string; before: string[] }>();
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState<{ kind: "remove"; item: ResourceItem; revision: string } | { kind: "discard"; run: () => void }>();
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLElement | null>(null), request = useRef(0);
  const item = state.items.find(row => row.id === selected);
  const scope = state.scopes.find(row => row.id === scopeId);
  const scopeName = (id: string) => state.scopes.find(s => s.id === id)?.name ?? "未知范围";
  const group = state.items.filter(row => row.scopeId === scopeId && (view === "mcp" ? row.kind === "mcp" : row.kind !== "mcp"));
  const rows = group.filter(row => `${row.name} ${row.description} ${row.source}`.toLowerCase().includes(query.toLowerCase()));
  const busy = sending || !!state.job?.running || !connection.connected;
  const doc = detail?.documents[documentIndex];
  const dirty = creating ? !!(name || source || config || bin) : !!(detail && (config !== (detail.config ?? "") || content !== (doc?.content ?? "")));
  const stale = !!detail && detail.revision !== state.revision;
  function clear() { request.current++; setDetail(undefined); setContent(""); setConfig(""); setSource(""); setBin(""); setName(""); setDocumentIndex(0); setError(""); setNotice(""); setLoading(false); }
  function navigate(run: () => void) {
    if (busy) return;
    if (dirty) { trigger.current = document.activeElement as HTMLElement; setModal({ kind: "discard", run }); }
    else run();
  }
  function choose(id?: string) { clear(); setSelected(id); setCreating(!id); if (id && id === selected) void load(id); }
  async function load(id: string) {
    const ticket = ++request.current; setLoading(true); setError("");
    try {
      const result = await command<ResourceDetail>("resources.detail", { id });
      if (request.current !== ticket) return;
      setDetail(result); setConfig(result.config ?? ""); setDocumentIndex(0); setContent(result.documents[0]?.content ?? "");
    } catch (cause) { if (ticket === request.current) setError((cause as Error).message); }
    finally { if (ticket === request.current) setLoading(false); }
  }
  async function act(op: string, params: Record<string, unknown> = {}) {
    setSending(true); setError(""); setNotice("");
    try {
      const result = await command<ResourceState>(op, { ...(op === "resources.get" ? {} : { revision: state.revision, scopeId }), ...params });
      if (op !== "resources.get" && result.job) setOperation({ id: result.job.id, op, target: item?.id, before: state.items.map(i => i.id) });
    } catch (cause) { setError((cause as Error).message); }
    finally { setSending(false); }
  }
  useEffect(() => { if (connection.connected) void act("resources.get"); }, [connection.connected, connection.generation]);
  useEffect(() => {
    if (!dirty && !creating && !rows.some(row => row.id === selected)) {
      request.current++; setDetail(undefined); setConfig(""); setContent(""); setSelected(rows[0]?.id);
    }
  }, [state.revision, view, scopeId, query, creating]);
  useEffect(() => { if (selected && connection.connected && !dirty) void load(selected); return () => { request.current++; }; }, [selected, connection.connected]);
  useEffect(() => {
    if (!operation || state.job?.id !== operation.id || state.job.running) return;
    setOperation(undefined);
    if (state.job.error) return;
    setNotice(operation.op === "resources.save" ? "配置已保存。" : "操作已完成。");
    setSource(""); setBin("");
    if (operation.op === "resources.install") {
      setName(""); setConfig(""); setCreating(false);
      setSelected(state.items.find(row => !operation.before.includes(row.id) && row.scopeId === scopeId)?.id);
    } else if (operation.op === "resources.remove") { clear(); setSelected(undefined); }
    else if (operation.target === selected && selected) void load(selected);
  }, [state.job, operation]);
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
          {(["skill", "mcp"] as const).map(value => <button key={value} id={`resource-tab-${value}`} role="tab" aria-selected={view === value} aria-controls="resource-panel" tabIndex={view === value ? 0 : -1} className={`config-tab ${view === value ? "active" : ""}`} disabled={busy} onClick={() => changeView(value)}>{value === "skill" ? "技能" : "MCP"}<span className="num">{state.items.filter(row => row.scopeId === scopeId && (value === "mcp" ? row.kind === "mcp" : row.kind !== "mcp")).length}</span></button>)}
        </div>
        <div className="resources-scope"><label htmlFor="resource-scope">作用范围</label><Select id="resource-scope" label="作用范围" value={scopeId} disabled={busy} onChange={id => navigate(() => { clear(); setScopeId(id); setSelected(undefined); setCreating(false); setQuery(""); })} options={[{ value: "global", label: "全局 · 所有项目" }, ...state.scopes.filter(s => s.kind === "project").map(s => ({ value: s.id, label: s.name, group: "项目" }))]} /></div>
      </div>
      <div className="configuration-layout" id="resource-panel" role="tabpanel" aria-labelledby={`resource-tab-${view}`}>
        <aside className="supplier-panel" aria-label={view === "skill" ? "技能列表" : "MCP 列表"}>
          <div className="supplier-toolbar"><h2>{view === "skill" ? "技能与资源包" : "MCP 服务"}<span className="meta num"> {group.length}</span></h2><button className="btn" disabled={busy} onClick={() => navigate(() => choose())}>{addLabel}</button></div>
          <div className="resources-search"><input className="input" aria-label="搜索资源" placeholder={view === "skill" ? "搜索技能或资源包" : "搜索 MCP"} value={query} onChange={event => { const value = event.target.value; navigate(() => { clear(); setSelected(undefined); setQuery(value); }); }} /></div>
          <p className="resources-list-caption">{scopeId === "global" ? "全局资源 · 可供所有项目使用" : `项目资源 · ${scopeName(scopeId)}`}</p>
          <nav className="supplier-list">{rows.map(row => <button key={row.id} type="button" className="supplier-option" aria-current={!creating && row.id === selected ? "true" : undefined} disabled={busy} onClick={() => navigate(() => choose(row.id))}><span><strong>{row.name}</strong><small>{row.kind === "package" ? "资源包" : row.kind === "mcp" ? row.description : "技能"}{row.version ? ` · ${row.version}` : ""}</small><small>{scopeName(row.scopeId)} · {row.managed ? "应用安装" : "本机配置"}</small></span></button>)}</nav>
          {!rows.length && <div className="resources-empty"><p>{query ? "没有匹配的资源" : `此范围还没有${view === "skill" ? "技能" : "MCP"}`}</p>{query ? <button className="btn btn-ghost" onClick={() => { setQuery(""); document.querySelector<HTMLInputElement>("[aria-label='搜索资源']")?.focus(); }}>清除搜索</button> : <p>使用上方“{addLabel}”开始配置。</p>}</div>}
          <p className="resources-list-caption">{scopeId === "global" ? view === "mcp" ? "项目可单独配置同名 MCP，项目定义优先。" : "项目专用技能请切换到对应项目管理。" : "这里只列出项目定义。共享资源请切换到全局管理。"}</p>
        </aside>
        <article className="supplier-detail tools-detail">
          <div className="detail-heading"><div><h2>{creating ? addLabel : item?.name ?? (view === "skill" ? "技能" : "MCP 配置")}</h2><p className="meta">{creating ? `安装到${scopeId === "global" ? "全局" : `项目「${scopeName(scopeId)}」`}` : item?.description ?? "选择左侧资源查看内容，或添加新资源。"}</p></div><span className="tag">{scopeId === "global" ? "全局" : "项目"}</span></div>
          <div className="tools-content">
            <div className="tools-feedback" aria-live="polite">
              {(error || state.job?.error) && <p className="tools-error" role="alert">{error || state.job?.error}</p>}
              {state.job?.running ? <p role="status">正在处理资源，请稍候…</p> : notice && <p role="status">{notice}</p>}
              {!connection.connected && <p>服务未连接，编辑内容已保留；重连后请核实实际配置。</p>}
              {state.warnings.map(warning => <p key={warning}>{warning}</p>)}
            </div>
            {creating ? <section className="section tools-section"><div className="section-heading"><h3>{view === "mcp" ? "连接设置" : "安装来源"}</h3></div><fieldset className="tools-fields" disabled={busy}>
              {view === "skill" && <div className="field"><label htmlFor="resource-kind">安装方式</label><Select id="resource-kind" label="安装方式" value={kind} disabled={busy} onChange={value => setKind(value as "skill" | "package")} options={[{ value: "skill", label: "本机目录 / npm 技能" }, { value: "package", label: "pi 资源包" }]} /></div>}
              {view === "mcp" && <div className="field"><label htmlFor="resource-name">MCP 名称</label><input className="input" id="resource-name" value={name} maxLength={128} onChange={e => setName(e.target.value)} placeholder="例如 docs" /><p className="field-help">名称在当前作用范围内唯一；项目同名配置会覆盖全局定义。</p></div>}
              <div className="field"><label htmlFor="resource-source">{view === "mcp" ? "npm 包（可选）" : "资源来源"}</label><input className="input" id="resource-source" value={source} onChange={e => setSource(e.target.value)} placeholder={view === "mcp" ? "@scope/mcp-server@latest" : kind === "package" ? "npm:包名 或 git:仓库地址" : "包含 SKILL.md 的绝对目录，或 npm:包名"} /><p className="field-help">{view === "mcp" ? "已安装的命令或远程服务可留空；填写包名则独立安装依赖。" : kind === "package" ? "整个包统一管理，包内技能、扩展和提示词会一起安装。" : "完整导入技能及附属文件，原始来源保留。"}</p></div>
              {view === "mcp" && <><div className="field"><label htmlFor="resource-bin">npm 入口名称（可选）</label><input className="input" id="resource-bin" value={bin} onChange={e => setBin(e.target.value)} placeholder="只有一个可执行入口时自动选择" /></div><div className="field"><div className="resources-field-heading"><label htmlFor="resource-config">MCP 连接配置（JSON）</label><span className="resources-templates"><button className="btn btn-ghost" type="button" onClick={() => { if (!config || window.confirm("用远程配置模板替换当前输入？")) setConfig('{\n  "url": "https://example.com/mcp",\n  "enabled": true\n}'); }}>远程模板</button><button className="btn btn-ghost" type="button" onClick={() => { if (!config || window.confirm("用本地配置模板替换当前输入？")) setConfig('{\n  "command": "npx",\n  "args": ["-y", "包名"],\n  "env": {}\n}'); }}>本地模板</button></span></div><textarea className="input resources-json" id="resource-config" value={config} onChange={e => setConfig(e.target.value)} spellCheck={false} placeholder={'{\n  "url": "https://example.com/mcp"\n}'} /><p className="field-help">填写单个服务器对象。保存只登记配置，不表示已连接成功。</p></div></>}
            </fieldset><p className="resources-scope-note">{scope?.path ? <>仅写入此项目配置：<code>{scope.path}</code></> : "全局技能由应用管理；全局 MCP 写入共享 pi 配置。"}</p></section> : item ? <>
              <section className="section tools-section resources-content-section"><div className="section-heading"><h3>{item.kind === "mcp" ? "连接配置" : "技能内容"}</h3><button className="btn btn-ghost" disabled={busy || loading} onClick={() => navigate(() => void load(item.id))}>重新读取</button></div>
                {loading ? <p className="meta" role="status">正在读取实际内容…</p> : !detail ? <p className="meta">配置尚未加载，请重新读取。</p> : <>
                  {stale && <p className="resources-scope-note">资源目录已有变化。当前编辑内容保留，保存将核对读取时的版本；如发生冲突，请重新读取。</p>}
                  {item.kind === "mcp" ? detail.config !== undefined ? <div className="field"><label htmlFor="resource-config">MCP 连接配置（JSON）</label><textarea className="input resources-json" id="resource-config" value={config} disabled={busy} onChange={e => setConfig(e.target.value)} spellCheck={false} /><p className="field-help">{detail.masked ? "已隐藏保存的敏感值及命令参数。保持原位置的占位文字可保留原值，填写新值则替换，删除字段则移除。" : "显示当前已保存配置。保存配置不会重新安装 npm 包。"}</p></div> : <p className="meta">连接配置已不存在，可在维护区清理遗留安装文件。</p> : <>
                    {detail.documents.length > 1 && <div className="field"><label htmlFor="resource-document">包内技能</label><Select id="resource-document" label="包内技能" value={String(documentIndex)} disabled={busy} onChange={value => { const index = Number(value); navigate(() => { setDocumentIndex(index); setContent(detail.documents[index].content); }); }} options={detail.documents.map((d, i) => ({ value: String(i), label: d.name }))} /></div>}
                    {doc ? <div className="field"><label htmlFor="resource-content">SKILL.md {doc.editable ? "· 可编辑" : "· 只读"}</label><textarea id="resource-content" className="input resources-json resources-guide" value={content} readOnly={!doc.editable} disabled={busy} onChange={e => setContent(e.target.value)} spellCheck={false} /><p className="tools-path"><code>{doc.path}</code></p><p className="field-help">保留开头的名称和说明。技能脚本及附属文件不受正文编辑影响。</p></div> : <p className="meta">此资源包没有可读取的技能正文，可在下方查看来源和更新整个包。</p>}
                  </>}
                  {detail.warnings.map(w => <p key={w} className="field-help">{w}</p>)}
                </>}
              </section>
              <section className="section tools-section"><div className="section-heading"><h3>来源与作用范围</h3></div><dl className="resources-facts"><div><dt>作用范围</dt><dd>{scopeId === "global" ? "全局 · 所有项目" : `项目 · ${scopeName(scopeId)}`}</dd></div>{scope?.path && <div><dt>项目目录</dt><dd><code>{scope.path}</code></dd></div>}<div><dt>{item.kind === "mcp" ? "配置文件" : "文件位置"}</dt><dd><code>{detail?.location ?? item.source}</code></dd></div>{detail?.source && <div><dt>安装来源</dt><dd><code>{detail.source}</code></dd></div>}<div><dt>管理方式</dt><dd>{item.managed ? "应用独立安装" : item.kind === "package" ? "pi 资源包" : "本机已有资源"}{item.version && ` · ${item.version}`}</dd></div></dl><p className="field-help">{item.note}</p></section>
              <section className="section tools-section resources-maintenance"><div className="section-heading"><h3>资源维护</h3><p>更新安装来源与卸载单独执行。</p></div>
                {(item.kind !== "mcp" || item.managed) && <details><summary>更新{item.kind === "package" ? "整个资源包" : "安装来源"}</summary><fieldset className="tools-fields" disabled={busy || !item.removable}>{item.kind !== "package" && <div className="field"><label htmlFor="resource-update-source">新版来源</label><input id="resource-update-source" className="input" value={source} onChange={e => setSource(e.target.value)} placeholder={detail?.source ?? "另一份包含 SKILL.md 的新版目录"} /><p className="field-help">应用安装的资源留空沿用原来源。外部技能需提供新版目录；固定包版本不会自动跳到 latest。</p></div>}<button className="btn" onClick={() => navigate(() => void act("resources.update", { id: item.id, ...(source.trim() ? { source: source.trim() } : {}) }))}>更新{item.kind === "package" ? "资源包" : "安装"}</button></fieldset></details>}
                <div className="resources-remove"><div><strong>卸载{item.kind === "mcp" && !item.managed ? "连接" : "资源"}</strong><p className="field-help">只处理此作用范围。确认前会列出实际清理路径与保留内容。</p></div><button className="btn resources-danger" disabled={busy || !item.removable} onClick={() => navigate(() => { trigger.current = document.activeElement as HTMLElement; setModal({ kind: "remove", item, revision: state.revision }); })}>卸载{item.kind === "mcp" && !item.managed ? "连接" : "资源"}</button></div>{!item.removable && <p className="field-help">{item.note}</p>}
              </section>
            </> : <div className="resources-welcome"><h3>{query ? "没有匹配的资源" : `管理${scopeId === "global" ? "全局" : "项目"}${view === "skill" ? "技能" : " MCP"}`}</h3><p>选择一个资源，查看实际内容、来源与维护选项。</p><button className="btn btn-primary" disabled={busy} onClick={() => choose()}>{addLabel}</button></div>}
          </div>
          <footer className="configuration-actions"><div className="resources-save-state">{dirty ? "有未保存的修改" : detail ? "已读取实际配置" : ""}</div>{creating ? <button className="btn btn-primary" disabled={busy || !state.revision || (view === "mcp" ? !name.trim() || (!source.trim() && !config.trim()) : !source.trim())} onClick={() => void act("resources.install", { kind: view === "mcp" ? "mcp" : kind, name, ...(source.trim() ? { source: source.trim() } : {}), ...(config.trim() ? { config } : {}), ...(bin.trim() ? { bin: bin.trim() } : {}) })}>{view === "mcp" ? "保存连接" : kind === "package" ? "安装资源包" : "安装技能"}</button> : item && <button className="btn btn-primary" disabled={!canSave} onClick={() => void act("resources.save", { id: item.id, revision: detail!.revision, ...(item.kind === "mcp" ? { config } : { path: doc?.path, content }) })}>保存{item.kind === "mcp" ? "配置" : "技能内容"}</button>}<button className="btn btn-ghost" disabled={busy} onClick={() => navigate(() => { clear(); void act("resources.get").then(() => { if (selected) void load(selected); }); })}>刷新目录</button></footer>
        </article>
      </div>
    </main>
    <dialog ref={dialog} className="resources-dialog" aria-labelledby="resource-dialog-title" onCancel={() => setModal(undefined)} onClose={() => setModal(undefined)}>
      <h2 id="resource-dialog-title">{modal?.kind === "remove" ? `卸载 ${modal.item.name}？` : "放弃未保存的修改？"}</h2>
      {modal?.kind === "remove" ? <><p>作用范围：{scopeName(modal.item.scopeId)}。将执行以下清理：</p><ul>{modal.item.cleanup.map((line, i) => <li key={i}>{line}</li>)}</ul><p>{modal.item.note}</p><p>历史会话内容保留。请先结束本机或终端中使用此资源的任务。</p></> : <p>当前编辑尚未保存。继续操作将放弃这些修改。</p>}
      <div className="resources-dialog-actions"><button className="btn" autoFocus onClick={() => setModal(undefined)}>{modal?.kind === "remove" ? "取消" : "继续编辑"}</button><button className="btn resources-danger" disabled={busy} onClick={() => { const action = modal; setModal(undefined); if (action?.kind === "remove") void act("resources.remove", { id: action.item.id, confirm: true, revision: action.revision }); else action?.run(); }}>{modal?.kind === "remove" ? "确认卸载" : "放弃修改"}</button></div>
    </dialog>
  </div>;
}
