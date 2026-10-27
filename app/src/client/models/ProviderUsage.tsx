import { useEffect, useRef, useState } from "react";
import { command, useConnectionState } from "../transport.js";
import { Icon } from "../Icon.js";
import { estimateTokenBalance, usageMetricValue, usageRefreshMinimum, usageRefreshJitter, type UsageModelPricing, type ProviderUsage as Usage, type ProviderUsageMetric } from "../../shared/provider-usage.js";
import "../styles/provider-usage.css";

function managementUrl(usage: Usage | undefined) {
  try {
    const url = new URL(usage?.management?.url ?? "");
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch { return; }
}

function metricHint(metric: ProviderUsageMetric) {
  const at = metric.kind === "window" ? metric.resetsAt : metric.kind === "count" ? metric.expiresAt : undefined;
  return `${metric.label}：${usageMetricValue(metric)}${at ? `；${metric.kind === "window" ? "窗口重置" : "最近到期"}：${new Date(at).toLocaleString()}` : ""}`;
}

/** No provider-specific branches: all interpretation belongs to server-side adapters. */
export function ProviderUsage({ providerId, revision, pricingProviderId = providerId }: { providerId: string; revision: string; pricingProviderId?: string }) {
  const { connected, generation } = useConnectionState();
  const [usage, setUsage] = useState<Usage>();
  const [pricing, setPricing] = useState<UsageModelPricing[]>([]);
  const [busy, setBusy] = useState(false);
  const refreshAction = useRef<() => void>(() => {});
  useEffect(() => {
    if (!connected) return;
    let disposed = false, running = false, poll = true, nextAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const fallbackDeadline = () => Date.now() + usageRefreshMinimum + Math.floor(Math.random() * (usageRefreshJitter + 1));
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
        const result = await command<Usage>("usage.provider", { providerId, refresh: force }, {}, crypto.randomUUID(), controller.signal);
        if (!disposed && result.providerId === providerId) {
          setUsage(result); poll = result.refreshable !== false && result.status !== "unsupported";
          if (result.metrics.some(metric => metric.kind === "tokens")) {
            const prices = await command<UsageModelPricing[]>("usage.pricing", { providerId: pricingProviderId }, {}, crypto.randomUUID(), controller.signal).catch(() => []);
            if (!disposed) setPricing(prices);
          } else setPricing([]);
          nextAt = Number.isFinite(result.nextRefreshAt) && result.nextRefreshAt! > Date.now()
            ? Math.min(result.nextRefreshAt!, Date.now() + usageRefreshMinimum + usageRefreshJitter) : fallbackDeadline();
        }
      } catch {
        nextAt = fallbackDeadline();
        if (!disposed) setUsage(previous => previous?.updatedAt
          ? { ...previous, stale: true, message: "刷新失败，当前为上次查询结果。" }
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
  }, [providerId, pricingProviderId, revision, connected, generation]);
  const disconnected = !connected;
  const management = managementUrl(usage);
  const balances = usage?.metrics.filter((metric): metric is Extract<ProviderUsageMetric, { kind: "tokens" }> => metric.kind === "tokens") ?? [];
  const usd = (value: number) => value !== 0 && (value < .00005 || value >= 1e6) ? `$${value.toExponential(3)}` : `$${value.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
  const estimates = balances.flatMap(metric => { const value = estimateTokenBalance(metric, pricing); return value ? [`${metric.label} ${usd(value.low)}${value.high !== value.low ? `～${usd(value.high)}` : ""}`] : []; });
  const estimate = estimates.length ? `${estimates.join("；")}（当前配置价参考值，非美元余额）` : balances.length ? "暂不能估算（缺少对应模型的完整非阶梯价格或剩余 Token）" : "暂不能估算（上游未提供可换算的剩余 Token）";
  const stale = !!usage?.updatedAt && (usage.stale || disconnected);
  const title = [usage?.updatedAt ? `上游查询时间：${new Date(usage.updatedAt).toLocaleString()}` : "只读查询上游账号额度，不消耗重置次数。",
    usage?.nextRefreshAt ? `下次自动刷新：${new Date(usage.nextRefreshAt).toLocaleString()}；期间读取本地缓存。` : "自动刷新间隔为30～40分钟；期间读取本地缓存。",
    stale ? "当前为旧数据。" : "", usage?.message ?? ""].filter(Boolean).join("\n");
  return <div className="provider-usage" aria-label="供应商额度" aria-busy={busy} data-stale={stale || undefined}>
    <div className="provider-usage-metrics" role="status" aria-live="polite" title={title}>
      {usage?.metrics.length ? usage.metrics.map(metric => <span className="provider-usage-metric" key={metric.id} title={metricHint(metric)}>
        <span>{metric.label}</span><strong className="num">{metric.kind === "window" ? `已用 ${usageMetricValue(metric)}` : metric.kind === "tokens" ? `剩余 ${usageMetricValue(metric)}` : usageMetricValue(metric)}</strong>
        {metric.kind === "tokens" && <span className="provider-usage-remaining">已用 {metric.used === null ? "—" : `${metric.used.toLocaleString("en-US")} Token`}</span>}
        {metric.kind === "window" && <span className="provider-usage-remaining">剩余 {metric.usedPercent === null ? "—" : `${Number(Math.max(0, 100 - metric.usedPercent).toFixed(1))}%`}</span>}
      </span>) : <span className="provider-usage-note">{busy && !usage ? "额度查询中…" : usage?.message || (usage?.status === "unsupported" ? "暂未接入此供应商的官方额度查询。" : "额度暂不可用")}</span>}
      {stale && <span className="provider-usage-note">旧数据</span>}
      {!!usage?.metrics.length && usage.message && <span className="provider-usage-note" title={usage.message}>{usage.message}</span>}
      {management && usage?.management && <a className="provider-usage-link" href={management} target="_blank" rel="noopener noreferrer">{usage.management.label}</a>}
    </div>
    <p className="provider-usage-estimate" title="估值必须有可核对的剩余 Token，并按对应模型当前配置价格计算；百分比或点数不能直接换算美元。">可用金额估计：{estimate}</p>
    <div className="provider-usage-toolbar">{usage?.updatedAt && <time className="provider-usage-updated" dateTime={new Date(usage.updatedAt).toISOString()}>更新于 {new Date(usage.updatedAt).toLocaleTimeString()}</time>}
      <button type="button" className="icon-btn provider-usage-refresh" aria-label="刷新供应商额度" disabled={busy || disconnected || usage?.refreshable === false || usage?.status === "unsupported"}
        title={title} onClick={() => refreshAction.current()}><Icon name="refresh-cw" /><span>刷新额度</span></button></div>
  </div>;
}
