import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { SettingsSidebar } from "../components.js";
import { SettingsHeader } from "../settings/SettingsHeader.js";
import { ConfirmDialog } from "../ConfirmDialog.js";
import { Select } from "../Select.js";
import { UsageDateRange } from "../UsageDateRange.js";
import { usageDateBoundary, usageRangeError } from "../usage-dates.js";
import { UsageColumns, useUsageView } from "../UsageColumns.js";
import { usageCacheHit, usageCacheHitDescription, usageColumnDescriptions, usageColumns, usageCostPart, usageInputTotal, usagePricingLabel, type UsageColumnId, type UsageView } from "../usage-fields.js";
import { ProviderProxyFields } from "../models/ProviderProxyFields.js";
import { ProviderUsage } from "../models/ProviderUsage.js";
import { command, useConnectionState, useScope } from "../transport.js";
import { costLabels, costParts, costPartLabels, type CostTotals } from "../../shared/costs.js";
import { usageProviderId, usageProvidersScope, type UsageAccount, type UsageProvider, type UsageRecord, type UsageRecordPage, type UsageRecordFilter, type UsageAgentRole, type UsageSessionDirectory } from "../../shared/model-usage.js";
import type { ProviderProxy } from "../../shared/models.js";
import { modelDisplay } from "../../shared/model-display.js";
import "../styles/settings.css";
import "../styles/model-interactions.css";
import "../styles/model-usage.css";
const ModelLogin = lazy(() => import("./ModelLogin.js").then(module => ({ default: module.ModelLogin })));
const emptyInvalidation = { revision: 0 };
type Entry = Omit<UsageProvider, "id"> & { id: string | null };
const tokenSum = (total: CostTotals) => costParts.reduce((sum, part) => sum + total.tokens[part], 0);
const exact = (value: number) => Number.isFinite(value) ? value.toLocaleString("zh-CN", { maximumSignificantDigits: 21 }) : "无法核对";
const compactNumber = (value: number | undefined) => value === undefined || !Number.isFinite(value) ? "—" : value >= 1e15 || value > 0 && value < 0.01 ? value.toExponential(2) : value.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 });
const percent = (value: number | undefined) => value === undefined ? "—" : value > 0 && value < .1 ? "<0.1%" : value < 100 && value > 99.9 ? ">99.9%" : `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
const money = (value: number | undefined) => value === undefined || !Number.isFinite(value) ? "—" : Math.abs(value) >= 1e6 || value !== 0 && Math.abs(value) < 0.00005 ? `$${value.toExponential(3)}` : `$${value.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
function tokens(total: CostTotals | undefined, part?: typeof costParts[number]) {
  if (!total?.records) return "—";
  const value = part ? total.tokens[part] : tokenSum(total);
  if (!Number.isFinite(value) || !value && total.unknownTokens) return "—";
  return compactNumber(value);
}
function tokenTitle(total: CostTotals | undefined, part?: typeof costParts[number]) {
  if (tokens(total, part) === "—") return "尚无可核对数据";
  return `${total!.unknownTokens ? "已确认部分：" : ""}${exact(part ? total!.tokens[part] : tokenSum(total!))} Token`;
}
function amount(total: CostTotals, showEstimate = true) {
  const value = total.knownCost;
  if (!total.records || !Number.isFinite(value) || !value && total.unknownCost) return "—";
  return `${money(value)}${showEstimate && total.estimatedRecords ? "（含估算）" : ""}`;
}
function amountTitle(total: CostTotals) {
  return amount(total) === "—" ? "尚无可核对的费用" : `${total.unknownCost ? "已知部分：" : ""}${exact(total.knownCost)} USD${total.estimatedRecords ? `；其中 ${exact(total.estimatedCost ?? 0)} USD 为公开参考价估算，非实际扣款；${total.estimateSources?.join("；") ?? ""}` : ""}`;
}

function OfficialUsage({ provider }: { provider: Entry }) {
  const { connected, generation } = useConnectionState();
  const supportsCodex = provider.id === "openai" || provider.id === usageProviderId;
  const invalidation = useScope("usage:account", emptyInvalidation);
  const [account, setAccount] = useState<UsageAccount>(), [managementLoaded, setManagementLoaded] = useState(false);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0), [login, setLogin] = useState(false), [logout, setLogout] = useState(false);
  const [source, setSource] = useState<"auto" | "model" | "codex">("auto");
  const requiresAccount = supportsCodex && !(provider.id === "openai" && source === "model");
  const [draft, setDraft] = useState<{ proxy: ProviderProxy; revision: string }>();
  useEffect(() => {
    if (!connected || !supportsCodex) return;
    let active = true; const controller = new AbortController(); setLoading(true);
    void command<UsageAccount>("usage.account.get", {}, {}, crypto.randomUUID(), controller.signal)
      .then(value => { if (active) { setAccount(value); setError(""); } })
      .catch(error => { if (active) setError(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [connected, generation, supportsCodex, invalidation.revision, refresh]);
  const codex = provider.id === usageProviderId || supportsCodex && (source === "codex" || source === "auto" && !!account?.configured);
  const conflict = !!account && !!draft && draft.revision !== account.revision;
  const proxy = draft?.proxy ?? account?.proxy ?? { mode: "direct" as const };
  const revision = codex ? `${account?.generation}:${account?.revision}` : provider.revision;
  const status = requiresAccount && !account ? loading ? "正在读取认证状态…" : "独立授权状态未确认" : codex
    ? !account ? "独立授权状态未确认" : account.configured ? account.expired ? "独立授权已过期" : "Codex 独立授权" : "尚未连接 Codex"
    : provider.configured ? "模型服务认证" : "未关联模型服务认证";
  const saveProxy = async () => {
    if (!account || !draft || conflict) return;
    setBusy(true); setError("");
    try { setAccount(await command<UsageAccount>("usage.account.proxy", { proxy: draft.proxy, revision: draft.revision })); setDraft(undefined); }
    catch (error) { setError((error as Error).message); setRefresh(n => n + 1); }
    finally { setBusy(false); }
  };
  return <section className="usage-section usage-official" aria-labelledby="upstream-usage-heading">
    <header className="usage-section-heading"><div><h2 id="upstream-usage-heading">{provider.name} · 官方用量</h2><p role="status">{status} · 只读 · 每30～40分钟刷新 · 不受工作空间筛选影响</p></div></header>
    {error && <p className="feedback" role="alert">{error}</p>}
    {!(requiresAccount && !account) && !login && <>
      {codex ? account && (account.configured && !account.expired
        ? <ProviderUsage key={revision} providerId={usageProviderId} pricingProviderId={provider.id ?? undefined} revision={revision} />
        : <div className="usage-connect"><p>{account.expired ? "授权已过期；查询不会自动刷新或改写认证。" : "连接 Codex 以查询官方额度；不影响本机统计。"}</p>
          <button type="button" className="btn" disabled={!connected || busy || loading || conflict} onClick={() => setLogin(true)}>{account.expired ? "重新授权" : "授权连接"}</button></div>)
        : provider.query === "shared" && provider.id ? <ProviderUsage key={`${provider.id}:${revision}`} providerId={provider.id} revision={revision} />
          : <p className="usage-method">暂未接入此连接的官方额度查询。本机统计照常提供。</p>}
    </>}
    <details className="usage-management" onToggle={event => { if (event.currentTarget.open) setManagementLoaded(true); }}>
      <summary>更多管理</summary>{managementLoaded && <div className="usage-management-body">
        <p className="usage-method">官方账号额度不受项目筛选影响，不能与其他供应商余额合计。只读查询，不消耗重置次数、不执行重置或充值。</p>
        {!codex && <p className="usage-method">认证与网络沿用此模型连接；<a href="/model-config.html">前往模型服务设置</a>。查询不会自动刷新 OAuth，登录成功也不代表拥有额度接口权限。</p>}
        {provider.id === "openai" && <div className="usage-source"><label htmlFor="usage-auth-source">官方用量来源</label><Select id="usage-auth-source" label="官方用量来源" value={codex ? "codex" : "model"}
          disabled={login || busy} options={[{ value: "model", label: "模型服务认证" }, { value: "codex", label: "Codex 独立授权" }]} onChange={value => setSource(value as "model" | "codex")} /></div>}
        {supportsCodex && <>
          <p className="usage-method">Codex 独立凭据仅用于查询，不替换或退出模型服务认证，也不自动对应当前连接的本机记录。{!account ? " 独立授权状态尚未确认。" : account.configured ? account.expired ? " 独立授权已过期。" : " 已保存独立 OAuth 授权。" : " 尚未授权用量账号。"}</p>
          {account && !login && <>
            <ProviderProxyFields label="用量查询网络" help="仅用于独立 Codex 授权与额度查询；所选代理不可用时不会自动直连。" value={proxy}
              disabled={!connected || loading || busy} onChange={proxy => setDraft(previous => ({ proxy, revision: previous?.revision ?? account.revision }))} />
            {conflict && <p className="feedback" role="alert">查询网络配置已改变，输入已保留；请放弃修改后重新核对。</p>}
            <div className="usage-actions">
              {draft && <><button type="button" className="btn" disabled={!connected || busy || loading || conflict} onClick={() => void saveProxy()}>保存查询网络</button><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setDraft(undefined)}>放弃网络修改</button></>}
              {!account.configured && !codex && <button type="button" className="btn" disabled={!connected || busy || loading || conflict} onClick={() => { setSource("codex"); setLogin(true); }}>连接独立 Codex 账号</button>}
              {account.configured && <button type="button" className="btn btn-ghost" disabled={!connected || busy || loading || login} onClick={() => setLogout(true)}>退出用量授权</button>}
              <button type="button" className="btn btn-ghost" disabled={!connected || loading || busy || login} onClick={() => setRefresh(n => n + 1)}>重新读取授权状态</button>
            </div>
          </>}
          {!account && !login && <button type="button" className="btn btn-ghost" disabled={!connected || loading || busy} onClick={() => setRefresh(n => n + 1)}>重新读取授权状态</button>}
        </>}
      </div>}
    </details>
    {login && account && <Suspense fallback={<p>正在加载授权界面…</p>}><ModelLogin context="usage" inline providerId={usageProviderId} type="oauth" revision={account.revision} proxy={proxy}
      onComplete={() => { setLogin(false); setDraft(undefined); setRefresh(n => n + 1); }} close={() => { setLogin(false); setRefresh(n => n + 1); }} /></Suspense>}
    {logout && account && <ConfirmDialog title="退出 Codex 用量授权" description="仅从本机删除此独立用量账号的凭据，不会退出模型服务，也不撤销上游账号授权。" confirmLabel="退出用量授权" danger
      confirmDisabled={!connected || busy || loading} onClose={() => setLogout(false)} onConfirm={async () => {
        setBusy(true);
        try { setAccount(await command<UsageAccount>("usage.account.logout", { revision: account.revision, generation: account.generation })); setDraft(undefined); setSource("codex"); }
        finally { setBusy(false); setRefresh(n => n + 1); }
      }} />}
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
    case "context": return <><span className="usage-row-name" title={row.workspaceName}>{row.workspaceName}</span><small title={`${row.sessionTitle}\n会话 ID：${row.sessionId}`}>{row.sessionTitle}</small></>;
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
export default function ModelUsage() {
  const { connected, generation } = useConnectionState();
  const [view, setView] = useUsageView();
  const directoryInvalidation = useScope(usageProvidersScope, emptyInvalidation);
  const [workspace, setWorkspace] = useState(""), [selected, setSelected] = useState<string | null>();
  const [report, setReport] = useState<UsageRecordPage>(), [directory, setDirectory] = useState<UsageProvider[]>([]), [historical, setHistorical] = useState<(string | null)[]>([]);
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false), [error, setError] = useState(""), [directoryError, setDirectoryError] = useState("");
  const [requested, setRequested] = useState(false), [directoryRefresh, setDirectoryRefresh] = useState(0), [refresh, setRefresh] = useState(0);
  const [visible, setVisible] = useState(() => document.visibilityState === "visible"), advance = useRef(false);
  useEffect(() => { const changed = () => setVisible(document.visibilityState === "visible"); document.addEventListener("visibilitychange", changed); return () => document.removeEventListener("visibilitychange", changed); }, []);
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20);
  const [query, setQuery] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [session, setSession] = useState(""), [agent, setAgent] = useState<"" | UsageAgentRole>("");
  const [filters, setFilters] = useState<Pick<UsageRecordFilter, "query" | "from" | "to" | "rootSessionId" | "agentRole">>({ query: "" });
  const [sessionDirectory, setSessionDirectory] = useState<{ workspace: string; value: UsageSessionDirectory }>();
  const [sessionLoading, setSessionLoading] = useState(false), [sessionError, setSessionError] = useState(""), [sessionRefresh, setSessionRefresh] = useState(0);
  const snapshot = useRef<{ workspace: string; id: string } | undefined>(undefined), force = useRef(false);
  useEffect(() => {
    if (!connected) return;
    let active = true; const controller = new AbortController();
    void Promise.all([command<UsageProvider[]>("usage.providers", {}, {}, crypto.randomUUID(), controller.signal), command<{ id: string; name: string }[]>("usage.workspaces", {}, {}, crypto.randomUUID(), controller.signal)])
      .then(([providers, spaces]) => { if (active) { setDirectory(providers); setWorkspaces(spaces); setDirectoryError(""); } })
      .catch(error => { if (active) setDirectoryError(error.message); });
    return () => { active = false; controller.abort(); };
  }, [connected, generation, directoryInvalidation.revision, directoryRefresh]);
  useEffect(() => {
    if (!connected) return;
    let active = true; const controller = new AbortController(); setSessionLoading(true); setSessionError("");
    void command<UsageSessionDirectory>("usage.sessions", { workspaceId: workspace || undefined }, {}, crypto.randomUUID(), controller.signal)
      .then(value => { if (active) setSessionDirectory({ workspace, value }); })
      .catch(error => { if (active) setSessionError(error.message); })
      .finally(() => { if (active) setSessionLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [connected, generation, workspace, sessionRefresh, directoryInvalidation.revision]);
  useEffect(() => {
    if (!connected || !requested) return;
    let active = true; const controller = new AbortController(); setLoading(true); setError("");
    const explicit = force.current, continuation = advance.current; force.current = false; advance.current = false;
    void command<UsageRecordPage>("usage.ledger", { workspaceId: workspace || undefined, providerId: selected, ...filters, page, pageSize,
      snapshot: snapshot.current?.workspace === workspace ? snapshot.current.id : undefined, refresh: explicit, continue: continuation && !explicit }, {}, crypto.randomUUID(), controller.signal)
      .then(value => { if (active) { snapshot.current = { workspace, id: value.snapshot }; setReport(value); setHistorical(value.providers.slice(0, 1000)); } })
      .catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [connected, generation, requested, workspace, selected, filters, page, pageSize, refresh]);
  useEffect(() => {
    if (!connected || !visible || !requested || !report?.building || loading || error) return;
    const timer = setTimeout(() => { advance.current = true; setRefresh(value => value + 1); }, 100);
    return () => clearTimeout(timer);
  }, [connected, visible, requested, report, loading, error]);
  const entries: Entry[] = directory.map(provider => ({ ...provider }));
  for (const id of [...historical, ...(selected !== undefined ? [selected] : [])]) if (!entries.some(entry => entry.id === id)) entries.push({ id, name: id ?? "未识别供应商", configured: false, query: "unsupported", revision: "historical" });
  const names = new Map<string, number>(); for (const entry of entries) names.set(entry.name, (names.get(entry.name) ?? 0) + 1);
  for (const entry of entries) if (names.get(entry.name)! > 1) entry.name = `${entry.name} · ${entry.id ?? "未识别"}`;
  const providerName = (id: string | null) => entries.find(entry => entry.id === id)?.name ?? id ?? "未识别供应商";
  const chosen = entries.find(entry => entry.id === selected), total = report?.total;
  const availableSessions = sessionDirectory?.workspace === workspace ? sessionDirectory.value : undefined;
  const sessionOptions = [{ value: "", label: "全部会话" }, ...(availableSessions?.sessions ?? []).map(item => ({ value: item.id,
    label: `${item.title}${workspace ? "" : ` · ${item.workspaceName}`} · ${item.id.slice(0, 8)}` }))];
  if (session && !sessionOptions.some(option => option.value === session)) sessionOptions.push({ value: session, label: `已选会话 · ${session.slice(0, 8)}` });
  const appliedSession = filters.rootSessionId ? availableSessions?.sessions.find(item => item.id === filters.rootSessionId)?.title ?? `会话 ${filters.rootSessionId.slice(0, 8)}` : "全部会话";
  const agentLabel = filters.agentRole === "main" ? "主代理" : filters.agentRole === "subagent" ? "子代理" : "全部代理";
  const clear = () => { advance.current = false; setPage(1); setReport(undefined); setError(""); };
  const go = (next: number) => { setPage(next); setRefresh(value => value + 1); };
  const currentPage = report?.page ?? page, pages = Math.max(1, Math.ceil((report?.count ?? 0) / pageSize));
  return <div className="settings-app"><SettingsSidebar page="usage" /><main className="settings-main model-usage-main" id="content"><SettingsHeader page="usage" />
    <div className="container model-usage-page">
      <div className="usage-page-heading"><div className="overview-intro"><h1>模型用量与统计</h1><p>工作空间中的全部会话与子任务 · 已保留调用记录</p></div>
        <button type="button" className="btn" disabled={!connected || loading} onClick={() => { force.current = true; setRequested(true); setPage(1); setRefresh(n => n + 1); setSessionRefresh(n => n + 1); }}>{loading ? "读取中…" : requested ? "刷新本机统计" : "加载本机统计"}</button></div>
      <div className="usage-primary-filters">
        <div><label htmlFor="usage-workspace">工作空间</label><Select id="usage-workspace" label="工作空间" value={workspace} disabled={!connected}
          options={[{ value: "", label: "全部工作空间" }, ...workspaces.map(w => ({ value: w.id, label: w.name }))]} onChange={value => { if (value !== workspace) { clear(); setRequested(true); setWorkspace(value); setSession(""); setFilters(previous => ({ ...previous, rootSessionId: undefined })); } }} /></div>
        <div><label htmlFor="usage-provider">模型供应商</label><Select id="usage-provider" label="模型供应商" value={selected === undefined ? "" : JSON.stringify(selected)} disabled={!connected}
          options={[{ value: "", label: "全部供应商" }, ...entries.map(entry => ({ value: JSON.stringify(entry.id), label: entry.name }))]} onChange={value => { const id = value ? JSON.parse(value) as string | null : undefined; if (id !== selected) { clear(); setRequested(true); setSelected(id); } }} /></div>
      </div>
      {directoryError && <p className="feedback" role="alert">筛选目录读取失败：{directoryError}；已有记录仍可查看。<button type="button" className="btn btn-ghost" disabled={!connected} onClick={() => setDirectoryRefresh(n => n + 1)}>重读筛选目录</button></p>}
      <section className="usage-section usage-local-report" aria-labelledby="local-usage-heading" aria-busy={loading} data-partial={report?.partial || undefined}>
        <header className="usage-section-heading"><div><h2 id="local-usage-heading">用量概览</h2><p>{workspace ? workspaces.find(w => w.id === workspace)?.name ?? "所选工作空间" : "全部工作空间"} · {chosen?.name ?? "全部供应商"} · {appliedSession} · {agentLabel} · 同下方筛选范围的全部记录，非当前页小计</p></div></header>
        <div className="usage-totals" aria-label="Token 概览">{[{ label: "总 Token", part: undefined }, ...costParts.map(part => ({ label: costPartLabels[part], part }))].map(item => <div key={item.label}>
          <span>{item.label}</span><strong title={tokenTitle(total, item.part)}>{tokens(total, item.part)}</strong></div>)}</div>
        <div className="usage-insights" aria-label="用量补充指标"><span>输入合计 <strong title={usageInputTotal(total) === undefined ? "Token 数据未完整核对" : `${exact(usageInputTotal(total)!)} Token；普通输入＋缓存读取＋缓存写入`}>{compactNumber(usageInputTotal(total))}</strong></span><span>缓存命中率 <strong title={usageCacheHitDescription}>{percent(usageCacheHit(total))}</strong><small>Token 维度</small></span></div>
        {!requested && <p className="usage-method">尚未加载本机统计。点击“加载本机统计”后再扫描；筛选目录和官方查询独立按需加载。</p>}
        {!!total?.unknownTokens && <p className="usage-quality" role="status">有 {total.unknownTokens.toLocaleString()} 条记录未完整上报 Token，仅展示已确认部分。</p>}
        {report && <p className="usage-method">历史费用与参考估算 <strong className="num" title={amountTitle(report.total)}>{amount(report.total)}</strong>{report.total.unknownCost ? ` · ${report.total.unknownCost} 条未完整计价` : ""}；已有费用保留历史价格，缺价可按公开价估算并标记，不按当前配置重算。</p>}
      </section>
      {chosen && (chosen.query !== "unsupported" || chosen.id === "openai" || chosen.id === usageProviderId) && <OfficialUsage key={JSON.stringify(chosen.id)} provider={chosen} />}
      <section className="usage-section usage-records" aria-labelledby="usage-record-heading" aria-busy={loading}>
        <header className="usage-section-heading"><div><h2 id="usage-record-heading">调用记录</h2><p>{report ? `${report.count.toLocaleString()} 条匹配记录` : "逐条调用与来源可核对的账务记录"} · 聚合账务与缺失原始记录单独标注，不等于网络请求次数</p></div><UsageColumns value={view} onChange={setView} /></header>
        <form className="usage-record-filters" onSubmit={event => { event.preventDefault(); const invalid = usageRangeError({ from, to }); if (invalid) { setError(invalid); return; } clear(); setRequested(true); setFilters({ query: query.trim(), from: usageDateBoundary(from, false), to: usageDateBoundary(to, true), rootSessionId: session || undefined, agentRole: agent || undefined }); }}>
          <div className="usage-search-field"><label htmlFor="usage-search">搜索记录</label><input id="usage-search" className="input" type="search" placeholder="工作空间、会话、模型或调用来源" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} /></div>
          <div className="usage-date-field"><label htmlFor="usage-date-range">日期范围</label><UsageDateRange id="usage-date-range" value={{ from, to }} disabled={!connected} onChange={range => { setFrom(range.from); setTo(range.to); }} /></div>
          <div className="usage-session-field"><label htmlFor="usage-session">会话</label><Select id="usage-session" label="会话" value={session} disabled={!connected || sessionLoading}
            options={sessionOptions} onChange={setSession} /></div>
          <div className="usage-agent-field"><label htmlFor="usage-agent">代理类型</label><Select id="usage-agent" label="代理类型" value={agent} disabled={!connected}
            options={[{ value: "", label: "全部代理" }, { value: "main", label: "主代理" }, { value: "subagent", label: "子代理" }]} onChange={value => setAgent(value as "" | UsageAgentRole)} /></div>
          <button type="submit" className="btn" disabled={!connected}>筛选</button>
        </form>
        <p className="usage-filter-note">会话按主会话归组，包含其子代理；代理类型可进一步限定。分支仅计归属账务，不重复计算继承记录。{sessionLoading ? " 正在读取会话目录…" : availableSessions?.truncated ? " 目录仅列出前1000个主会话，请先缩小工作空间范围。" : ""}</p>
        {sessionError && <p className="feedback" role="alert">会话目录读取失败：{sessionError}；不会自动清除已选会话。<button type="button" className="btn btn-ghost" disabled={!connected || sessionLoading} onClick={() => setSessionRefresh(value => value + 1)}>重读会话目录</button></p>}
        {error && <p className="feedback" role="alert">{error}{report ? " 当前保留上次结果。" : ""}<button type="button" className="btn btn-ghost" disabled={!connected || loading} onClick={() => { advance.current = !!report?.building; setRefresh(value => value + 1); }}>重试加载</button></p>}
        {!!report?.warnings.length && <details className="usage-warnings"><summary>{report.partial ? "部分记录尚未计入" : "统计口径提示"} · {report.warnings.length} 项</summary>{report.warnings.map((warning, i) => <p key={i}>{warning}</p>)}</details>}
        {report && report.rows.length > 0 ? <RecordTable key={JSON.stringify([workspace, selected, filters])} rows={report.rows} providerName={providerName} view={view} /> : <p className="usage-empty">{!requested ? "点击加载、选择工作空间或供应商后显示调用记录。" : error ? "调用记录尚未加载成功。" : loading || report?.building ? "正在分批核对调用记录，尚未发现当前筛选的已验证记录…" : report?.partial ? "已核对部分没有匹配记录；仍有来源未能完整核对，不能据此判定没有消费。" : "当前筛选没有已保留的调用记录；不代表官方账号没有消费。"}</p>}
        <div className="usage-pagination" aria-label="调用记录分页"><label htmlFor="usage-page-size">每页</label><Select id="usage-page-size" label="每页记录数" value={String(pageSize)} disabled={!connected || !requested || loading || report?.building} options={[20, 50, 100].map(value => ({ value: String(value), label: `${value} 条` }))} onChange={value => { setPage(1); setPageSize(Number(value)); }} />
          <span role="status">第 {currentPage} / {pages} 页{report ? ` · 共 ${report.count} 条` : ""}</span><div><button type="button" className="btn btn-ghost" disabled={!connected || loading || !report || report.building || currentPage <= 1} onClick={() => go(currentPage - 1)}>上一页</button><button type="button" className="btn btn-ghost" disabled={!connected || loading || !report || report.building || currentPage >= pages} onClick={() => go(currentPage + 1)}>下一页</button></div></div>
        <p className="usage-status" role="status">{!connected ? "连接已断开；保留的统计可能尚未更新，重连后重新读取。" : loading ? "正在读取本机用量…" : report ? `快照更新于 ${new Date(report.updatedAt).toLocaleTimeString()} · 已处理 ${report.processedRoots ?? report.scannedRoots} / ${report.totalRoots} 个主会话家族 · 完整核对 ${report.scannedRoots} 个${report.building ? visible ? " · 正在继续核对…" : " · 页面隐藏，已暂停继续核对" : report.partial ? " · 部分统计" : ""}` : "尚未读取统计"}</p>
        <details className="usage-method-details"><summary>统计口径</summary><p>默认全部未归档工作空间的全部会话与子任务。子 Agent、压缩、工具和记忆账务按来源核对，包含历史分支与重试，继承的分支记录不重复计入；未保留的调用无法还原。总 Token 为普通输入、输出、缓存读取、缓存写入之和；输入合计不包含输出。缓存命中率是缓存读取占输入合计的 Token 加权比例，不是请求命中率；缺失数据或零分母不计算。缓存写入是创建输入缓存，不是模型输出。消费金额为保留的历史费用及标注来源的公开参考估算，不是官方余额或完整实际账单；估算已含在金额内不可重复相加。缺价格不影响 Token。空缺为「—」而非零，未记录的时间显示“时间未知”。调用记录分批核对，页面可见时自动继续，隐藏后暂停；构建中仅展示已验证来源，期间暂不翻页。完成后分页和筛选复用有界快照，最长缓存5分钟；手动刷新重新核对原始记录，快照更新后回第一页。</p></details>
      </section>
    </div>
  </main></div>;
}
