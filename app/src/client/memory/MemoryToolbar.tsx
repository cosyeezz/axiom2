import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icon.js";
import { ContextMemoryIcon } from "../DataIcons.js";
import { BubbleLoadingIcon } from "../StatusIcons.js";
import { MetricDetail } from "../chat/MetricDetail.js";
import { useSettingsPopover } from "../useSettingsPopover.js";
import type { ContextMemoryInfo, UsageTools } from "../chat/Usage.js";
import { command, useScope } from "../transport.js";
import type { Scope, Workspace } from "../../shared/protocol.js";
import { emptyMemoryView, memoryScope, memoryCatalogScope, memoryBudgetLimits, type MemoryPreferences as Preferences, type MemoryView, type MemoryCatalogEntry, type MemoryReason } from "../../shared/memory.js";
import { ModelPicker } from "../chat/ModelPicker.js";
import { MemoryDocumentView } from "./MemoryDocumentView.js";
import { MemoryFilter } from "./MemoryFilter.js";
import { MemoryOrganizeControl } from "./MemoryOrganizeControl.js";
import { publicMemoryError } from "./memory-errors.js";
import "../styles/memory.css";
function BudgetInput({ label, value, min, max, save }: { label: string; value: number; min: number; max: number; save: (value: number) => Promise<void> }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <label>{label}<input type="number" min={min} max={max} step={1} required value={draft}
    onChange={(event) => setDraft(event.target.value)}
    onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur(); } }}
    onBlur={(event) => { if (event.currentTarget.reportValidity() && Number(draft) !== value) void save(Number(draft)).catch(() => {}); }} /></label>;
}

function MemoryIcon({ name }: { name: "tasks" | "book" | "search" | "settings" | "chevron" | "back" | "close" | "file" }) {
  const names = { tasks: "list-checks", book: "book-open", search: "search", settings: "settings-2", chevron: "chevron-right", back: "arrow-left", close: "close", file: "file-text" };
  return <Icon name={names[name]} />;
}
function memoryReasonText(reason?: MemoryReason) {
  switch (reason) {
    case "missing": return "暂无记忆";
    case "unavailable": return "记忆暂不可用";
    case "correction_pending": return "记忆正在等待纠正完成";
    case "timeout": return "读取记忆超时";
    case "revision_conflict": return "资料已更新，请重新读取";
    case "read_failed": return "无法读取记忆";
    default: return "";
  }
}

function useMemory(scope: Scope) {
  const snapshot = useScope<MemoryView | null>(memoryScope(scope), null);
  const view = snapshot?.error ? { ...emptyMemoryView(scope), reason: snapshot.reason ?? "unavailable" } : snapshot;
  return { view };
}
function Todo({ scope, openMemory, context }: { scope: Scope; openMemory: (trigger: HTMLButtonElement) => void; context: ContextMemoryInfo }) {
  const { view } = useMemory(scope), [expanded, setExpanded] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const detailsId = useId();
  const progress = view?.progress;
  const recorded = (text?: string) => !!text && text !== "尚未记录";
  const hasProgress = !view?.reason && !!progress && (recorded(progress.goal) || recorded(progress.state) || progress.tasks.length > 0);
  const percent = hasProgress && progress?.progressState === "valid" ? progress.percent : null;
  const estimate = percent == null ? "进度待评估" : `${percent < 100 ? "约 " : ""}${percent}%`;
  const inProgress = progress?.state === "进行中";
  const availability = memoryReasonText(view?.reason);
  const status = !view ? "读取中…" : availability || (!hasProgress ? "暂无记录" : progress?.progressState === "conflict" ? "进度待核对" : estimate);
  return <section className="memory-todo" aria-label="本会话任务进度">
    <button ref={toggle} className="memory-todo-toggle context-memory-control action-icon" aria-label="上下文与会话记忆" data-od-id="context-capacity" data-tooltip={`${context.label}；任务进度 · ${status}`} aria-expanded={expanded} aria-controls={expanded ? detailsId : undefined} onClick={() => setExpanded(!expanded)}>
      <ContextMemoryIcon percent={context.percent} taskPercent={percent} label={`${context.label}；任务进度 · ${status}`} />
    </button>
    {expanded && <MetricDetail trigger={toggle.current!} title="上下文与会话记忆" subtitle="当前会话 · 上下文容量与任务进展" className="memory-todo-body" onClose={() => setExpanded(false)} footer={<button className="memory-text-button" onClick={() => { setExpanded(false); toggle.current?.focus(); openMemory(toggle.current!); }}><MemoryIcon name="book" />查看完整记忆<MemoryIcon name="chevron" /></button>}>
      <div id={detailsId} className="memory-context-detail">{context.detail}</div>
      {!view ? <p className="memory-empty-copy memory-loading" role="status"><BubbleLoadingIcon />正在读取记忆…</p> : !hasProgress ? <div className="memory-todo-empty"><MemoryIcon name="tasks" /><strong>{memoryReasonText(view.reason) || "还没有任务记录"}</strong><p>{view.reason ? "主任务可继续执行；可稍后重新读取。" : "记录任务后，在这里查看进展与下一步。"}</p></div> : <>
        {recorded(progress?.goal) && <h3>{progress?.goal}</h3>}
        <div className="memory-progress-summary"><span>{inProgress && <BubbleLoadingIcon />}{progress?.state}</span><span>{status}</span></div>
        {percent != null && <><progress value={percent} max={100} aria-label="任务整体进度" /><p className="meta">整体进度为模型估计，与下方已完成事项数量分别统计。</p></>}
        {progress?.tasks.length ? <><p className="memory-task-count">已完成 {progress.tasks.filter((t) => t.state === "已完成").length} / {progress.tasks.length} 项</p><ul>{progress.tasks.map((t, i) => <li key={i} data-state={t.state}><span className="memory-task-marker" aria-hidden="true">{t.state === "已完成" ? <Icon name="check" /> : t.state === "进行中" ? <BubbleLoadingIcon /> : null}</span><span className="memory-task-title">{t.title}</span><span className="memory-task-state">{t.state}</span></li>)}</ul></> : <p className="memory-task-empty">尚未记录任务清单</p>}
        <dl className="memory-next">{recorded(progress?.current) && <><dt>当前进展</dt><dd>{progress?.current}</dd></>}{recorded(progress?.next) && <><dt>下一步</dt><dd>{progress?.next}</dd></>}</dl>
        {progress?.overLimit && <p className="meta" role="status">入口超过 2,000 字，请将详情移入分类资料。</p>}
      </>}
    </MetricDetail>}
  </section>;
}
function Detail({ scope, path, navigate, dirty, dirtyChange, onReady }: { scope: Scope; path: string; navigate: (path: string) => void; dirty: boolean; dirtyChange: (dirty: boolean) => void; onReady: () => void }) {
  const { view } = useMemory(scope);
  const related = view?.files.filter((file) => file.path !== "MEMORY.md") ?? [];
  return <>
    {view?.deleted && <p className="meta">来源会话已从普通列表移除，记忆仍保留。</p>}
    <details className="memory-related" hidden={path !== "MEMORY.md"}>
      <summary>关联文件 <span>{related.length}</span></summary>
      {related.length ? ["references", "scripts", "artifacts"].map((category) => {
        const files = related.filter((file) => file.path.startsWith(`${category}/`));
        return files.length ? <nav key={category} aria-label={category}><h3>{{ references: "详细资料", scripts: "脚本 · 只读查看", artifacts: "产物" }[category]}</h3>{files.map((file) => <button disabled={dirty} key={file.path} onClick={() => navigate(file.path)}><MemoryIcon name="file" />{file.path}<MemoryIcon name="chevron" /></button>)}</nav> : null;
      }) : <p className="meta">尚未添加详细资料、脚本或产物。</p>}
    </details>
    <MemoryDocumentView key={`${scope.sessionId}:${path}`} scope={scope} path={path} changed={view?.revision ?? ""} navigate={navigate} dirtyChange={dirtyChange} onReady={onReady} />
  </>;
}
function Summary({ entry, open }: { entry: MemoryCatalogEntry; open: (entry: MemoryCatalogEntry) => void }) {
  const sourceTitle = entry.sourceTitle ?? entry.title;
  return <details className="memory-catalog-item">
    <summary className="memory-summary-toggle"><span className="memory-source-icon"><MemoryIcon name="book" /></span><span className="memory-source-copy">
      <strong>{entry.title}</strong><span className="memory-source-summary">{entry.summary}</span>
      <span className="memory-source-meta"><span>关联记忆 1</span><span data-tooltip="MEMORY.md 字符数，含标点及空白">入口 {entry.entryChars == null ? "—" : entry.entryChars.toLocaleString("zh-CN")} 字</span>{entry.deleted && <span>来源会话已移除</span>}<time>{new Date(entry.indexedAt ?? entry.updatedAt).toLocaleDateString()}</time></span>
    </span><MemoryIcon name="chevron" /></summary>
    <div className="memory-summary-sources"><p>关联记忆</p><button type="button" className="memory-summary-source" aria-label={`查看关联记忆：${sourceTitle}`} onClick={() => open(entry)}>
      <MemoryIcon name="file" /><span><strong>{sourceTitle}</strong><span>查看会话记忆与引用资料</span></span><MemoryIcon name="chevron" />
    </button></div>
  </details>;
}
function Global({ workspaceId, workspaces, select, open }: { workspaceId: string; workspaces: Workspace[]; select: (id: string) => void; open: (scope: MemoryCatalogEntry) => void }) {
  const snapshot = useScope<MemoryCatalogEntry[] | null>(memoryCatalogScope(workspaceId), null);
  const [entries, setEntries] = useState<MemoryCatalogEntry[] | null>(null), [query, setQuery] = useState(""), [session, setSession] = useState("");
  const [error, setError] = useState(""), [preferences, setPreferences] = useState<Preferences | null>(null), [settings, setSettings] = useState(false), [correction, setCorrection] = useState("");
  const [busy, setBusy] = useState(false), [retry, setRetry] = useState(0), mounted = useRef(true), version = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (snapshot) { version.current++; setEntries(snapshot); setError(""); } }, [snapshot]);
  useEffect(() => { if (!retry) return; let live = true; const id = ++version.current; setError("");
    command<MemoryCatalogEntry[]>("memory.catalog", {}, { workspaceId }).then((value) => { if (live && id === version.current) setEntries(value); }).catch(() => { if (live && id === version.current) setEntries([]); });
    return () => { live = false; };
  }, [workspaceId, retry]);
  useEffect(() => {
    if (!settings) return;
    let live = true;
    command<Preferences>("memory.preferences", {}, { workspaceId }).then((value) => { if (live) setPreferences(value); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [workspaceId, settings, retry]);
  const configure = async (patch: Record<string, unknown>) => {
    if (busy) return; setBusy(true); setError("");
    try { const next = await command<Preferences>("memory.configure", patch, { workspaceId }); if (mounted.current) setPreferences(next); }
    catch (e) { if (mounted.current) setError((e as Error).message); throw e; }
    finally { if (mounted.current) setBusy(false); }
  };
  const correct = async () => {
    setBusy(true); setError(""); const submitted = correction;
    try { await command("memory.correct", { target: submitted, confirmed: true }, { workspaceId }); if (mounted.current) setCorrection((current) => current === submitted ? "" : current); }
    catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { if (mounted.current) setBusy(false); }
  };
  // Keep the full catalog for background indexing; this browser only presents usable summaries.
  const organized = (entries ?? []).filter((entry) => entry.status === "ready" && entry.summary.trim() && !entry.error && !entry.reason);
  useEffect(() => { if (entries && session && !organized.some((entry) => entry.sessionId === session)) setSession(""); }, [entries, session]);
  const filtered = organized.filter((e) => (!session || e.sessionId === session) && `${e.title} ${e.sourceTitle ?? ""} ${e.summary} ${e.keywords.join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  const failures = (entries ?? []).filter((entry) => entry.status === "error" || !!entry.error || !!entry.reason).map((entry) => ({ entry,
    detail: publicMemoryError(entry.error?.trim() || memoryReasonText(entry.reason) || "整理失败") }));
  const visibleFailures = failures.filter(({ entry, detail }) => (!session || entry.sessionId === session) && `${entry.sourceTitle ?? entry.title} ${entry.title} ${detail}`.toLowerCase().includes(query.toLowerCase()));
  const catalogStates = (entries ?? []).reduce((counts, entry) => {
    // 具体错误优先于流程状态，避免异常来源被误计为“待整理”或“整理中”。
    if (entry.status === "error" || entry.error || entry.reason) counts.error++;
    else if (entry.status === "pending") counts.pending++;
    else if (entry.status === "indexing") counts.indexing++;
    return counts;
  }, { pending: 0, indexing: 0, error: 0 });
  const catalogStatus = [[catalogStates.pending, "待整理"], [catalogStates.indexing, "整理中"], [catalogStates.error, "出错"]]
    .filter(([count]) => Number(count) > 0).map(([count, label]) => `${label} ${count}`).join(" · ");
  return <>
    <div className="memory-search"><MemoryIcon name="search" /><input aria-label="搜索记忆" placeholder="搜索主题、摘要或关键词" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
    <div className="memory-filters"><MemoryFilter label="记忆工作空间" value={workspaceId} onChange={select} options={workspaces.map((w) => ({ value: w.id, label: w.name }))} />
      <MemoryFilter label="来源会话" value={session} onChange={setSession} options={[{ value: "", label: "全部来源会话" }, ...organized.map((entry) => ({ value: entry.sessionId, label: entry.sourceTitle ?? entry.title }))]} /></div>
    {error && <p role="alert">{error} <button className="btn" onClick={() => setRetry((n) => n + 1)}>重试</button></p>}
    <div className="memory-list-heading"><span>已整理摘要{entries && <span className="memory-count">{filtered.length}</span>}{catalogStatus && <small role="status">{catalogStatus}</small>}</span><button className="memory-icon-button" aria-label="记忆设置与纠正" data-tooltip="记忆设置与纠正" aria-expanded={settings} onClick={() => setSettings(!settings)}><MemoryIcon name="settings" /></button></div>
    <MemoryOrganizeControl key={workspaceId} scope={{ workspaceId }} label="整理工作空间" />
    {!!visibleFailures.length && <section className="memory-catalog-errors" aria-label="整理错误详情"><h3>整理出错</h3><ul>{visibleFailures.map(({ entry, detail }) => <li key={entry.id}><strong>{entry.sourceTitle ?? entry.title}</strong><span>{detail}</span></li>)}</ul></section>}
    {settings && !preferences && !error && <p className="memory-loading" role="status"><BubbleLoadingIcon />正在读取记忆设置…</p>}
    {settings && preferences && <fieldset className="memory-settings" disabled={busy} aria-busy={busy}>{busy && <p className="memory-loading" role="status"><BubbleLoadingIcon />正在处理…</p>}<h3>查询模型</h3><ModelPicker value={preferences.queryModel} inheritLabel="使用来源会话模型" disabled={busy} onDefaultSelect={(queryModel) => configure({ queryModel })} /><h3>后台整理模型</h3><ModelPicker value={preferences.organizerModel} inheritLabel="使用来源会话模型" disabled={busy} onDefaultSelect={(organizerModel) => configure({ organizerModel })} />
      <p className="meta">未单独选择时使用来源会话模型。浏览资料不调用模型；手动和后台定时整理会产生实际用量。</p>
      <BudgetInput label="整理间隔（秒）" value={preferences.intervalMs / 1000} min={1} max={86400} save={(value) => configure({ intervalMs: value * 1000 })} />
      <h3>执行预算</h3>
      <BudgetInput label="执行时限（秒）" value={preferences.timeoutMs / 1000} min={memoryBudgetLimits.timeoutMs.min / 1000} max={memoryBudgetLimits.timeoutMs.max / 1000} save={(value) => configure({ timeoutMs: value * 1000 })} />
      <BudgetInput label="读取上限（字符）" value={preferences.readChars} min={memoryBudgetLimits.readChars.min} max={memoryBudgetLimits.readChars.max} save={(readChars) => configure({ readChars })} />
      <BudgetInput label="模型交互轮数" value={preferences.maxTurns} min={memoryBudgetLimits.maxTurns.min} max={memoryBudgetLimits.maxTurns.max} save={(maxTurns) => configure({ maxTurns })} />
      <p className="meta">按 Enter 或离开输入框自动保存，无需重启；从下一次查询或整理执行生效，进行中的执行保持原预算。时限包含排队，每轮为一次模型交互；提高预算可能增加耗时和用量。失败来源会在后续整理周期重试。</p>
      <label>明确不再保留的条目原文<textarea value={correction} onChange={(e) => setCorrection(e.target.value)} /></label><p className="meta">仅清理当前工作空间中与原文完全匹配的记忆内容及摘要，保留原始对话。</p><button className="btn" disabled={busy || !correction.trim()} onClick={() => void correct()}>删除此条记忆及重复内容</button>
    </fieldset>}
    <div className="memory-catalog">{filtered.map((entry) => <Summary key={entry.id} entry={entry} open={open} />)}{!entries ? !error && <p className="memory-empty-copy memory-loading" role="status"><BubbleLoadingIcon />正在读取记忆目录…</p> : !organized.length ? <div className="memory-catalog-empty"><MemoryIcon name="book" /><strong>暂无已整理的摘要</strong><p>{catalogStatus ? `${catalogStatus}；完成后会显示可用摘要。` : "整理完成后，会话摘要会显示在这里。"}</p></div> : !filtered.length ? <div className="memory-catalog-empty"><MemoryIcon name="search" /><strong>没有符合筛选条件的摘要</strong><button className="memory-text-button" onClick={() => { setQuery(""); setSession(""); }}>清除筛选</button></div> : null}</div>
  </>;
}
type MemoryLocation = { scope: Scope; path: string; title?: string };
type MemoryOpening = { scope: Scope | null; trigger: HTMLButtonElement };
export function MemoryToolbar({ scope, workspaces, children, navigationGuard }: { scope: Scope | null; workspaces: Workspace[]; children: (tools: UsageTools) => ReactNode; navigationGuard?: { current: (action: () => void) => void } }) {
  const [opened, setOpened] = useState<MemoryOpening | null>(null);
  const guarded = useRef<(action: () => void) => void>((action) => action());
  useLayoutEffect(() => {
    if (!navigationGuard) return;
    navigationGuard.current = (action) => opened ? guarded.current(action) : action();
    return () => { navigationGuard.current = (action) => action(); };
  }, [navigationGuard, opened]);
  const open = (value: Scope | null, trigger: HTMLButtonElement) => {
    const next = opened?.scope === value ? null : { scope: value, trigger };
    if (opened) guarded.current(() => setOpened(next)); else setOpened(next);
  };
  return <>
    {children({
      session: (context) => scope?.sessionId ? <Todo key={scope.sessionId} scope={scope} context={context} openMemory={(trigger) => open(scope, trigger)} /> : <button className="memory-todo-toggle context-memory-control action-icon" aria-label="上下文与会话记忆" data-od-id="context-capacity" data-tooltip="创建会话后查看上下文与记忆" disabled><ContextMemoryIcon percent={context.percent} /></button>,
      global: <button className="memory-global action-icon" aria-label="全局记忆" data-tooltip="全局记忆" aria-expanded={!!opened && !opened.scope} aria-haspopup="dialog" disabled={!workspaces.length} onClick={(event) => open(null, event.currentTarget)}><MemoryIcon name="book" /></button>,
    })}
    {opened && <MemoryPanel key={`${opened.scope?.sessionId ?? "global"}`} opening={opened} workspace={scope?.workspaceId} workspaces={workspaces} guarded={guarded} onClose={() => setOpened(null)} />}
  </>;
}
function MemoryPanel({ opening, workspace, workspaces, guarded, onClose }: { opening: MemoryOpening; workspace?: string; workspaces: Workspace[]; guarded: { current: (action: () => void) => void }; onClose: () => void }) {
  const { panel, close, host } = useSettingsPopover(opening.trigger, onClose);
  const [history, setHistory] = useState<MemoryLocation[]>(opening.scope ? [{ scope: opening.scope, path: "MEMORY.md" }] : []);
  const [workspaceId, setWorkspaceId] = useState(opening.scope?.workspaceId || workspace || workspaces[0]?.id || "");
  const [dirty, setDirty] = useState(false), [pending, setPending] = useState<(() => void) | null>(null);
  const body = useRef<HTMLDivElement>(null), positions = useRef(new Map<string, number>());
  const previousWorkspace = useRef(workspaceId);
  useLayoutEffect(() => {
    if (previousWorkspace.current !== workspaceId) {
      previousWorkspace.current = workspaceId;
      panel.current?.querySelector<HTMLButtonElement>('[aria-label="记忆工作空间"]')?.focus({ preventScroll: true });
    }
  }, [workspaceId, panel]);
  const target = history.at(-1), key = target ? `${target.scope.sessionId}:${target.path}` : "catalog";
  // Retain filters and scroll after the first visit, without loading a hidden catalog on entry.
  const [catalogVisited, setCatalogVisited] = useState(!opening.scope);
  useEffect(() => { if (!target) setCatalogVisited(true); }, [target]);
  const ask = (action: () => void) => { if (dirty) setPending(() => action); else action(); };
  guarded.current = ask;
  const dismiss = useRef(() => {}); dismiss.current = () => ask(onClose);
  const navigate = (next: MemoryLocation[]) => ask(() => {
    positions.current.set(key, body.current?.scrollTop ?? 0);
    setHistory(next);
  });
  const back = () => history.length ? navigate(history.slice(0, -1)) : ask(onClose);
  useLayoutEffect(() => { if (body.current) body.current.scrollTop = positions.current.get(key) ?? 0; }, [key]);
  useEffect(() => {
    let outsideStart = false;
    const outside = (target: EventTarget | null) => target instanceof Node && !panel.current?.contains(target) && !opening.trigger.contains(target);
    const down = (event: PointerEvent) => { outsideStart = event.button === 0 && outside(event.target); };
    const up = (event: PointerEvent) => {
      // Navigation owns its pending action, including the pointer double-click window.
      // Asking to close here first would let a fast confirmation cancel the queued navigation.
      const navigating = event.target instanceof Element && event.target.closest("[data-view-navigation]");
      if (outsideStart && outside(event.target) && !navigating) dismiss.current();
      outsideStart = false;
    };
    const toolbarClick = (event: MouseEvent) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".usage button") : null;
      if (!dirty || !button || !outside(button) || button.disabled) return;
      // A manual popover must guard the switch before an auto detail can cover its confirmation.
      event.preventDefault(); event.stopImmediatePropagation();
      setPending(() => () => {
        onClose();
        requestAnimationFrame(() => { if (button.isConnected) { button.focus({ preventScroll: true }); button.click(); } });
      });
    };
    const cancel = () => { outsideStart = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); dismiss.current(); } };
    document.addEventListener("pointerdown", down, true); document.addEventListener("pointerup", up, true); document.addEventListener("pointercancel", cancel, true);
    document.addEventListener("click", toolbarClick, true); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("pointerup", up, true); document.removeEventListener("pointercancel", cancel, true); document.removeEventListener("click", toolbarClick, true); document.removeEventListener("keydown", escape); };
  }, [opening.trigger, panel, dirty, onClose]);
  return createPortal(<dialog ref={panel} open popover="manual" className="compression-page memory-dialog" aria-labelledby="memory-heading" onCancel={(event) => { event.preventDefault(); ask(onClose); }}>
    <header><div className="memory-panel-title"><MemoryIcon name="book" /><div><h2 id="memory-heading">{target ? "会话记忆" : "全局记忆"}</h2><p>{target ? target.title ?? "当前会话" : "已整理的会话摘要与关联资料"}</p></div></div><button ref={close} className="icon-btn" aria-label="关闭记忆" data-tooltip="返回会话（Esc）" onClick={() => ask(onClose)}><MemoryIcon name="close" /></button></header>
    {pending && <div className="memory-unsaved" role="alert">尚有未保存编辑。<button className="btn" onClick={() => setPending(null)}>继续编辑</button><button className="btn" onClick={() => { const action = pending; setDirty(false); setPending(null); action(); }}>放弃编辑并继续</button></div>}
    <div ref={body} className="compression-body memory-dialog-body">
      <div hidden={!!target}>{(catalogVisited || !target) && (workspaceId ? <Global key={workspaceId} workspaceId={workspaceId} workspaces={workspaces} select={setWorkspaceId} open={(scope) => navigate([{ scope, path: "MEMORY.md", title: scope.sourceTitle ?? scope.title }])} /> : <p>暂无工作空间</p>)}</div>
      {target && <Detail key={target.scope.sessionId} scope={target.scope} path={target.path} dirty={dirty} dirtyChange={setDirty} onReady={() => { if (body.current) body.current.scrollTop = positions.current.get(key) ?? 0; }} navigate={(path) => { if (path !== target.path) navigate([...history, { scope: target.scope, path, title: target.title }]); }} />}
    </div>
    <footer className="memory-navigation"><button type="button" className="btn btn-ghost memory-return" onClick={back}><MemoryIcon name="back" />{history.length > 1 ? "返回上一级" : history.length ? "返回全局记忆" : "返回会话"}</button><small>{target ? history.length > 1 ? "会话记忆 / 关联文件" : "全局记忆 / 会话记忆" : "仅显示已整理摘要"}</small></footer>
  </dialog>, host);
}
