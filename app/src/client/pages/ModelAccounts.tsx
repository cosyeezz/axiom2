import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, Icon, SettingsSidebar } from "../components.js";
import { SettingsHeader } from "../settings/SettingsHeader.js";
import { Select } from "../Select.js";
import { command, useConnectionState, useScope } from "../transport.js";
import { ModelAccountUsage } from "../models/ModelAccountUsage.js";
import { displayModelAccounts, modelAccountPresentation } from "../../shared/model-account-presentation.js";
import { providerDisplayName } from "../../shared/model-providers.js";
import type { ModelAccount, ModelAccounts as Accounts } from "../../shared/model-accounts.js";
import type { ModelConfiguration } from "../../shared/models.js";
import { providerAccountStateLabel } from "../../shared/provider-usage.js";
import "../styles/settings.css";
import "../styles/model-interactions.css";
import "../styles/model-accounts.css";

function AccountCard({ account, revision, confirmed, disabled, activate }: { account: ModelAccount; revision: string; confirmed: boolean; disabled: boolean; activate: () => void }) {
  const ref = useRef<HTMLElement>(null), [visible, setVisible] = useState(false), [details, setDetails] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { rootMargin: "100px" });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const presentation = modelAccountPresentation(account);
  const expired = account.expiresAt !== undefined && account.expiresAt <= Date.now();
  const authLabel = account.type === "oauth" ? "OAuth" : account.type === "api_key" ? "API Key" : "认证缺失";
  const metadata = [account.region, authLabel, account.legacy ? "原有登录" : "独立保存", expired ? "待刷新" : ""].filter(Boolean).join(" · ");
  return <article ref={ref} className="model-account-card" data-presentation={presentation.kind} data-active={account.active} data-confirmed={confirmed} aria-label={`账号 ${account.label}`}>
    <header className="account-card-header">
      <div className="account-card-title"><div className="account-card-heading"><h3 title={account.label}>{account.label}</h3>
        {account.active && <span className="account-active-mark" role="status" aria-label={confirmed ? "当前账号" : "上次选择账号"} title={confirmed ? "新任务使用此账号" : "上次读取的选择，当前账号尚未确认"}>{confirmed ? "当前启用" : "上次选择"}</span>}</div>
        <p className="account-card-meta" title={metadata}>{metadata}</p></div>
      <div className="account-card-actions">
        <button className="btn btn-ghost account-details-button" type="button" aria-label="查看账号详情" onClick={() => setDetails(true)}>详情</button>
        {!account.active && <button className="btn" type="button" aria-label="启用此账号" disabled={disabled || !confirmed || !account.type} onClick={activate}>启用</button>}
      </div>
    </header>
    <ModelAccountUsage account={account} revision={revision} enabled={visible}>{usage => details && <Dialog title={`账号详情：${account.label}`} onClose={() => setDetails(false)} className="settings-dialog model-account-dialog">
      <dl className="account-info-list">
        <div><dt>供应商</dt><dd>{providerDisplayName(account.providerId)}</dd></div>
        <div><dt>区域</dt><dd>{account.region || "供应商默认"}</dd></div>
        <div><dt>认证</dt><dd>{authLabel}{expired && " · 等待刷新"}</dd></div>
        {usage?.accountStatus && <div><dt>账号状态</dt><dd>{providerAccountStateLabel(usage.accountStatus.state)}<small> · 检查于 {new Date(usage.accountStatus.checkedAt).toLocaleString()}</small></dd></div>}
        <div><dt>来源</dt><dd>{account.legacy ? "原有登录入口" : "独立保存"}</dd></div>
        <div><dt>邮箱</dt><dd>{usage?.account?.email || account.email || "接口与本地授权均未提供"}{!usage?.account?.email && account.emailSource === "token" && <small> · 来自授权令牌，仅作账号区分</small>}</dd></div>
        {(usage?.account?.plan || account.plan) && <div><dt>{usage?.account?.plan ? "套餐" : "套餐（授权信息）"}</dt><dd>{usage?.account?.plan || account.plan}</dd></div>}
        {(usage?.account?.accountId || account.accountId) && <div><dt>账号 ID</dt><dd>{usage?.account?.accountId || account.accountId}</dd></div>}
        {usage?.account?.subscriptionExpiresAt !== undefined && <div><dt>订阅有效至</dt><dd><time dateTime={new Date(usage.account.subscriptionExpiresAt).toISOString()}>{new Date(usage.account.subscriptionExpiresAt).toLocaleString()}</time></dd></div>}
        {account.login?.method && <div><dt>登录方式</dt><dd>{{ "builder-id": "AWS Builder ID", "identity-center": "企业 IAM Identity Center", social: "Google / GitHub" }[account.login.method]}</dd></div>}
        {account.login?.startUrl && <div><dt>企业 Start URL</dt><dd>{account.login.startUrl}</dd></div>}
        {account.login?.authRegion && <div><dt>认证区域</dt><dd>{account.login.authRegion}</dd></div>}
        {account.login?.flow && <div><dt>授权流程</dt><dd>{account.login.flow === "device" ? "设备授权" : "浏览器 PKCE"}</dd></div>}
        {account.expiresAt !== undefined && <div><dt>令牌有效期</dt><dd><time dateTime={new Date(account.expiresAt).toISOString()}>{new Date(account.expiresAt).toLocaleString()}</time></dd></div>}
      </dl>
      {presentation.kind === "openai-subscription" && <p className="field-help">先用此账号授权发起只读状态检查，目标账号明确且检查通过后再查额度与订阅；状态异常或无法确认时停止后续查询，保留手动重试。点数不直接换算美元；费用估算基于同供应商、同窗口的调用样本与使用比例，非官方余额。</p>}
      {expired && <p className="field-help">模型调用时会尝试刷新认证；额度查询本身不会刷新令牌。</p>}
      <div className="dialog-actions"><button className="btn" type="button" onClick={() => setDetails(false)}>关闭</button></div>
    </Dialog>}</ModelAccountUsage>
  </article>;
}
export default function ModelAccounts() {
  const connection = useConnectionState(), invalidation = useScope("model-accounts", { revision: 0 });
  const [accounts, setAccounts] = useState<Accounts>(), [configuration, setConfiguration] = useState<ModelConfiguration>();
  const [error, setError] = useState(""), [message, setMessage] = useState(() => new URLSearchParams(location.search).get("added") === "1" ? "账号已保存。" : ""), [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(""), [filter, setFilter] = useState("");
  useEffect(() => { if (new URLSearchParams(location.search).get("added") === "1") history.replaceState(null, "", location.pathname); }, []);
  const [selection, setSelection] = useState<ModelAccount>();
  const [confirmed, setConfirmed] = useState(true), [pendingConfirmation, setPendingConfirmation] = useState(false);
  const [confirmedGeneration, setConfirmedGeneration] = useState(-1);
  const readGeneration = useRef(0);
  const load = async (): Promise<boolean> => {
    const generation = ++readGeneration.current;
    try {
      const [list, config] = await Promise.all([command<Accounts>("accounts.list"), command<ModelConfiguration>("configuration.get")]);
      if (generation !== readGeneration.current) return false;
      setAccounts(list); setConfiguration(config); setError(""); setConfirmed(true); setConfirmedGeneration(connection.generation); setPendingConfirmation(false);
      return true;
    } catch (e) {
      if (generation === readGeneration.current) { setError((e as Error).message); setConfirmed(false); }
      return false;
    }
  };
  useEffect(() => {
    if (connection.connected) void load();
    return () => { readGeneration.current++; };
  }, [connection.connected, connection.generation, invalidation.revision]);
  const suppliers = useMemo(() => {
    const rows = new Map<string, { id: string; name: string; methods: ("oauth" | "api_key")[] }>();
    for (const template of configuration?.templates ?? []) {
      if (template.methods?.includes("oauth")) rows.set(template.id, { ...template, methods: ["oauth"] });
    }
    for (const configured of configuration?.providers ?? []) {
      const methods = configured.auth?.methods ?? [];
      if (methods.length) rows.set(configured.providerId, { id: configured.providerId, name: configured.name || providerDisplayName(configured.providerId), methods });
    }
    return [...rows.values()];
  }, [configuration]);
  const groups = useMemo(() => {
    const byProvider = new Map<string, ModelAccount[]>();
    for (const account of displayModelAccounts(accounts?.accounts ?? [])) {
      const rows = byProvider.get(account.providerId) ?? [];
      rows.push(account); byProvider.set(account.providerId, rows);
    }
    // Eligibility comes from the full list, never from search results or the active pointer.
    return [...byProvider].map(([providerId, rows]) => ({
      providerId, name: suppliers.find(row => row.id === providerId)?.name || providerDisplayName(providerId), accounts: rows, extended: rows.some(account => modelAccountPresentation(account).kind !== "generic"),
    }));
  }, [accounts, suppliers]);
  const filteredGroups = groups.filter(group => !filter || group.providerId === filter).map(group => ({ ...group,
    accounts: group.accounts.filter(account => `${account.label} ${account.providerId} ${group.name} ${account.region} ${account.email || ""} ${account.accountId || ""}`.toLowerCase().includes(query.toLowerCase())),
  })).filter(group => group.accounts.length > 0);
  const filteredCount = filteredGroups.reduce((count, group) => count + group.accounts.length, 0);
  const showFilters = groups.reduce((count, group) => count + group.accounts.length, 0) > 1 || !!query || !!filter;
  const disconnected = !connection.connected;
  const selectionConfirmed = confirmed && !disconnected && confirmedGeneration === connection.generation;
  const activate = async () => {
    if (!selection || !accounts || !selectionConfirmed || busy || disconnected) return;
    setBusy(true); setError(""); setMessage(""); setPendingConfirmation(false);
    readGeneration.current++; // Invalidate reads started before the write.
    try {
      await command<Accounts>("accounts.activate", { accountId: selection.id, revision: accounts.revision });
      // Another window may have changed selection while this response was in flight.
      // Only fresh, generation-guarded reads may update the authoritative card state.
      const refreshed = await load();
      setPendingConfirmation(!refreshed); setMessage(refreshed ? "账号选择已确认；运行中的任务不受影响。" : ""); setSelection(undefined);
    } catch (e) { setSelection(undefined); await load(); setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="settings-app model-accounts-workspace">
    <SettingsSidebar page="accounts" />
    <main className="settings-main" id="content"><SettingsHeader page="accounts" />
      <div className="container">
        <header className="accounts-page-heading"><div className="accounts-page-title"><h1>多账号管理</h1><span className="accounts-result-count" role="status">{accounts ? `${filteredCount} 个账号` : error ? "读取失败" : "正在读取…"}</span></div>
          <div className="accounts-page-actions"><button type="button" className="icon-btn accounts-reload" aria-label="刷新列表" title="刷新列表" disabled={busy || disconnected} onClick={() => void load()}><Icon name="refresh-cw" /></button>
            <button type="button" className="btn btn-primary" disabled={busy || disconnected} onClick={() => { location.href = "/model-config.html?add-account=1"; }}><Icon name="plus" />添加账号</button></div></header>
        {disconnected && <p className="configuration-feedback" role="status">连接已断开，账号列表及额度可能不是最新状态；恢复连接后重新读取。</p>}
        {error && <p className="configuration-feedback" role="alert" data-error="true">{error}</p>}
        {accounts && !selectionConfirmed && <p className="configuration-feedback" role="status">{pendingConfirmation ? "切换请求已提交，当前账号尚未确认。请刷新列表后查看。" : "账号状态未确认，下方保留上次读取的记录；刷新列表后才能切换。"}</p>}
        {message && <p className="configuration-feedback" role="status">{message}</p>}
        {!!groups.length && <p className="accounts-selection-help">每个供应商分别选择启用账号；切换仅影响新任务。</p>}
        {showFilters && <div className="accounts-filters"><label className="accounts-search"><Icon name="search" /><input className="input" type="search" aria-label="搜索账号" placeholder="搜索账号、邮箱或供应商" value={query} onChange={e => setQuery(e.target.value)} /></label>
          {(groups.length > 1 || filter) && <Select label="筛选供应商" value={filter} onChange={setFilter} options={[{ value: "", label: "全部供应商" }, ...groups.map(group => ({ value: group.providerId, label: group.name }))]} />}
        </div>}
        <div className="account-provider-groups">
          {accounts && filteredGroups.map(group => <section className="account-provider-group" key={group.providerId} aria-label={`${group.name} 账号`}>
            <div className="account-group-heading"><h2>{group.name}</h2><span className="account-group-count">{group.accounts.length} 个账号</span><span className="account-group-selection">{selectionConfirmed ? "当前启用" : "上次选择"}：{groups.find(row => row.providerId === group.providerId)?.accounts.find(account => account.active)?.label || (selectionConfirmed ? "未启用" : "尚未确认")}</span></div>
            <div className="model-account-grid" data-extended={group.extended || undefined} aria-label="账号卡片">
              {group.accounts.map(account => <AccountCard key={account.id} account={account} revision={accounts.revision} confirmed={selectionConfirmed} disabled={busy || disconnected} activate={() => setSelection(account)} />)}
            </div>
          </section>)}
        </div>
        {accounts && !filteredCount && <div className="accounts-empty"><Icon name="search" /><h2>{groups.length ? "没有匹配的账号" : "暂无需要展示的账号"}</h2><p>{groups.length ? "换个搜索词，或清除当前筛选。" : <>订阅账号可单独展示，其他供应商需至少两个认证账号。</>}</p>
          {groups.length ? <button className="btn" type="button" onClick={() => { setQuery(""); setFilter(""); }}>清除筛选</button> : <a className="btn" href="/model-config.html">前往模型服务</a>}</div>}
      </div>
    </main>
    {selection && <Dialog title="切换账号" onClose={() => { if (!busy) setSelection(undefined); }} className="settings-dialog model-account-dialog"><p>将 {providerDisplayName(selection.providerId)} 切换为「{selection.label}」？</p>{!selectionConfirmed && <p className="configuration-feedback" role="status">账号状态尚未确认。请关闭此对话框并刷新列表后重试。</p>}<p className="field-help">新任务使用此账号；正在运行的任务保留原来的账号绑定，其他供应商不受影响。</p><div className="dialog-actions"><button className="btn btn-ghost" disabled={busy} onClick={() => setSelection(undefined)}>取消</button><button className="btn" disabled={busy || disconnected || !selectionConfirmed} onClick={() => void activate()}>{busy ? "正在切换…" : "确认切换"}</button></div></Dialog>}
  </div>;
}
