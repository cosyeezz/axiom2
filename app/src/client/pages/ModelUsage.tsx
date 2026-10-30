import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { SettingsSidebar } from "../components.js";
import { SettingsHeader } from "../settings/SettingsHeader.js";
import { Select } from "../Select.js";
import { UsageDateRange } from "../UsageDateRange.js";
import { UsageOverview } from "../UsageOverview.js";
import { usageDateBoundary, usageRangeError, usageRangeLabel } from "../usage-dates.js";
import { amount, amountTitle, compactNumber, exact, money, percent, tokens, tokenTitle } from "../usage-format.js";
import { UsageColumns, useUsageView } from "../UsageColumns.js";
import { usageCacheHit, usageCacheHitDescription, usageColumnDescriptions, usageColumns, usageCostPart, usageInputTotal, usagePricingLabel, type UsageColumnId, type UsageView } from "../usage-fields.js";
import type { RequestDisplayCache } from "../models/ProviderRequests.js";
import { emptyUsageDraft as emptyDraft, readUsagePageState, saveUsagePageState, type UsageDraft as Draft } from "../usage-page-state.js";
import { command, scopeCurrent, useConnectionState, useScope } from "../transport.js";
import { costLabels, costParts } from "../../shared/costs.js";
import { usageProvidersScope, type UsageProvider, type UsageRecord, type UsageRecordPage, type UsageRecordFilter, type UsageSessionDirectory } from "../../shared/model-usage.js";
import { openAIProviderId } from "../../shared/model-providers.js";
import { modelDisplay } from "../../shared/model-display.js";
import "../styles/settings.css";
import "../styles/model-interactions.css";
import "../styles/model-usage.css";
let requestsView: typeof import("../models/ProviderRequests.js")["ProviderRequests"] | undefined;
let quotaView: typeof import("../models/ProviderUsage.js")["ProviderUsage"] | undefined;
const loadRequests = async () => { const module = await import("../models/ProviderRequests.js"); requestsView = module.ProviderRequests; return module; };
const loadQuota = async () => { const module = await import("../models/ProviderUsage.js"); quotaView = module.ProviderUsage; return module; };
const ProviderRequests = lazy(() => loadRequests().then(module => ({ default: module.ProviderRequests })));
const ProviderUsage = lazy(() => loadQuota().then(module => ({ default: module.ProviderUsage })));
const prefetchTab = (id: string) => { if (id === "requests") void loadRequests().catch(() => {}); else if (id === "official") void loadQuota().catch(() => {}); };
const emptyInvalidation = { revision: 0 };
type Entry = Omit<UsageProvider, "id"> & { id: string | null };

function OfficialUsage({ provider }: { provider: Entry }) {
  const QuotaPanel = quotaView ?? ProviderUsage;
  const windowReference = provider.id === openAIProviderId || provider.id === "openai"
    ? { providerId: provider.id, label: provider.name, metricIds: ["primary_window", "secondary_window"] } : undefined;
  return <section className="usage-section usage-official" aria-labelledby="upstream-usage-heading">
    <header className="usage-section-heading"><div><h2 id="upstream-usage-heading">{provider.name} · 官方用量</h2><p role="status">{provider.configured ? "沿用模型服务认证与代理" : "未关联模型服务认证"}</p></div></header>
    {provider.query === "shared" && provider.id
      ? <QuotaPanel key={`${provider.id}:${provider.revision}`} providerId={provider.id} revision={provider.revision} windowReference={windowReference} />
      : <p className="usage-method">{provider.configured ? "暂不支持此连接的官方额度查询" : "请先在模型服务设置中连接账号。"}</p>}
    <p className="usage-method"><a href="/model-config.html">模型服务设置</a></p>
  </section>;
}

function RecordCell({ row, column, providerName, separateProvider }: { row: UsageRecord; column: UsageColumnId; providerName: (id: string | null) => string; separateProvider: boolean }) {
  const number = (value: string, title: string, className = "") => <span className={`usage-cell-number ${className}`} title={title}>{value}</span>;
  const partCost = (part: typeof costParts[number]) => { const value = usageCostPart(row, part); return number(money(value), value === undefined ? "费用分项未完整记录" : `${exact(value)} USD`); };
  switch (column) {
    case "time": {
      const date = row.timestamp === undefined ? undefined : new Date(row.timestamp);
      return date && Number.isFinite(date.getTime()) ? <time dateTime={date.toISOString()} title={date.toLocaleString("zh-CN", { hour12: false })}><span className="usage-row-name">{date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" })}</span><small>{date.toLocaleTimeString("zh-CN", { hour12: false })}</small></time> : <span>时间未知</span>;
    }
    case "context": return <><span className="usage-row-name" title={row.workspaceName}>{row.workspaceName}</span><small title={row.sessionTitle}>{row.sessionTitle}</small></>;
    case "model": return <><span className="usage-row-name" title={`模型 ID：${row.model ?? "未记录"}`}>{row.name ?? modelDisplay([], { provider: row.provider, id: row.model }).model}</span>{!separateProvider && <small title={row.provider ?? "未识别供应商"}>{providerName(row.provider)}</small>}</>;
    case "provider": return <span className="usage-row-name" title={row.provider ?? "未识别供应商"}>{providerName(row.provider)}</span>;
    case "source": return <><span className="usage-row-name" title={row.source}>{row.source}</span><small title={`${costLabels[row.category]}${row.status ? ` · ${row.status}` : ""}`}>{costLabels[row.category]}{row.status ? ` · ${row.status}` : ""}</small>{row.kind !== "call" && <small>{row.kind === "aggregate" ? `聚合账务 · ${row.records} 条` : "无法还原调用"}</small>}</>;
    case "category": return <span className="usage-row-name" title={costLabels[row.category]}>{costLabels[row.category]}</span>;
    case "kind": return <span className="usage-row-name">{row.kind === "call" ? "调用记录" : row.kind === "aggregate" ? "聚合账务" : "来源缺失"}</span>;
    case "status": return <span className="usage-row-name" title={row.status ?? "未记录来源状态"}>{row.status ?? "—"}</span>;
    case "sessionId": return <span className="usage-row-name" title={row.sessionId}>{row.sessionId}</span>;
    case "records": return number(exact(row.records), "账务条数，不等于网络请求次数");
    case "input": case "output": case "cacheRead": case "cacheWrite": return number(tokens(row, column), `${tokenTitle(row, column)}；${usageColumnDescriptions[column]}`);
    case "total": return number(tokens(row), tokenTitle(row));
    case "inputTotal": { const value = usageInputTotal(row); return number(compactNumber(value), value === undefined ? "Token 数据不完整，不能核对输入合计" : `${exact(value)} Token；普通输入＋缓存读取＋缓存写入`); }
    case "cacheHit": { const value = usageCacheHit(row); return number(percent(value), `${value === undefined ? "无法核对；" : `${exact(value)}%；`}${usageCacheHitDescription}`, "usage-cache-ratio"); }
    case "amount": return <>{number(amount(row, false), amountTitle(row), "usage-money")}{row.estimatedRecords ? <small className="usage-estimate" title={amountTitle(row)}>含估算</small> : row.unknownCost > 0 && row.knownCost > 0 ? <small>已知部分</small> : null}</>;
    case "inputCost": return partCost("input");
    case "outputCost": return partCost("output");
    case "cacheReadCost": return partCost("cacheRead");
    case "cacheWriteCost": return partCost("cacheWrite");
    case "estimatedCost": { const value = row.estimatedRecords && Number.isFinite(row.estimatedCost) ? row.estimatedCost : undefined; return number(money(value), value === undefined ? "没有可核对的公开参考价估算子集" : `${exact(value)} USD；已包含在消费金额内，非额外扣款；${row.estimateSources?.join("；") ?? ""}`); }
    case "pricing": return <span className="usage-row-name" title={amountTitle(row)}>{usagePricingLabel(row)}</span>;
  }
}
function RecordTable({ rows, providerName, view }: { rows: UsageRecord[]; providerName: (id: string | null) => string; view: UsageView }) {
  const columns = usageColumns.filter(column => view.columns.includes(column.id)), separateProvider = view.columns.includes("provider");
  return <div className="usage-table-region" role="region" aria-label="调用记录列表" tabIndex={0}>
    <table className="usage-table usage-record-table" data-density={view.density} style={{ minWidth: columns.reduce((sum, column) => sum + column.width + (view.density === "comfortable" ? 12 : 0), 0) }}>
      <colgroup>{columns.map(column => <col key={column.id} style={{ width: column.width + (view.density === "comfortable" ? 12 : 0) }} />)}</colgroup>
      <thead><tr>{columns.map(column => <th key={column.id} scope="col" data-column={column.id} className={column.text ? "usage-record-text" : "num"} title={usageColumnDescriptions[column.id]}>{column.label}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>{columns.map(column => {
        const Cell = column.id === "context" ? "th" : "td";
        return <Cell key={column.id} scope={column.id === "context" ? "row" : undefined} data-column={column.id} className={column.text ? "usage-record-text" : "num"}><RecordCell row={row} column={column.id} providerName={providerName} separateProvider={separateProvider} /></Cell>;
      })}</tr>)}</tbody>
    </table>
  </div>;
}
const tabs = [{ id: "overview", label: "用量概览" }, { id: "records", label: "调用明细" }, { id: "requests", label: "请求监控" }, { id: "official", label: "官方额度" }] as const;
type UsageTab = typeof tabs[number]["id"];
const requestTypeLabel = (type: Draft["requestType"]) => type === "main" ? "主代理" : type === "subagent" ? "子代理" : type === "compression" ? "压缩" : "不限类型";
export default function ModelUsage() {
  // An imported module is immediately renderable; don't re-suspend a fully warmed tab.
  const RequestsPanel = requestsView ?? ProviderRequests;
  const { connected, generation } = useConnectionState();
  const [view, setView] = useUsageView(), [tab, setTab] = useState<UsageTab>("overview");
  const local = tab === "overview" || tab === "records";
  const directoryInvalidation = useScope(usageProvidersScope, emptyInvalidation), directoryReady = scopeCurrent(usageProvidersScope);
  const [initial] = useState(readUsagePageState);
  const [draft, setDraft] = useState<Draft>(() => initial?.draft ?? emptyDraft()), [applied, setApplied] = useState<Draft>(() => initial?.applied ?? emptyDraft());
  const [officialProvider, setOfficialProvider] = useState(""), [requestProvider, setRequestProvider] = useState("");
  const [report, setReport] = useState<UsageRecordPage>(), [directory, setDirectory] = useState<UsageProvider[]>([]), [historical, setHistorical] = useState<(string | null)[]>([]);
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false), [error, setError] = useState(""), [filterError, setFilterError] = useState(""), [directoryError, setDirectoryError] = useState("");
  const [requested, setRequested] = useState(initial?.requested ?? false), [directoryRefresh, setDirectoryRefresh] = useState(0), [refresh, setRefresh] = useState(0);
  const [requestCache, setRequestCache] = useState<RequestDisplayCache>();
  const rememberRequests = useCallback((value: RequestDisplayCache) => setRequestCache(previous => previous?.generation === value.generation && previous.value.updatedAt > value.value.updatedAt ? previous : value), []);
  const prefetched = useRef<number | undefined>(undefined), activeTab = useRef(tab), latestRequests = useRef(requestCache);
  activeTab.current = tab; latestRequests.current = requestCache;
  const [visible, setVisible] = useState(() => document.visibilityState === "visible"), advance = useRef(false);
  useEffect(() => { const changed = () => setVisible(document.visibilityState === "visible"); document.addEventListener("visibilitychange", changed); return () => document.removeEventListener("visibilitychange", changed); }, []);
  const [page, setPage] = useState(initial?.page ?? 1), [pageSize, setPageSize] = useState(initial?.pageSize ?? 20);
  const [sessionDirectory, setSessionDirectory] = useState<{ workspace: string; value: UsageSessionDirectory }>();
  const [sessionLoading, setSessionLoading] = useState(false), [sessionError, setSessionError] = useState(""), [sessionRefresh, setSessionRefresh] = useState(0);
  const snapshot = useRef<{ workspace: string; id: string } | undefined>(initial?.snapshot), force = useRef(false);
  useEffect(() => { saveUsagePageState({ draft, applied, requested, page, pageSize, snapshot: snapshot.current }); }, [draft, applied, requested, page, pageSize, report]);
  // Historical results survive all tab switches. Only explicit inputs/reconnects query again.
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  useEffect(() => {
    if (!connected || !directoryReady) return;
    let active = true; const controller = new AbortController();
    void Promise.all([command<UsageProvider[]>("usage.providers", {}, {}, crypto.randomUUID(), controller.signal), command<{ id: string; name: string }[]>("usage.workspaces", {}, {}, crypto.randomUUID(), controller.signal)])
      .then(([providers, spaces]) => { if (active) { setDirectory(providers); setWorkspaces(spaces); setDirectoryError(""); } })
      .catch(error => { if (active) setDirectoryError(error.message); });
    return () => { active = false; controller.abort(); };
  }, [connected, generation, directoryReady, directoryInvalidation.revision, directoryRefresh]);
  useEffect(() => {
    if (!connected || !directoryReady) return;
    let active = true; const controller = new AbortController(); setSessionLoading(true); setSessionError("");
    void command<UsageSessionDirectory>("usage.sessions", { workspaceId: draft.workspace || undefined }, {}, crypto.randomUUID(), controller.signal)
      .then(value => { if (active) setSessionDirectory({ workspace: draft.workspace, value }); })
      .catch(error => { if (active) setSessionError(error.message); })
      .finally(() => { if (active) setSessionLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [connected, generation, directoryReady, draft.workspace, sessionRefresh, directoryInvalidation.revision]);
  useEffect(() => {
    if (!connected || !requested) return;
    let active = true; const controller = new AbortController(); setLoading(true); setError("");
    const explicit = force.current, continuation = advance.current; force.current = false; advance.current = false;
    const filters: UsageRecordFilter = { workspaceId: applied.workspace || undefined, providerId: applied.provider ? JSON.parse(applied.provider) as string | null : undefined,
      query: applied.query, from: usageDateBoundary(applied.from, false), to: usageDateBoundary(applied.to, true), rootSessionId: applied.session || undefined, requestType: applied.requestType || undefined };
    void command<UsageRecordPage>("usage.ledger", { ...filters, page, pageSize, analytics: true, timeZone,
      snapshot: snapshot.current?.workspace === applied.workspace ? snapshot.current.id : undefined, refresh: explicit, continue: continuation && !explicit }, {}, crypto.randomUUID(), controller.signal)
      .then(value => { if (active) {
        // A not-yet-materialized page has no confirmed generation. Keep the last
        // real snapshot, otherwise its "pending" token resets page 2 to page 1.
        if (!value.background || value.background.verifiedThrough) snapshot.current = { workspace: applied.workspace, id: value.snapshot };
        setReport(value); setHistorical(value.providers.slice(0, 1000)); setPage(value.page);
      } })
      .catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [connected, generation, requested, applied, page, pageSize, refresh, timeZone]);
  const firstScreenReady = !!sessionDirectory && (!requested || !!report && !loading);
  useEffect(() => {
    if (!connected || !visible || !firstScreenReady || prefetched.current === generation) return;
    let active = true; const controller = new AbortController();
    // Yield past first-screen rendering; warm later code sequentially, without mounting auth or polling.
    const timer = setTimeout(() => {
      prefetched.current = generation;
      void (async () => {
        await loadRequests();
        if (!active) return;
        if (activeTab.current !== "requests" && latestRequests.current?.generation !== generation) {
          try { const value = await command<RequestDisplayCache["value"]>("usage.requests", {}, {}, crypto.randomUUID(), controller.signal);
            if (active) rememberRequests({ value, generation, receivedAt: Date.now() }); } catch { /* Best-effort local prefetch. */ }
        }
        if (active) await loadQuota();
      })().catch(() => {});
    }, 200);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [connected, generation, visible, firstScreenReady]);
  useEffect(() => {
    if (!connected || !visible || !local || !requested || !report || (!report.building && !report.background) || loading || error) return;
    const delay = report.background ? report.background.state === "ready" ? 5000 : report.background.state === "error" ? 5000 : 1000 : 100;
    const timer = setTimeout(() => { advance.current = true; setRefresh(value => value + 1); }, delay);
    return () => clearTimeout(timer);
  }, [connected, visible, local, requested, report, loading, error]);
  const entries: Entry[] = directory.map(provider => ({ ...provider }));
  const selectedIds = [draft.provider, applied.provider, officialProvider, requestProvider].filter(Boolean).map(value => JSON.parse(value) as string | null);
  for (const id of [...historical, ...selectedIds]) if (!entries.some(entry => entry.id === id)) entries.push({ id, name: id ?? "未识别供应商", configured: false, query: "unsupported", revision: "historical" });
  const names = new Map<string, number>(); for (const entry of entries) names.set(entry.name, (names.get(entry.name) ?? 0) + 1);
  for (const entry of entries) if (names.get(entry.name)! > 1) entry.name = `${entry.name} · ${entry.id ?? "未识别"}`;
  const providerName = (id: string | null) => entries.find(entry => entry.id === id)?.name ?? id ?? "未识别供应商";
  const providerOptions = [{ value: "", label: "全部供应商" }, ...entries.map(entry => ({ value: JSON.stringify(entry.id), label: entry.name }))];
  const chosen = officialProvider ? entries.find(entry => JSON.stringify(entry.id) === officialProvider) : undefined;
  const availableSessions = sessionDirectory?.workspace === draft.workspace ? sessionDirectory.value : undefined;
  const sessionOptions = [{ value: "", label: "全部会话" }, ...(availableSessions?.sessions ?? []).map(item => ({ value: item.id, label: item.title }))];
  if (draft.session && !sessionOptions.some(option => option.value === draft.session)) sessionOptions.push({ value: draft.session, label: "已选会话" });
  const apply = (next = draft) => {
    const invalid = usageRangeError(next); if (invalid) { setFilterError(invalid); return; }
    advance.current = false; setPage(1); setReport(undefined); setError(""); setFilterError(""); setRequested(true); setApplied({ ...next, query: next.query.trim() }); setRefresh(n => n + 1);
  };
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(previous => ({ ...previous, [key]: value, ...(key === "workspace" ? { session: "" } : {}) }));
  const reset = () => { const next = emptyDraft(); setDraft(next); apply(next); };
  const pending = JSON.stringify(draft) !== JSON.stringify(applied);
  const scopeLabel = [usageRangeLabel(applied), workspaces.find(w => w.id === applied.workspace)?.name ?? (applied.workspace ? "所选工作空间" : "全部工作空间"), applied.session ? sessionDirectory?.value.sessions.find(s => s.id === applied.session)?.title ?? "已选会话" : "全部会话", requestTypeLabel(applied.requestType), applied.provider ? providerName(JSON.parse(applied.provider)) : "全部供应商", ...(applied.query ? [`搜索：${applied.query}`] : [])].join(" · ");
  const currentPage = report?.page ?? page, pages = Math.max(1, Math.ceil((report?.count ?? 0) / pageSize));
  return <div className="settings-app"><SettingsSidebar page="usage" /><main className="settings-main model-usage-main" id="content"><SettingsHeader page="usage" />
    <div className="container model-usage-page">
      <div className="usage-page-heading"><div className="overview-intro"><h1>模型用量与统计</h1></div>
        {local && <button type="button" className="btn" disabled={!connected || loading} onClick={() => { force.current = requested; setRequested(true); setPage(1); setRefresh(n => n + 1); setSessionRefresh(n => n + 1); }}>{loading ? "读取中…" : requested ? "刷新本机统计" : "加载本机统计"}</button>}</div>
      <div className="usage-tabs" role="tablist" aria-label="用量统计视图">{tabs.map((item, index) => <button key={item.id} id={`usage-tab-${item.id}`} type="button" role="tab" aria-selected={tab === item.id} aria-controls={`usage-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} onPointerEnter={() => prefetchTab(item.id)} onFocus={() => prefetchTab(item.id)} onClick={() => setTab(item.id)} onKeyDown={event => {
        const target = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : -1;
        if (target < 0) return; event.preventDefault(); setTab(tabs[target].id); document.getElementById(`usage-tab-${tabs[target].id}`)?.focus();
      }}>{item.label}</button>)}</div>
      {local ? <>
        <form className="usage-section usage-filter-panel" aria-label="用量筛选" onSubmit={event => { event.preventDefault(); apply(); }}>
          <div className="usage-filter-grid">
            <div className="usage-filter-field usage-filter-date"><label htmlFor="usage-date-range">日期</label><UsageDateRange id="usage-date-range" value={{ from: draft.from, to: draft.to }} disabled={!connected} onChange={range => setDraft(previous => ({ ...previous, ...range }))} /></div>
            <div className="usage-filter-field"><label htmlFor="usage-workspace">工作空间</label><Select id="usage-workspace" label="工作空间" value={draft.workspace} disabled={!connected} options={[{ value: "", label: "全部工作空间" }, ...workspaces.map(w => ({ value: w.id, label: w.name }))]} onChange={value => update("workspace", value)} /></div>
            <div className="usage-filter-field"><label htmlFor="usage-session">会话</label><Select id="usage-session" label="会话" value={draft.session} disabled={!connected || !directoryReady || sessionLoading} options={sessionOptions} onChange={value => update("session", value)} /></div>
            <div className="usage-filter-field"><label htmlFor="usage-request-type">类型</label><Select id="usage-request-type" label="类型" value={draft.requestType} descriptionId="usage-type-hint" disabled={!connected} options={[{ value: "main", label: "主代理" }, { value: "subagent", label: "子代理" }, { value: "compression", label: "压缩" }]} onChange={value => update("requestType", value as Draft["requestType"])} /></div>
            <div className="usage-filter-field"><label htmlFor="usage-provider">供应商</label><Select id="usage-provider" label="供应商" value={draft.provider} disabled={!connected} options={providerOptions} onChange={value => update("provider", value)} /></div>
          </div>
          <div className="usage-filter-footer"><div className="usage-search-field"><label className="sr-only" htmlFor="usage-search">搜索记录</label><input id="usage-search" className="input" type="search" placeholder="搜索模型、会话或调用来源" maxLength={200} value={draft.query} disabled={!connected} onChange={event => update("query", event.target.value)} /></div><p id="usage-type-hint">{pending ? "待应用" : ""}</p><div className="usage-filter-actions"><button type="button" className="btn btn-ghost" disabled={!connected} onClick={reset}>重置</button><button type="submit" className="btn" disabled={!connected}>应用</button></div></div>
          {filterError && <p className="feedback" role="alert">{filterError}</p>}
          {sessionError && <p className="feedback" role="alert">会话目录读取失败：{sessionError}；保留已选会话。<button type="button" className="btn btn-ghost" disabled={!connected || sessionLoading} onClick={() => setSessionRefresh(n => n + 1)}>重读会话目录</button></p>}
          {availableSessions?.truncated && <p className="usage-method">仅列出前1000个主会话，请缩小工作空间范围。</p>}
        </form>
        <p className="usage-applied-scope" title={scopeLabel}>已应用：{scopeLabel}</p>
      </> : <section className="usage-section usage-context-filter"><div className="usage-filter-field"><label htmlFor="usage-context-provider">供应商</label><Select id="usage-context-provider" label="供应商" value={tab === "official" ? officialProvider : requestProvider} disabled={!connected} options={tab === "official" ? [{ value: "", label: "请选择供应商" }, ...providerOptions.slice(1)] : providerOptions} onChange={tab === "official" ? setOfficialProvider : setRequestProvider} /></div><p>{tab === "official" ? "官方账号" : "当前后台 · 全部工作空间"}</p></section>}
      {directoryError && <p className="feedback" role="alert">筛选目录读取失败：{directoryError}<button type="button" className="btn btn-ghost" disabled={!connected} onClick={() => setDirectoryRefresh(n => n + 1)}>重读筛选目录</button></p>}
      <div id={`usage-panel-${tab}`} role="tabpanel" aria-labelledby={`usage-tab-${tab}`} tabIndex={0}><Suspense fallback={<p className="usage-empty">正在加载…</p>}>
        {tab === "overview" && <UsageOverview report={report} requested={requested} loading={loading} onDetails={() => { setTab("records"); document.getElementById("usage-tab-records")?.focus(); }} providerName={providerName} />}
        {tab === "records" && <section className="usage-section usage-records" aria-labelledby="usage-record-heading" aria-busy={loading}>
          <header className="usage-section-heading"><div><h2 id="usage-record-heading">调用明细</h2><p>{report?.background && !report.background.verifiedThrough ? "后台准备中…" : report ? `${report.count.toLocaleString()} 条记录` : "尚未加载"}</p></div><UsageColumns value={view} onChange={setView} /></header>
          {report?.rows.length ? <RecordTable key={JSON.stringify(applied)} rows={report.rows} providerName={providerName} view={view} /> : <p className="usage-empty">{!requested ? "尚未加载" : error ? "加载失败" : report?.background?.state === "error" ? "后台统计暂不可用" : report?.background && !report.background.verifiedThrough ? "后台准备中…" : loading || report?.building ? "加载中…" : report?.partial ? "暂无已确认记录" : "暂无记录"}</p>}
          <div className="usage-pagination" aria-label="调用记录分页"><label htmlFor="usage-page-size">每页</label><Select id="usage-page-size" label="每页记录数" value={String(pageSize)} disabled={!connected || !requested || loading || report?.building} options={[20, 50, 100].map(value => ({ value: String(value), label: `${value} 条` }))} onChange={value => { setPage(1); setPageSize(Number(value)); }} /><span role="status">{report?.background && !report.background.verifiedThrough ? "后台准备中…" : <>第 {currentPage} / {pages} 页{report ? ` · 共 ${report.count} 条` : ""}</>}</span><div><button type="button" className="btn btn-ghost" disabled={!connected || loading || !report || report.building || currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页</button><button type="button" className="btn btn-ghost" disabled={!connected || loading || !report || report.building || currentPage >= pages} onClick={() => setPage(currentPage + 1)}>下一页</button></div></div>
        </section>}
        {tab === "requests" && <RequestsPanel providers={directory} selected={requestProvider ? JSON.parse(requestProvider) as string | null : undefined} cached={requestCache} onReport={rememberRequests} />}
        {tab === "official" && (chosen ? <OfficialUsage key={JSON.stringify(chosen.id)} provider={chosen} /> : <p className="usage-empty">请选择供应商</p>)}
      </Suspense></div>
      {local && <div className="usage-local-status">
        {error && <p className="feedback" role="alert">{error}{report ? " 当前保留上次结果。" : ""}<button type="button" className="btn btn-ghost" disabled={!connected || loading} onClick={() => { advance.current = !!report?.building; setRefresh(n => n + 1); }}>重试加载</button></p>}
        {!!report?.total.unknownTokens && <p className="usage-quality" role="status">Token 不完整 · {report.total.unknownTokens.toLocaleString()} 条</p>}
        {!!report?.total.unknownCost && <p className="usage-quality" role="status">未完整计价 · {report.total.unknownCost.toLocaleString()} 条</p>}
        <p className="usage-status" role="status">{!connected ? "连接已断开 · 数据未更新" : report?.background ? `${report.updatedAt ? `核对至 ${new Date(report.updatedAt).toLocaleTimeString()}` : "后台准备中…"}${report.background.state === "error" ? " · 后台统计暂不可用，将自动重试" : report.background.state === "updating" ? " · 后台更新中" : ""}${report.partial && report.updatedAt ? " · 部分数据" : ""}` : loading || report?.building ? "加载中…" : report ? `更新于 ${new Date(report.updatedAt).toLocaleTimeString()}${report.partial ? " · 部分数据" : ""}` : "尚未加载"}</p>
      </div>}
    </div>
  </main></div>;
}
