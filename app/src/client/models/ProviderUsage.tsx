import { useEffect, useRef, useState, type ReactNode } from "react";
import { command, useConnectionState } from "../transport.js";
import { Icon } from "../Icon.js";
import { ProviderQuotaEstimate, type QuotaReference } from "./ProviderQuotaEstimate.js";
import { usageMetricPercent } from "../../shared/model-account-usage.js";
import { estimateTokenBalance, providerAccountStateLabel, usageMetricValue, usageRefreshMinimum, usageRefreshJitter, type UsageModelPricing, type ProviderUsage as Usage, type ProviderUsageMetric } from "../../shared/provider-usage.js";
import "../styles/provider-usage.css";

function managementUrl(usage: Usage | undefined) {
  try {
    const url = new URL(usage?.management?.url ?? "");
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch { return; }
}

const metricDeadline = (metric: ProviderUsageMetric) => metric.kind === "window" ? metric.resetsAt : metric.kind === "count" ? metric.expiresAt : undefined;
function metricHint(metric: ProviderUsageMetric) {
  const at = metricDeadline(metric);
  return `${metric.label}：${usageMetricValue(metric)}${at ? `；${metric.kind === "window" ? "窗口重置" : "最近到期"}：${new Date(at).toLocaleString()}` : ""}`;
}

/** Account cards group integer digits and mute the fraction without dropping precision; the exact upstream string stays in the title. */
function BalanceValue({ value }: { value: string }) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return <>{value}</>;
  const fraction = match[3];
  return <>{match[1]}{Number(match[2]).toLocaleString("en-US")}{fraction && <span className="metric-fraction">.{fraction}</span>}</>;
}

/** No provider-specific branches: all interpretation belongs to server-side adapters. */
export function ProviderUsage({ providerId, revision, pricingProviderId = providerId, windowReference, accountId, enabled = true, progressMode = "used", accountMetadata, cached, children, toolbarActions, summaryFirst = false, accountLayout = false, heading }: { providerId: string; revision: string; pricingProviderId?: string; windowReference?: QuotaReference; accountId?: string; enabled?: boolean; progressMode?: "used" | "remaining"; accountMetadata?: Usage["account"] & { accountId?: string; emailSource?: "token"; type?: "api_key" | "oauth"; expiresAt?: number }; cached?: Usage; children?: ReactNode | ((usage: Usage | undefined) => ReactNode); toolbarActions?: ReactNode; summaryFirst?: boolean; accountLayout?: boolean; heading?: string }) {
  const { connected, generation } = useConnectionState();
  const [queried, setUsage] = useState<Usage>();
  const usage = cached ?? queried, accountDisplay = !!accountId || !!cached;
  const [pricing, setPricing] = useState<UsageModelPricing[]>([]);
  const [busy, setBusy] = useState(false), [sampleRevision, setSampleRevision] = useState(0);
  const refreshAction = useRef<() => void>(() => {});
  useEffect(() => {
    if (!connected || !enabled || cached) { setBusy(false); return; }
    let disposed = false, running = false, poll = true, nextAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const minimum = accountId ? 60_000 : usageRefreshMinimum, jitter = accountId ? 10_000 : usageRefreshJitter;
    const fallbackDeadline = () => Date.now() + minimum + Math.floor(Math.random() * (jitter + 1));
    const schedule = () => {
      clearTimeout(timer); timer = undefined;
      if (!disposed && poll) timer = setTimeout(() => {
        timer = undefined;
        // Hidden views do not fetch. Becoming visible will catch up once, never replay missed cycles.
        if (document.visibilityState === "visible") void read(false);
      }, Math.max(1, nextAt - Date.now()));
    };
    const read = async (force: boolean) => {
      if (disposed || running) return;
      running = true; clearTimeout(timer); setBusy(true);
      try {
        const response = await command<Usage>(accountId ? "accounts.usage" : "usage.provider", { providerId, ...(accountId ? { accountId } : {}), refresh: force, ...(accountLayout && !force ? { cache: true } : {}) }, {}, crypto.randomUUID(), controller.signal);
        const result: Usage = accountLayout && !response.accountStatus && response.status !== "unsupported" && response.refreshable !== false
          ? { ...response, status: "unavailable", metrics: [], account: undefined, updatedAt: undefined, stale: undefined,
            accountStatus: { state: "unknown", checkedAt: Date.now() }, message: "账号状态无法确认，已停止后续查询；请重试。" }
          : response;
        if (!disposed && result.providerId === providerId) {
          setUsage(result); if (force) setSampleRevision(value => value + 1);
          // Account cards read the cache by default and never poll; only “重新查询” reaches upstream again.
          poll = !accountLayout && result.refreshable !== false && result.status !== "unsupported" && result.accountStatus?.state !== "disabled" && result.accountStatus?.state !== "unauthorized";
          if ((result.accountStatus?.state === "active" || !accountLayout && !result.accountStatus) && result.metrics.some(metric => metric.kind === "tokens")) {
            const prices = await command<UsageModelPricing[]>("usage.pricing", { providerId: pricingProviderId }, {}, crypto.randomUUID(), controller.signal).catch(() => []);
            if (!disposed) setPricing(prices);
          } else setPricing([]);
          nextAt = Number.isFinite(result.nextRefreshAt) && result.nextRefreshAt! > Date.now()
            ? Math.min(result.nextRefreshAt!, Date.now() + minimum + jitter) : fallbackDeadline();
        }
      } catch {
        if (accountLayout) poll = false;
        nextAt = fallbackDeadline();
        if (!disposed) setUsage(previous => accountLayout
          ? { providerId, status: "unavailable", metrics: [], accountStatus: { state: "unknown", checkedAt: Date.now() }, message: "账号状态无法确认，已停止后续查询；请重试。" }
          : previous?.updatedAt ? { ...previous, stale: true, message: "刷新失败，当前为上次查询结果。" }
          : { providerId, status: "unavailable", metrics: [], message: "额度暂不可用，请稍后重试。" });
      } finally {
        running = false;
        if (!disposed) { if (nextAt <= Date.now()) nextAt = fallbackDeadline(); setBusy(false); schedule(); }
      }
    };
    const visible = () => { if (document.visibilityState === "visible" && poll) { if (nextAt <= Date.now()) void read(false); else schedule(); } };
    refreshAction.current = () => { void read(true); };
    if (document.visibilityState === "visible") void read(false);
    document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; refreshAction.current = () => {}; controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [providerId, accountId, pricingProviderId, revision, connected, generation, enabled, !!cached, accountLayout]);
  const disconnected = !connected;
  const remaining = progressMode === "remaining";
  const label = (metric: ProviderUsageMetric) => remaining && metric.kind === "window" ? metric.label.replace(/已用$/, "") : metric.label;
  const progress = (metric: ProviderUsageMetric) => { const used = usageMetricPercent(metric); return used === undefined ? undefined : remaining ? 100 - used : used; };
  const email = usage?.account?.email, plan = usage?.account?.plan ?? accountMetadata?.plan;
  const upstreamAccountId = usage?.account?.accountId ?? accountMetadata?.accountId;
  const subscriptionExpiresAt = usage?.account?.subscriptionExpiresAt;
  const identity = email || accountMetadata?.email || upstreamAccountId || "";
  const identitySource = email ? "官方查询邮箱" : accountMetadata?.email ? "授权信息邮箱" : "账号 ID";
  const differentEmail = !!email && !!accountMetadata?.email && email !== accountMetadata.email;
  const identityTitle = `${identitySource}：${identity}${!email && accountMetadata?.emailSource === "token" && identity === accountMetadata.email ? " · 授权信息来自授权令牌，未独立验证邮箱" : ""}`;
  const management = managementUrl(usage);
  const blocked = accountLayout ? usage?.accountStatus?.state !== "active" : !!usage?.accountStatus && usage.accountStatus.state !== "active";
  const balances = (blocked ? [] : usage?.metrics)?.filter((metric): metric is Extract<ProviderUsageMetric, { kind: "tokens" }> => metric.kind === "tokens") ?? [];
  const usd = (value: number) => value !== 0 && (value < .00005 || value >= 1e6) ? `$${value.toExponential(3)}` : `$${value.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
  const estimates = balances.flatMap(metric => { const value = estimateTokenBalance(metric, pricing); return value ? [`${metric.label} ${usd(value.low)}${value.high !== value.low ? `～${usd(value.high)}` : ""}`] : []; });
  const estimate = estimates.length ? `${estimates.join("；")}（当前配置价参考值，非美元余额）` : balances.length ? "暂不能估算（缺少对应模型的完整非阶梯价格或剩余 Token）" : "暂不能估算（上游未提供可换算的剩余 Token）";
  const stale = !!usage?.updatedAt && (usage.stale || disconnected);
  const title = [usage?.updatedAt ? `更新于 ${new Date(usage.updatedAt).toLocaleString()}` : "",
    usage?.nextRefreshAt ? `下次刷新 ${new Date(usage.nextRefreshAt).toLocaleString()}` : "",
    stale ? "旧数据" : "", usage?.message ?? ""].filter(Boolean).join("\n");
  const metrics = blocked ? [] : usage?.metrics ?? [];
  const presentedMetrics = summaryFirst ? [...metrics.filter(metric => metric.kind === "balance" || metric.kind === "count"), ...metrics.filter(metric => metric.kind !== "balance" && metric.kind !== "count")] : metrics;
  const unqueryable = usage?.refreshable === false || usage?.status === "unsupported";
  const refresh = !cached && (!accountLayout || !unqueryable) && <button type="button" className="icon-btn provider-usage-refresh" aria-label={accountLayout && usage && !metrics.length ? "重试刷新供应商额度" : "刷新供应商额度"} disabled={busy || disconnected || unqueryable}
    title={title || "刷新额度"} onClick={() => refreshAction.current()}><Icon name="refresh-cw" /><span>{accountLayout ? "重新查询" : "刷新额度"}</span></button>;
  const updated = usage?.updatedAt && <time className="provider-usage-updated" dateTime={new Date(usage.updatedAt).toISOString()}>更新于 {accountLayout && new Date(usage.updatedAt).toDateString() !== new Date().toDateString() ? new Date(usage.updatedAt).toLocaleString() : new Date(usage.updatedAt).toLocaleTimeString()}</time>;
  const managementLink = management && usage?.management && <a className="provider-usage-link" href={management} target="_blank" rel="noopener noreferrer">{usage.management.label}{accountLayout && <Icon name="external-link" />}</a>;
  // Identity first (who), quota next (how much), low-frequency facts last; DOM order equals visual order.
  const profile = accountLayout && (identity || accountMetadata?.type === "oauth") && <dl className="account-profile">
      <div data-wide><dt>{email || accountMetadata?.email || !upstreamAccountId ? "邮箱" : "账号 ID"}</dt><dd className="account-card-identity" title={identityTitle}>{identity || "本地授权未提供"}</dd></div>
    </dl>;
  const facts = accountDisplay && (plan || accountLayout && (accountMetadata?.type === "oauth" || upstreamAccountId && (email || accountMetadata?.email)) || !accountLayout && email && email !== accountMetadata?.email) && <dl className="provider-usage-account">
      {!accountLayout && email && email !== accountMetadata?.email && <div><dt>邮箱</dt><dd>{email}</dd></div>}
      {(plan || accountLayout) && <div><dt>{usage?.account?.plan || !plan ? "套餐" : "套餐（授权信息）"}</dt><dd className={accountLayout && plan ? "account-plan" : undefined}>{plan || "本地授权未提供"}</dd></div>}
      {subscriptionExpiresAt !== undefined && <div><dt>订阅有效至</dt><dd><time dateTime={new Date(subscriptionExpiresAt).toISOString()}>{new Date(subscriptionExpiresAt).toLocaleString()}</time></dd></div>}
    </dl>;
  // Credential facts stay out of the plan list so `.provider-usage-account` keeps its subscription-only meaning.
  const credential = accountLayout && (accountMetadata?.expiresAt !== undefined || upstreamAccountId && (email || accountMetadata?.email)) && <dl className="account-credential">
      {accountMetadata?.expiresAt !== undefined && <div><dt>令牌有效期</dt><dd><time dateTime={new Date(accountMetadata.expiresAt).toISOString()}>{new Date(accountMetadata.expiresAt).toLocaleString()}</time></dd></div>}
      {upstreamAccountId && (email || accountMetadata?.email) && <div data-wide><dt>账号 ID</dt><dd className="num">{upstreamAccountId}</dd></div>}
    </dl>;
  const factBlock = (facts || credential) && (accountLayout ? <div className="account-facts">{facts}{credential}</div> : facts);
  const quotaFirst = accountLayout && !!metrics.length;
  const windowState = (metric: Extract<ProviderUsageMetric, { kind: "window" }>) => metric.limitReached ? "额度已达上限" : metric.allowed === false ? "当前不可用" : metric.allowed ? "可用" : "未达到限额";
  return <div className="provider-usage" aria-label="供应商额度" aria-busy={busy} data-stale={stale || undefined} data-layout={accountLayout ? "account" : undefined} data-empty={accountLayout && !metrics.length || undefined}>
    {accountLayout && (usage?.accountStatus || profile) && <div className="account-identity-row">
      {usage?.accountStatus && <p className="provider-account-status" data-state={usage.accountStatus.state} title={`检查于 ${new Date(usage.accountStatus.checkedAt).toLocaleString()}`} role="status">账号状态：{providerAccountStateLabel(usage.accountStatus.state)}{stale ? "（上次检查）" : ""}</p>}
      {profile}
    </div>}
    {accountLayout && differentEmail && <p className="account-identity-source">官方查询邮箱与授权邮箱不同。授权邮箱：<span>{accountMetadata?.email}</span>{accountMetadata?.emailSource === "token" && "（来自授权令牌，未独立验证）"}</p>}
    {accountLayout && !email && accountMetadata?.email && accountMetadata.emailSource === "token" && <p className="account-identity-source">邮箱来自授权令牌，未独立验证，仅作账号区分。</p>}
    {!quotaFirst && factBlock}
    {accountLayout && !!metrics.length && <div className="account-usage-heading">{heading && <h4>{heading}</h4>}</div>}
    <div className="provider-usage-metrics" role="status" aria-live="polite" title={title}>
      {presentedMetrics.length ? presentedMetrics.map(metric => <div className="provider-usage-metric" key={metric.id} data-metric-kind={metric.kind} data-exhausted={accountLayout && metric.kind === "window" && (metric.limitReached || progress(metric) === 0) || undefined} title={metricHint(metric)}>
        <span>{label(metric)}</span><strong className="num">{metric.kind === "window" ? remaining ? `剩余 ${progress(metric) === undefined ? "—" : `${Number(progress(metric)!.toFixed(1))}%`}` : `已用 ${usageMetricValue(metric)}` : metric.kind === "tokens" ? `剩余 ${usageMetricValue(metric)}`
          : accountLayout && metric.kind === "balance" && metric.balance && !metric.unlimited ? <span title={`原始值 ${metric.balance}`}><BalanceValue value={metric.balance} /></span>
          : accountLayout && metric.kind === "count" && metric.count !== null ? <>{metric.count}<small className="metric-unit"> 次</small></> : usageMetricValue(metric)}</strong>
        {metric.kind === "tokens" && <span className="provider-usage-remaining">已用 {metric.used === null ? "—" : `${metric.used.toLocaleString("en-US")} Token`}</span>}
        {metric.kind === "window" && !(accountLayout && remaining) && <span className="provider-usage-remaining">{remaining ? `已用 ${usageMetricValue(metric)}` : `剩余 ${metric.usedPercent === null ? "—" : `${Number(Math.max(0, 100 - metric.usedPercent).toFixed(1))}%`}`}</span>}
        {accountDisplay && metric.kind === "window" && (metric.limitReached !== undefined || metric.allowed !== undefined) && (!accountLayout || windowState(metric) !== "可用" && windowState(metric) !== "未达到限额") && <span className="provider-usage-availability" data-blocked={metric.limitReached || metric.allowed === false || undefined}>{windowState(metric)}</span>}
        {accountDisplay && metric.kind === "balance" && metric.hasCredits && !metric.unlimited && metric.balance === null && <span className="provider-usage-remaining">有点数，余额未知</span>}
        {accountDisplay && metricDeadline(metric) && <time className="provider-usage-deadline" dateTime={new Date(metricDeadline(metric)!).toISOString()}>{accountLayout && remaining && metric.kind === "window" ? `已用 ${usageMetricValue(metric)} · ` : ""}{metric.kind === "window" ? "重置" : "最近到期"} {new Date(metricDeadline(metric)!).toLocaleString()}</time>}
        {accountDisplay && metric.kind === "count" && !!metric.expiries?.length && <details className="provider-usage-expiries"><summary>重置券到期明细 · {metric.expiries.length}</summary><ol>{metric.expiries.map((at, index) => <li key={index}><time dateTime={new Date(at).toISOString()}>{new Date(at).toLocaleString()}</time></li>)}</ol><small>仅列出上游提供到期时间的可用重置券。</small></details>}
        {accountDisplay && progress(metric) !== undefined && <progress className="provider-usage-progress" max={100} value={progress(metric)} aria-label={`${label(metric)} ${remaining ? "剩余额度" : "用量"}`} title={metricHint(metric)} />}
      </div>) : accountLayout ? <div className="account-usage-empty" data-unqueryable={unqueryable || undefined}>
        <div className="account-usage-state"><span>{!usage ? busy ? accountLayout ? "正在检查账号状态…" : "正在查询额度…" : "等待查询额度" : unqueryable ? "暂不支持查询额度" : "额度暂不可用"}</span>{refresh}</div>
        {usage?.message && <p className="provider-usage-note">{usage.message}</p>}
      </div> : <span className="provider-usage-note">{busy && !usage ? "额度查询中…" : usage?.message || (usage?.status === "unsupported" ? "暂未接入此供应商的官方额度查询。" : "额度暂不可用")}</span>}
      {stale && <span className="provider-usage-note">旧数据</span>}
      {!!usage?.metrics.length && usage.message && <span className="provider-usage-note" title={usage.message}>{usage.message}</span>}
      {!accountLayout && managementLink}
    </div>
    {!blocked && !cached && (!windowReference || balances.length > 0) && (!accountId || balances.length > 0) && <p className="provider-usage-estimate" title="估值必须有可核对的剩余 Token，并按对应模型当前配置价格计算；百分比或点数不能直接换算美元。">可用金额估计：{estimate}</p>}
    {quotaFirst && factBlock}
    {!blocked && !cached && windowReference && usage && <ProviderQuotaEstimate usage={usage} reference={windowReference} revision={sampleRevision} enabled={enabled} />}
    {typeof children === "function" ? children(usage) : children}
    {(!accountLayout || updated || toolbarActions || managementLink || quotaFirst) && <div className="provider-usage-toolbar">{updated}{!accountLayout ? refresh : <>{managementLink}{quotaFirst && refresh}</>}{toolbarActions}</div>}
  </div>;
}
