import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../Icon.js";
import { ProviderQuotaEstimate } from "./ProviderQuotaEstimate.js";
import { estimateTitle, metricHint, tokenEstimate } from "./ProviderUsage.js";
import { useProviderUsage } from "./useProviderUsage.js";
import { providerDisplayName } from "../../shared/model-providers.js";
import type { ModelAccount } from "../../shared/model-accounts.js";
import { modelAccountPresentation } from "../../shared/model-account-presentation.js";
import { usageMetricPercent } from "../../shared/model-account-usage.js";
import { providerAccountStateLabel, usageMetricValue, type ProviderUsage as Usage, type ProviderUsageMetric } from "../../shared/provider-usage.js";

type Window = Extract<ProviderUsageMetric, { kind: "window" }>;
type Quota = Extract<ProviderUsageMetric, { kind: "quota" }>;
/** One uniform information row. Providers contribute data only; the card owns layout. */
export type AccountInfoRow = { id: string; label: string; value: ReactNode; icon?: string; note?: ReactNode; title?: string; className?: string;
  /** Optional trailing glyph. Without onClick it is decorative and never looks clickable. */
  action?: { icon: string; label: string; onClick?: () => void } };

const time = (at: number, text = new Date(at).toLocaleString()) => <time dateTime={new Date(at).toISOString()}>{text}</time>;
/** Short reset time for the cycle row; the full timestamp stays in the title. */
const shortTime = (at: number) => {
  const date = new Date(at), clock = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return <time dateTime={date.toISOString()} title={date.toLocaleString()}>{date.toDateString() === new Date().toDateString() ? clock : `${date.getMonth() + 1}/${date.getDate()} ${clock}`}</time>;
};

/** Account quota request: cache first, status-gated, manual refresh only. */
export function useModelAccountUsage(account: ModelAccount, revision: string, enabled: boolean) {
  return { ...useProviderUsage({ providerId: account.providerId, revision, accountId: account.id, enabled, accountLayout: true }), enabled };
}
export type ModelAccountUsageState = ReturnType<typeof useModelAccountUsage>;

export function AccountInfoRows({ rows, className = "" }: { rows: AccountInfoRow[]; className?: string }) {
  if (!rows.length) return null;
  return <dl className={`account-info-rows ${className}`.trim()}>{rows.map(row => <div key={row.id} className={row.className} data-row={row.id} title={row.title}>
    <dt>{row.icon && <Icon name={row.icon} />}<span>{row.label}</span></dt>
    <dd><span className="account-info-value num">{row.value}</span>{row.action && (row.action.onClick
      ? <button type="button" className="icon-btn account-info-action" aria-label={row.action.label} data-tooltip={row.action.label} onClick={row.action.onClick}><Icon name={row.action.icon} /></button>
      : <span className="account-info-action" aria-hidden="true"><Icon name={row.action.icon} /></span>)}</dd>
    {row.note && <div className="account-info-note">{row.note}</div>}
  </div>)}</dl>;
}

/** Group integer digits and mute the fraction without dropping precision; the exact upstream string stays in the title. */
function BalanceValue({ value }: { value: string }) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return <>{value}</>;
  return <span title={`原始值 ${value}`}>{match[1]}{Number(match[2]).toLocaleString("en-US")}{match[3] && <span className="metric-fraction">.{match[3]}</span>}</span>;
}

/** Status chip text: only a real preflight result may claim “检查通过”; saved credentials are labelled as such. */
export function accountStatusChip(account: ModelAccount, usage: Usage | undefined, stale: boolean) {
  if (usage?.accountStatus) return { state: usage.accountStatus.state, text: `${providerAccountStateLabel(usage.accountStatus.state)}${stale ? "（上次检查）" : ""}`,
    title: `检查于 ${new Date(usage.accountStatus.checkedAt).toLocaleString()}` };
  if (!account.type) return { state: "missing", text: "认证缺失", title: "请新增登录" };
  if (account.expiresAt !== undefined && account.expiresAt <= Date.now()) return { state: "expired", text: "令牌已过期", title: "令牌已过期" };
  return { state: "saved", text: "已保存认证", title: "认证已保存，尚未确认账号状态" };
}

export function accountQuotaReference(account: ModelAccount) {
  const presentation = modelAccountPresentation(account);
  return presentation.metricIds ? { providerId: account.providerId, label: providerDisplayName(account.providerId), metricIds: presentation.metricIds,
    title: "费用估算", scopeNote: "按本机同窗口计价外推，尚未按账号拆分；多账号混用或其他设备消费会使结果偏差。非官方余额，各窗口不可相加。" } : undefined;
}

/** Fit whole sections, never clipped rows or internal scrollers. Omitted sections remain in the details dialog. */
function FittedAccountBody({ children, onDetails }: { children: ReactNode; onDetails: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const body = ref.current!;
    const fit = () => {
      const sections = [...body.children] as HTMLElement[], more = sections.pop()!;
      const entries = sections.flatMap<{ row: HTMLElement; group?: HTMLElement }>(section => section.matches(".account-windows, .account-info-rows")
        ? [...section.children].map(row => ({ row: row as HTMLElement, group: section }))
        : [{ row: section, group: undefined }]);
      sections.forEach(section => { section.hidden = false; });
      entries.forEach(({ row }) => { row.hidden = false; });
      more.hidden = true;
      const bottom = body.getBoundingClientRect().bottom;
      if (!sections.length || sections.at(-1)!.getBoundingClientRect().bottom <= bottom + 1) return;
      more.hidden = false;
      // Remove only whole trailing rows, not a complete window group or clipped text.
      for (const { row, group } of entries.reverse()) {
        if (more.getBoundingClientRect().bottom <= bottom + 1) break;
        row.hidden = true;
        if (group && [...group.children].every(child => (child as HTMLElement).hidden)) group.hidden = true;
      }
      // At extreme font sizes even this hint may not fit; the pinned Details action is always available.
      if (more.getBoundingClientRect().bottom > bottom + 1) more.hidden = true;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(body);
    // Estimates load independently; their height can change without the body resizing.
    for (const section of body.children) observer.observe(section);
    return () => observer.disconnect();
  }, [children]);
  return <div ref={ref} className="account-card-body" role="group" aria-label="账号额度内容">{children}
    <button type="button" className="account-more" onClick={onDetails}>更多信息见详情 <Icon name="arrow-right" /></button>
  </div>;
}

/** Fixed body: validity → cycle progress → provider rows → estimate; status and details stay pinned below. */
export function ModelAccountUsage({ account, state, lead, notice, status, onDetails = () => {} }: { account: ModelAccount; state: ModelAccountUsageState; copy: (label: string, value: string) => void;
  lead?: ReactNode; notice?: ReactNode; status?: ReactNode; onDetails?: () => void }) {
  const { usage, pricing, busy, sampleRevision, connected } = state;
  const presentation = modelAccountPresentation(account);
  const remaining = presentation.kind === "openai-subscription";
  const reference = accountQuotaReference(account);
  const blocked = usage?.accountStatus?.state !== "active";
  const metrics = blocked ? [] : usage?.metrics ?? [];
  const unqueryable = usage?.refreshable === false || usage?.status === "unsupported";
  const stale = !!usage?.updatedAt && (usage.stale || !connected);
  const subscriptionExpiresAt = usage?.account?.subscriptionExpiresAt;

  const validity: AccountInfoRow[] = [
    ...subscriptionExpiresAt !== undefined ? [{ id: "subscription", label: "订阅有效至", icon: "calendar", value: time(subscriptionExpiresAt), className: "provider-usage-account" }] : [],
    // Expiry is already stated by the status chip; the row only marks it.
    ...account.expiresAt !== undefined ? [{ id: "token", label: "令牌有效期", icon: "clock", value: time(account.expiresAt),
      className: account.expiresAt <= Date.now() ? "account-info-expired" : undefined }] : []];

  const label = (metric: Window) => remaining ? metric.label.replace(/已用$/, "") : metric.label;
  const windows = metrics.filter((metric): metric is Window => metric.kind === "window")
    .sort((a, b) => (a.windowSeconds ?? Infinity) - (b.windowSeconds ?? Infinity));
  const quotas = metrics.filter((metric): metric is Quota => metric.kind === "quota");

  const rows: AccountInfoRow[] = [];
  for (const metric of metrics) {
    if (metric.kind === "balance") rows.push({ id: metric.id, label: metric.label, icon: "dollar-sign", title: metricHint(metric), className: "provider-usage-metric",
      value: metric.balance && !metric.unlimited ? <BalanceValue value={metric.balance} /> : usageMetricValue(metric),
      note: metric.hasCredits && !metric.unlimited && metric.balance === null ? "有点数，余额未知" : undefined });
    else if (metric.kind === "tokens") rows.push({ id: metric.id, label: metric.label, icon: "chart-column-increasing", title: metricHint(metric), className: "provider-usage-metric",
      value: `剩余 ${usageMetricValue(metric)}`, note: `已用 ${metric.used === null ? "—" : `${metric.used.toLocaleString("en-US")} Token`}` });
    else if (metric.kind === "count") rows.push({ id: metric.id, label: metric.label, icon: "list-checks", title: metricHint(metric), className: "provider-usage-metric",
      value: usageMetricValue(metric), note: !!metric.expiries?.length && <button type="button" className="account-inline-detail" onClick={onDetails}>重置券到期明细 · {metric.expiries.length}<Icon name="arrow-right" /></button> });
  }
  for (const metric of quotas) {
    // Reset is shown inside the quota row itself, like cycle windows.
    if (metric.expiresAt !== undefined) rows.push({ id: `${metric.id}:expires`, label: `${metric.label} 到期`, icon: "calendar", value: time(metric.expiresAt) });
  }

  const estimate = tokenEstimate(metrics, pricing);
  // Provider explanations are tooltips on the card; the visible state stays short and distinct.
  const message = usage?.message;
  const checkedAt = usage?.accountStatus?.checkedAt, updatedAt = usage?.updatedAt;
  const stamp = (at: number) => time(at, new Date(at).toDateString() !== new Date().toDateString() ? new Date(at).toLocaleString() : new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  return <section className="account-provider-panel provider-usage" data-presentation={presentation.kind} aria-label="账号额度" aria-busy={busy} data-stale={stale || undefined}>
    <FittedAccountBody onDetails={onDetails}>
    {lead}
    <AccountInfoRows rows={validity} className="account-validity" />
    {windows.length > 0 && <div className="account-windows" role="status" aria-live="polite">{windows.map(metric => {
      const used = usageMetricPercent(metric), shown = used === undefined ? undefined : remaining ? 100 - used : used;
      const exhausted = metric.limitReached || remaining && shown === 0;
      return <div className="provider-usage-metric account-window" key={metric.id} data-metric-kind="window" data-exhausted={exhausted || undefined} title={metricHint(metric)}>
        <span>{label(metric)}</span>
        <strong className="num">{remaining ? `剩余 ${shown === undefined ? "—" : `${Number(shown.toFixed(1))}%`}` : `已用 ${usageMetricValue(metric)}`}</strong>
        {shown !== undefined && <progress className="provider-usage-progress" max={100} value={shown} aria-label={`${label(metric)} ${remaining ? "剩余额度" : "用量"}`} />}
        {metric.resetsAt !== undefined && <span className="account-window-reset">重置 {shortTime(metric.resetsAt)}</span>}
        {(metric.limitReached || metric.allowed === false) && <span className="provider-usage-availability" data-blocked>{metric.limitReached ? "额度已达上限" : "当前不可用"}</span>}
      </div>;
    })}</div>}
    {quotas.length > 0 && <div className="account-windows" role="status" aria-live="polite">{quotas.map(metric => {
      const used = usageMetricPercent(metric), left = metric.used !== null && metric.limit !== null ? Math.max(0, metric.limit - metric.used) : null;
      const unit = metric.unit ? ` ${metric.unit}` : "", amount = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });
      return <div className="provider-usage-metric account-window" key={metric.id} data-metric-kind="quota" data-exhausted={left === 0 || undefined} title={metricHint(metric)}>
        <span>{metric.label}</span>
        <strong className="num">{left === null ? usageMetricValue(metric) : `剩余 ${amount(left)}${unit}`}</strong>
        {used !== undefined && <progress className="provider-usage-progress" max={100} value={100 - used} aria-label={`${metric.label} 剩余额度`} />}
        {left !== null && <span className="provider-usage-remaining">已用 {usageMetricValue(metric)}</span>}
        {metric.resetsAt !== undefined && <span className="account-window-reset" data-align="end">重置 {shortTime(metric.resetsAt)}</span>}
      </div>;
    })}</div>}
    <AccountInfoRows rows={rows} className="account-extension" />
    {!metrics.length && <div className="account-usage-empty" role="status" data-unqueryable={unqueryable || undefined}>
      <span className="account-usage-state" title={message}>{!usage ? busy ? "正在检查账号状态…" : "等待查询额度" : unqueryable ? "暂不支持查询额度" : "额度暂不可用"}</span>
    </div>}
    {stale && <p className="provider-usage-note">旧数据</p>}
    {!blocked && estimate.count > 0 && <p className="provider-usage-estimate" title={estimateTitle}>可用金额估计：{estimate.text}</p>}
    {!blocked && reference && usage && <ProviderQuotaEstimate usage={usage} reference={reference} revision={sampleRevision} enabled={state.enabled} compact />}
    </FittedAccountBody>
    <footer className="provider-usage-toolbar">
      <div className="account-footer-state">{status}
        {(updatedAt || checkedAt) && <span className="provider-usage-updated" title={`更新于 ${new Date(updatedAt || checkedAt!).toLocaleString()}${checkedAt ? ` · 状态检查于 ${new Date(checkedAt).toLocaleString()}` : ""}`}>{stamp(updatedAt || checkedAt!)}</span>}
      </div>
      {notice}
      <button type="button" className="account-details-link" aria-label="查看账号详情" onClick={onDetails}>详情<Icon name="arrow-right" /></button>
    </footer>
  </section>;
}

/** Transient copy feedback for optional row actions. */
export function useCopyFeedback() {
  const [feedback, setFeedback] = useState("");
  const copy = (label: string, value: string) => void navigator.clipboard.writeText(value).then(() => setFeedback(`${label}已复制`), () => setFeedback("复制失败，请在详情中选择文本复制"));
  return { feedback, copy, clear: () => setFeedback("") };
}
