import { useEffect, useRef, useState } from "react";
import { Dialog, Icon } from "../components.js";
import { Select } from "../Select.js";
import { command, useConnectionState, useScope } from "../transport.js";
import { accountQuotaReference, accountStatusChip, ModelAccountUsage, useCopyFeedback, useModelAccountUsage } from "./ModelAccountUsage.js";
import { ProviderQuotaEstimate } from "./ProviderQuotaEstimate.js";
import { estimateTitle, tokenEstimate } from "./ProviderUsage.js";
import { AccountIcon } from "./AccountIcon.js";
import { accountIconOptions, defaultAccountIcon, setAccountIcon, useAccountIcon } from "./account-icons.js";
import { providerDisplayName } from "../../shared/model-providers.js";
import { modelAccountPresentation } from "../../shared/model-account-presentation.js";
import type { ModelAccount, ModelAccounts } from "../../shared/model-accounts.js";
import { providerAccountStateLabel, usageMetricValue } from "../../shared/provider-usage.js";
import "../styles/model-accounts.css";

type Action = "activate" | "rename" | "remove";
function AccountCard({ account, revision, confirmed, disabled, action }: {
  account: ModelAccount; revision: string; confirmed: boolean; disabled: boolean; action: (action: Action) => void;
}) {
  const ref = useRef<HTMLElement>(null), [visible, setVisible] = useState(false), [details, setDetails] = useState(false), [picking, setPicking] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { rootMargin: "100px" });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const presentation = modelAccountPresentation(account);
  const state = useModelAccountUsage(account, revision, visible && confirmed), { usage } = state;
  const { feedback, copy } = useCopyFeedback();
  const expired = account.expiresAt !== undefined && account.expiresAt <= Date.now();
  const authLabel = account.type === "oauth" ? "OAuth" : account.type === "api_key" ? "API Key" : "认证缺失";
  const stale = !!usage?.updatedAt && (!!usage.stale || !state.connected);
  const chip = accountStatusChip(account, usage, stale);
  const estimateReference = accountQuotaReference(account), estimate = tokenEstimate(usage?.accountStatus?.state === "active" ? usage.metrics : [], state.pricing);
  const email = usage?.account?.email, plan = usage?.account?.plan ?? account.plan;
  const upstreamAccountId = usage?.account?.accountId ?? account.accountId;
  const identity = email || account.email || upstreamAccountId || "";
  const identitySource = email ? "官方查询邮箱" : account.email ? "授权信息邮箱" : "账号 ID";
  const identityTitle = `${identitySource}：${identity}${!email && account.emailSource === "token" && identity === account.email ? " · 授权信息来自授权令牌，未独立验证邮箱" : ""}${email && account.email && email !== account.email ? ` · 授权邮箱：${account.email}${account.emailSource === "token" ? "（来自授权令牌，未独立验证）" : ""}` : ""}`;
  const differentEmail = !!email && !!account.email && email !== account.email;
  const unqueryable = usage?.refreshable === false || usage?.status === "unsupported";
  const provider = providerDisplayName(account.providerId);
  const chosenIcon = useAccountIcon(account.id), fallbackIcon = defaultAccountIcon(account.providerId), icon = chosenIcon ?? fallbackIcon;
  return <article ref={ref} className="model-account-card" data-presentation={presentation.kind} data-active={account.active} data-confirmed={confirmed} aria-label={`账号 ${account.label}`}>
    <header className="account-card-header">
      <button type="button" className="account-card-avatar" aria-label="选择卡片图标" data-tooltip={`${provider} · 选择图标`} data-icon={icon} onClick={() => setPicking(true)}><AccountIcon choice={icon} /></button>
      <div className="account-card-title">
        <div className="account-card-heading"><h3 title={`${account.label} · 双击修改名称`}><button type="button" className="account-card-name" aria-label={`修改账号名称：${account.label}`} disabled={disabled} onDoubleClick={() => action("rename")} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); action("rename"); } }}>{account.label}</button></h3>
          {account.active && <span className="account-active-mark" role="status">{confirmed ? "默认账号" : "上次默认"}</span>}
          {plan && <span className="account-plan-badge" title={usage?.account?.plan ? "套餐" : "套餐（授权信息）"}>{plan}</span>}
          <span className="account-auth-badge" title={[authLabel, account.region].filter(Boolean).join(" · ")}>{authLabel}</span></div>
        {(identity || account.type === "oauth") && <p className="account-card-identity" title={identity ? identityTitle : undefined}>{identity || "本地授权未提供"}</p>}
        {account.region && <p className="account-card-meta" title={account.region}>{account.region}</p>}
      </div>
      <div className="account-card-tools">
        <button type="button" className="icon-btn" aria-label="刷新供应商额度" data-tooltip="刷新额度" disabled={state.busy || !state.connected || !confirmed || unqueryable} onClick={state.refresh}><Icon name="refresh-cw" /></button>
        {!account.active && <button type="button" className="icon-btn" aria-label="设为默认" data-tooltip="设为默认" disabled={disabled || !account.type} onClick={() => action("activate")}><Icon name="star" /></button>}
        <button type="button" className="icon-btn" aria-label="改名" data-tooltip="改名" disabled={disabled} onClick={() => action("rename")}><Icon name="square-pen" /></button>
        <button type="button" className="icon-btn account-remove" aria-label="删除" data-tooltip="删除" disabled={disabled} onClick={() => action("remove")}><Icon name="trash-2" /></button>
      </div>
    </header>
    <ModelAccountUsage account={account} state={state} copy={copy} onDetails={() => setDetails(true)}
      status={<span className="account-status-chip" data-state={chip.state} title={chip.title}><span className="sr-only">账号状态：</span>{chip.text}</span>}
      notice={feedback && <span className="account-copy-feedback" role="status">{feedback}</span>} />
    {picking && <Dialog title={`选择卡片图标：${account.label}`} onClose={() => setPicking(false)} className="settings-dialog model-account-dialog">
      <p className="field-help">仅改变本机卡片显示，不影响认证、默认账号或请求路由。</p>
      <div className="account-icon-options" role="group" aria-label="可选图标">
        {accountIconOptions.map(option => <button type="button" key={option.value} className="account-icon-option" aria-pressed={icon === option.value} onClick={() => { setAccountIcon(account.id, option.value === fallbackIcon ? undefined : option.value); setPicking(false); }}>
          <AccountIcon choice={option.value} /><span>{option.label}{option.value === fallbackIcon && "（默认）"}</span></button>)}
      </div>
      <div className="dialog-actions"><button className="btn btn-ghost" type="button" disabled={!chosenIcon} onClick={() => { setAccountIcon(account.id, undefined); setPicking(false); }}>恢复默认</button><button className="btn" type="button" onClick={() => setPicking(false)}>关闭</button></div>
    </Dialog>}
    {details && <Dialog title={`账号详情：${account.label}`} onClose={() => setDetails(false)} className="settings-dialog model-account-dialog">
      <dl className="account-info-list">
        <div><dt>连接</dt><dd>{account.providerId}</dd></div>
        <div><dt>区域</dt><dd>{account.region || "供应商默认"}</dd></div>
        <div><dt>认证</dt><dd>{authLabel}{expired && " · 令牌已过期"}</dd></div>
        {usage?.accountStatus && <div><dt>账号状态</dt><dd>{providerAccountStateLabel(usage.accountStatus.state)}<small> · 检查于 {new Date(usage.accountStatus.checkedAt).toLocaleString()}</small></dd></div>}
        <div><dt>邮箱</dt><dd>{usage?.account?.email || account.email || "供应商未提供"}{!usage?.account?.email && account.emailSource === "token" && <small> · 来自授权令牌，仅作账号区分</small>}</dd></div>
        {differentEmail && <div><dt>授权邮箱</dt><dd>{account.email}{account.emailSource === "token" && <small> · 来自授权令牌，未独立验证</small>}</dd></div>}
        {(usage?.account?.plan || account.plan) && <div><dt>{usage?.account?.plan ? "套餐" : "套餐（授权信息）"}</dt><dd>{usage?.account?.plan || account.plan}</dd></div>}
        {upstreamAccountId && <div><dt>账号 ID</dt><dd>{upstreamAccountId}<button type="button" className="icon-btn" aria-label="复制账号 ID" onClick={() => copy("账号 ID", upstreamAccountId)}><Icon name="copy" /></button></dd></div>}
        {usage?.account?.subscriptionExpiresAt !== undefined && <div><dt>订阅有效至</dt><dd>{new Date(usage.account.subscriptionExpiresAt).toLocaleString()}</dd></div>}
        {account.login?.method && <div><dt>登录方式</dt><dd>{{ "builder-id": "AWS Builder ID", "identity-center": "企业 IAM Identity Center", social: "Google / GitHub" }[account.login.method]}</dd></div>}
        {account.login?.startUrl && <div><dt>企业 Start URL</dt><dd>{account.login.startUrl}</dd></div>}
        {account.login?.authRegion && <div><dt>认证区域</dt><dd>{account.login.authRegion}</dd></div>}
        {account.login?.flow && <div><dt>授权流程</dt><dd>{account.login.flow === "device" ? "设备授权" : "浏览器 PKCE"}</dd></div>}
        {account.expiresAt !== undefined && <div><dt>令牌有效期</dt><dd>{new Date(account.expiresAt).toLocaleString()}</dd></div>}
      </dl>
      {usage?.accountStatus?.state === "active" && !!usage.metrics.length && <dl className="account-info-list account-detail-metrics" aria-label="完整额度明细">{usage.metrics.map(metric => <div key={metric.id}>
        <dt>{metric.label}</dt><dd>{usageMetricValue(metric)}
          {"resetsAt" in metric && metric.resetsAt !== undefined && <small> · 重置 {new Date(metric.resetsAt).toLocaleString()}</small>}
          {"expiresAt" in metric && metric.expiresAt !== undefined && <small> · 到期 {new Date(metric.expiresAt).toLocaleString()}</small>}
          {metric.kind === "window" && (metric.limitReached || metric.allowed === false) && <small> · {metric.limitReached ? "额度已达上限" : "当前不可用"}</small>}
          {metric.kind === "count" && !!metric.expiries?.length && <ol aria-label="重置券到期明细">{metric.expiries.map((at, index) => <li key={index}><time dateTime={new Date(at).toISOString()}>{new Date(at).toLocaleString()}</time></li>)}</ol>}
        </dd></div>)}</dl>}
      {estimate.count > 0 && <p className="field-help" title={estimateTitle}>可用金额估计：{estimate.text}</p>}
      {usage?.accountStatus?.state === "active" && estimateReference && <ProviderQuotaEstimate usage={usage} reference={estimateReference} revision={state.sampleRevision} enabled={state.enabled} />}
      {usage?.message && <p className="field-help">{usage.message}</p>}
      {feedback && <p role="status">{feedback}</p>}
      <p className="field-help">普通令牌刷新保留此账号；手动登录始终新增账号。额度查询本身不会刷新令牌，认证已保存也不代表调用已验证。</p>
      <div className="dialog-actions"><button className="btn" type="button" onClick={() => setDetails(false)}>关闭</button></div>
    </Dialog>}
  </article>;
}

export function ProviderAccounts({ providerId, blocked, add, changed, busyChanged }: {
  providerId: string; blocked: boolean; add: () => void; changed: () => Promise<unknown>; busyChanged: (busy: boolean) => void;
}) {
  const connection = useConnectionState(), invalidation = useScope("model-accounts", { revision: 0 });
  const currentConnection = useRef(connection); currentConnection.current = connection;
  const [accounts, setAccounts] = useState<ModelAccounts>(), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false), [confirmedGeneration, setConfirmedGeneration] = useState(-1), [query, setQuery] = useState("");
  const [selection, setSelection] = useState<{ account: ModelAccount; action: Action }>();
  const [label, setLabel] = useState(""), [replacement, setReplacement] = useState(""), [stopRequired, setStopRequired] = useState(false);
  const readGeneration = useRef(0), writing = useRef(false);
  const load = async () => {
    const generation = ++readGeneration.current, socket = currentConnection.current.generation;
    try {
      const result = await command<ModelAccounts>("accounts.list");
      if (generation !== readGeneration.current || socket !== currentConnection.current.generation || !currentConnection.current.connected) return undefined;
      setAccounts(result); setConfirmedGeneration(socket); setError("");
      return true;
    } catch (cause) {
      if (generation === readGeneration.current) { setError((cause as Error).message); setConfirmedGeneration(-1); }
      return false;
    }
  };
  useEffect(() => {
    if (connection.connected) void load();
    return () => { readGeneration.current++; };
  }, [connection.connected, connection.generation, invalidation.revision, providerId]);
  const confirmed = connection.connected && confirmedGeneration === connection.generation;
  const disabled = blocked || busy || !confirmed;
  const rows = (accounts?.accounts.filter(account => account.providerId === providerId) ?? [])
    .sort((a, b) => Number(b.active) - Number(a.active));
  const filtered = rows.filter(account => `${account.label} ${account.email || ""} ${account.region} ${account.accountId || ""}`.toLowerCase().includes(query.toLowerCase()));
  const others = rows.filter(account => account.id !== selection?.account.id);
  const needsReplacement = selection?.action === "remove" && selection.account.active && others.length > 0;
  const choose = (account: ModelAccount, action: Action) => {
    setSelection({ account, action }); setLabel(account.label); setReplacement(""); setStopRequired(false); setError("");
  };
  const mutate = async () => {
    if (!selection || !accounts || disabled || writing.current) return;
    writing.current = true; setBusy(true); busyChanged(true); setError(""); setMessage(""); readGeneration.current++;
    try {
      await command(`accounts.${selection.action}`, { accountId: selection.account.id, revision: accounts.revision,
        ...(selection.action === "rename" ? { label: label.trim() } : {}),
        ...(selection.action === "remove" ? { replacementId: replacement || undefined, confirmStop: stopRequired } : {}) });
      setSelection(undefined);
      const refreshed = await load();
      if (refreshed !== undefined) setMessage(refreshed ? selection.action === "activate" ? "默认账号已更新；正在运行的执行仍使用原账号。" : selection.action === "rename" ? "账号名称已保存。" : "账号已删除；其他账号、连接和模型配置均保留。" : "操作已提交，当前状态尚未确认；请刷新列表。");
      await changed();
    } catch (cause) {
      const error = cause as Error & { code?: string };
      await load();
      await changed();
      if (error.code === "ACTIVE_RUNS_CONFIRMATION_REQUIRED") setStopRequired(true);
      else setSelection(undefined);
      setError(error.message);
    } finally { writing.current = false; setBusy(false); busyChanged(false); }
  };
  return <section className="provider-accounts" aria-label="连接账号">
    <header className="row-between accounts-page-heading"><div><h3>账号与认证</h3><p className="field-help">每次登录新增一张账号卡。默认账号仅影响未来执行，连接与模型由这些账号共用。</p></div>
      <div className="row"><button type="button" className="icon-btn" aria-label="刷新账号列表" disabled={busy || !connection.connected} onClick={() => void load()}><Icon name="rotate-cw" /></button>
        <button type="button" className="btn btn-primary" disabled={blocked || busy || !connection.connected} onClick={add}><Icon name="plus" />添加账号</button></div></header>
    {!connection.connected && <p className="configuration-feedback" role="status">连接已断开，以下为上次读取的账号；恢复连接后重新确认。</p>}
    {blocked && <p className="field-help">请先保存或放弃当前草稿，再添加或管理账号。</p>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    {message && <p className="configuration-feedback" role="status">{message}</p>}
    {accounts && !confirmed && connection.connected && <p role="status">账号状态未确认，请刷新列表后再操作。</p>}
    {rows.length > 1 && <input className="input accounts-search" type="search" aria-label="搜索账号" placeholder="搜索账号、邮箱或备注" value={query} onChange={event => setQuery(event.target.value)} />}
    <div className="model-account-grid" data-extended={rows.some(account => modelAccountPresentation(account).kind !== "generic") || undefined} aria-label="账号卡片">
      {filtered.map(account => <AccountCard key={account.id} account={account} revision={accounts!.revision} confirmed={confirmed} disabled={disabled} action={action => choose(account, action)} />)}
    </div>
    {!accounts ? <p role="status">{error ? "账号列表读取失败，可手动刷新。" : "正在读取账号…"}</p> : !filtered.length && <div className="accounts-empty"><p>{rows.length ? "没有匹配的账号。" : "此连接尚无已保存账号。添加首个账号后会自动设为默认。"}</p>{query && <button className="btn" onClick={() => setQuery("")}>清除搜索</button>}</div>}
    {selection && <Dialog title={selection.action === "activate" ? "设为默认账号" : selection.action === "rename" ? "修改账号名称" : "删除账号"} onClose={() => { if (!busy) setSelection(undefined); }} className="settings-dialog model-account-dialog">
      <p>{selection.account.label}</p>
      {selection.action === "rename" ? <div className="field"><label htmlFor="rename-account">账号名称</label><input autoFocus id="rename-account" className="input" value={label} maxLength={160} disabled={busy} onChange={event => setLabel(event.target.value)} /></div>
        : selection.action === "activate" ? <p className="field-help">未来执行使用此账号；正在运行的执行保留原来的账号绑定。</p>
          : <><p className="field-help">仅删除此账号的本地认证与卡片；不会删除连接、模型或其他账号，也不会撤销供应商网站上的授权或修改外部环境认证；删除最后一个账号后，这类外部认证仍可能可用。</p>
            {needsReplacement && <div className="field"><label htmlFor="replacement-account">下一个默认账号</label><Select id="replacement-account" label="下一个默认账号" value={replacement} disabled={busy} onChange={setReplacement} options={[{ value: "", label: "请选择默认账号" }, ...others.filter(account => account.type).map(account => ({ value: account.id, label: account.label }))]} /></div>}
            {stopRequired && <p className="auth-error" role="alert">此连接仍有执行或排队任务。继续将停止同连接所有账号的相关执行（包括记忆、压缩和子任务），再删除此账号；停止不会回滚项目文件。</p>}</>}
      {!confirmed && <p role="status">账号状态尚未确认，请关闭弹窗并刷新列表。</p>}
      <div className="dialog-actions"><button className="btn btn-ghost" disabled={busy} onClick={() => setSelection(undefined)}>取消</button><button className="btn btn-primary" disabled={disabled || selection.action === "rename" && !label.trim() || !!needsReplacement && !replacement} onClick={() => void mutate()}>{busy ? "处理中…" : stopRequired ? "停止执行并删除" : selection.action === "remove" ? "确认删除" : "确认"}</button></div>
    </Dialog>}
  </section>;
}
