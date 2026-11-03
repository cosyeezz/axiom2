import type { ReactNode } from "react";
import { Icon } from "../Icon.js";
import { ProviderQuotaEstimate, type QuotaReference } from "./ProviderQuotaEstimate.js";
import { useProviderUsage } from "./useProviderUsage.js";
import { usageMetricPercent } from "../../shared/model-account-usage.js";
import { estimateTokenBalance, usageMetricValue, type UsageModelPricing, type ProviderUsage as Usage, type ProviderUsageMetric } from "../../shared/provider-usage.js";
import "../styles/provider-usage.css";

export function managementUrl(usage: Usage | undefined) {
  try {
    const url = new URL(usage?.management?.url ?? "");
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch { return; }
}

export const metricDeadline = (metric: ProviderUsageMetric) => metric.kind === "window" ? metric.resetsAt : metric.kind === "count" ? metric.expiresAt
  : metric.kind === "quota" ? metric.resetsAt ?? metric.expiresAt : undefined;
export function metricHint(metric: ProviderUsageMetric) {
  const at = metricDeadline(metric);
  const kind = metric.kind === "window" ? "窗口重置" : metric.kind === "quota" && metric.resetsAt !== undefined ? "重置" : metric.kind === "quota" ? "到期" : "最近到期";
  return `${metric.label}：${usageMetricValue(metric)}${at ? `；${kind}：${new Date(at).toLocaleString()}` : ""}`;
}
export const windowState = (metric: Extract<ProviderUsageMetric, { kind: "window" }>) => metric.limitReached ? "额度已达上限" : metric.allowed === false ? "当前不可用" : metric.allowed ? "可用" : "未达到限额";

/** Reference valuation from exact remaining Tokens and configured prices; never an official dollar balance. */
export function tokenEstimate(metrics: readonly ProviderUsageMetric[], pricing: readonly UsageModelPricing[]) {
  const balances = metrics.filter((metric): metric is Extract<ProviderUsageMetric, { kind: "tokens" }> => metric.kind === "tokens");
  const usd = (value: number) => value !== 0 && (value < .00005 || value >= 1e6) ? `$${value.toExponential(3)}` : `$${value.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
  const estimates = balances.flatMap(metric => { const value = estimateTokenBalance(metric, pricing); return value ? [`${metric.label} ${usd(value.low)}${value.high !== value.low ? `～${usd(value.high)}` : ""}`] : []; });
  const text = estimates.length ? `${estimates.join("；")}（当前配置价参考值，非美元余额）` : balances.length ? "暂不能估算（缺少对应模型的完整非阶梯价格或剩余 Token）" : "暂不能估算（上游未提供可换算的剩余 Token）";
  return { count: balances.length, text };
}
export const estimateTitle = "估值必须有可核对的剩余 Token，并按对应模型当前配置价格计算；百分比或点数不能直接换算美元。";

/** Provider summary and cached session view. Account cards render their fixed template in ModelAccountUsage. */
export function ProviderUsage({ providerId, revision, pricingProviderId = providerId, windowReference, accountId, enabled = true, progressMode = "used", accountMetadata, cached, children, toolbarActions }: { providerId: string; revision: string; pricingProviderId?: string; windowReference?: QuotaReference; accountId?: string; enabled?: boolean; progressMode?: "used" | "remaining"; accountMetadata?: Usage["account"]; cached?: Usage; children?: ReactNode | ((usage: Usage | undefined) => ReactNode); toolbarActions?: ReactNode }) {
  const { usage, pricing, busy, sampleRevision, connected, refresh: refreshNow } = useProviderUsage({ providerId, revision, pricingProviderId, accountId, enabled, cached });
  const accountDisplay = !!accountId || !!cached;
  const disconnected = !connected;
  const remaining = progressMode === "remaining";
  const label = (metric: ProviderUsageMetric) => remaining && metric.kind === "window" ? metric.label.replace(/已用$/, "") : metric.label;
  const progress = (metric: ProviderUsageMetric) => { const used = usageMetricPercent(metric); return used === undefined ? undefined : remaining ? 100 - used : used; };
  const email = usage?.account?.email, plan = usage?.account?.plan ?? accountMetadata?.plan;
  const subscriptionExpiresAt = usage?.account?.subscriptionExpiresAt;
  const management = managementUrl(usage);
  const blocked = !!usage?.accountStatus && usage.accountStatus.state !== "active";
  const metrics = blocked ? [] : usage?.metrics ?? [];
  const estimate = tokenEstimate(metrics, pricing);
  const stale = !!usage?.updatedAt && (usage.stale || disconnected);
  const title = [usage?.updatedAt ? `更新于 ${new Date(usage.updatedAt).toLocaleString()}` : "",
    usage?.nextRefreshAt ? `下次刷新 ${new Date(usage.nextRefreshAt).toLocaleString()}` : "",
    stale ? "旧数据" : "", usage?.message ?? ""].filter(Boolean).join("\n");
  const unqueryable = usage?.refreshable === false || usage?.status === "unsupported";
  const refresh = !cached && <button type="button" className="icon-btn provider-usage-refresh" aria-label="刷新供应商额度" disabled={busy || disconnected || unqueryable}
    title={title || "刷新额度"} onClick={refreshNow}><Icon name="refresh-cw" /><span>刷新额度</span></button>;
  const updated = usage?.updatedAt && <time className="provider-usage-updated" dateTime={new Date(usage.updatedAt).toISOString()}>更新于 {new Date(usage.updatedAt).toLocaleTimeString()}</time>;
  const managementLink = management && usage?.management && <a className="provider-usage-link" href={management} target="_blank" rel="noopener noreferrer">{usage.management.label}</a>;
  const facts = accountDisplay && (plan || email && email !== accountMetadata?.email) && <dl className="provider-usage-account">
      {email && email !== accountMetadata?.email && <div><dt>邮箱</dt><dd>{email}</dd></div>}
      {plan && <div><dt>{usage?.account?.plan ? "套餐" : "套餐（授权信息）"}</dt><dd>{plan}</dd></div>}
      {subscriptionExpiresAt !== undefined && <div><dt>订阅有效至</dt><dd><time dateTime={new Date(subscriptionExpiresAt).toISOString()}>{new Date(subscriptionExpiresAt).toLocaleString()}</time></dd></div>}
    </dl>;
  return <div className="provider-usage" aria-label="供应商额度" aria-busy={busy} data-stale={stale || undefined}>
    {facts}
    <div className="provider-usage-metrics" role="status" aria-live="polite" title={title}>
      {metrics.length ? metrics.map(metric => <div className="provider-usage-metric" key={metric.id} data-metric-kind={metric.kind} title={metricHint(metric)}>
        <span>{label(metric)}</span><strong className="num">{metric.kind === "window" ? remaining ? `剩余 ${progress(metric) === undefined ? "—" : `${Number(progress(metric)!.toFixed(1))}%`}` : `已用 ${usageMetricValue(metric)}` : metric.kind === "tokens" ? `剩余 ${usageMetricValue(metric)}` : usageMetricValue(metric)}</strong>
        {metric.kind === "tokens" && <span className="provider-usage-remaining">已用 {metric.used === null ? "—" : `${metric.used.toLocaleString("en-US")} Token`}</span>}
        {metric.kind === "window" && <span className="provider-usage-remaining">{remaining ? `已用 ${usageMetricValue(metric)}` : `剩余 ${metric.usedPercent === null ? "—" : `${Number(Math.max(0, 100 - metric.usedPercent).toFixed(1))}%`}`}</span>}
        {accountDisplay && metric.kind === "window" && (metric.limitReached !== undefined || metric.allowed !== undefined) && <span className="provider-usage-availability" data-blocked={metric.limitReached || metric.allowed === false || undefined}>{windowState(metric)}</span>}
        {accountDisplay && metric.kind === "balance" && metric.hasCredits && !metric.unlimited && metric.balance === null && <span className="provider-usage-remaining">有点数，余额未知</span>}
        {accountDisplay && metricDeadline(metric) && <time className="provider-usage-deadline" dateTime={new Date(metricDeadline(metric)!).toISOString()}>{metric.kind === "window" || metric.kind === "quota" && metric.resetsAt !== undefined ? "重置" : metric.kind === "quota" ? "到期" : "最近到期"} {new Date(metricDeadline(metric)!).toLocaleString()}</time>}
        {accountDisplay && metric.kind === "count" && !!metric.expiries?.length && <details className="provider-usage-expiries"><summary>重置券到期明细 · {metric.expiries.length}</summary><ol>{metric.expiries.map((at, index) => <li key={index}><time dateTime={new Date(at).toISOString()}>{new Date(at).toLocaleString()}</time></li>)}</ol><small>仅列出上游提供到期时间的可用重置券。</small></details>}
        {accountDisplay && progress(metric) !== undefined && <progress className="provider-usage-progress" max={100} value={progress(metric)} aria-label={`${label(metric)} ${remaining ? "剩余额度" : "用量"}`} title={metricHint(metric)} />}
      </div>) : <span className="provider-usage-note">{busy && !usage ? "额度查询中…" : usage?.message || (usage?.status === "unsupported" ? "暂未接入此供应商的官方额度查询。" : "额度暂不可用")}</span>}
      {stale && <span className="provider-usage-note">旧数据</span>}
      {!!usage?.metrics.length && usage.message && <span className="provider-usage-note" title={usage.message}>{usage.message}</span>}
      {managementLink}
    </div>
    {!blocked && !cached && (!windowReference || estimate.count > 0) && (!accountId || estimate.count > 0) && <p className="provider-usage-estimate" title={estimateTitle}>可用金额估计：{estimate.text}</p>}
    {!blocked && !cached && windowReference && usage && <ProviderQuotaEstimate usage={usage} reference={windowReference} revision={sampleRevision} enabled={enabled} />}
    {typeof children === "function" ? children(usage) : children}
    <div className="provider-usage-toolbar">{updated}{refresh}{toolbarActions}</div>
  </div>;
}
