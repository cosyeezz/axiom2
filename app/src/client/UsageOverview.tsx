import { useState } from "react";
import { costParts, costPartLabels, type CostTotals } from "../shared/costs.js";
import type { UsageAggregate, UsageRecordPage } from "../shared/model-usage.js";
import { usageCacheHit, usageInputTotal } from "./usage-fields.js";
import { amount, amountTitle, compactNumber, exact, money, percent, tokens, tokenSum, tokenTitle } from "./usage-format.js";

type Metric = "tokens" | "cost";
const value = (total: CostTotals, metric: Metric) => metric === "tokens" ? tokenSum(total) : total.knownCost;
const display = (total: CostTotals, metric: Metric) => metric === "tokens" ? tokens(total) : amount(total, false);
const title = (total: CostTotals, metric: Metric) => metric === "tokens" ? tokenTitle(total) : amountTitle(total);
export function UsageOverview({ report, requested, loading, onDetails, providerName }: {
  report?: UsageRecordPage; requested: boolean; loading: boolean; onDetails: () => void; providerName: (id: string | null) => string;
}) {
  const [metric, setMetric] = useState<Metric>("tokens"), [dimension, setDimension] = useState<"workspaces" | "providers">("workspaces");
  const prepared = !report?.background || report.background.verifiedThrough > 0;
  const total = prepared ? report?.total : undefined, analytics = prepared ? report?.analytics : undefined;
  const trend = analytics?.trend ?? [], max = Math.max(0, ...trend.map(bucket => value(bucket.total, metric)).filter(Number.isFinite));
  const chartHeight = 180, chartWidth = 900, slot = chartWidth / Math.max(1, trend.length);
  const peakKnown = trend.some(bucket => bucket.total.records && (metric === "tokens" ? !bucket.total.unknownTokens || tokenSum(bucket.total) > 0 : !bucket.total.unknownCost || bucket.total.knownCost > 0));
  const empty = !requested ? "尚未加载" : report?.background?.state === "error" ? "后台统计暂不可用" : !prepared ? "后台准备中…" : loading || report?.building ? "加载中…" : report?.partial ? "暂无已确认数据" : "暂无数据";
  const rank = (rows: UsageAggregate[], kind: "models" | "workspaces" | "providers") => {
    const peak = Math.max(0, ...rows.map(row => value(row.total, metric)).filter(Number.isFinite));
    return rows.length ? <ol className="usage-ranking">{rows.map(row => {
      const name = kind === "providers" && !row.other ? providerName(JSON.parse(row.key) as string | null) : row.label;
      let identity = "";
      if (kind === "models" && !row.other) { const [provider, model] = JSON.parse(row.key) as [string | null, string | null]; identity = `${providerName(provider)} · ${model ?? "未记录模型 ID"}`; }
      const width = peak > 0 && Number.isFinite(value(row.total, metric)) ? value(row.total, metric) / peak * 100 : 0;
      return <li key={`${row.other ? "other" : "group"}:${row.key}`}>
        <div className="usage-ranking-label"><span title={identity ? `${name} · ${identity}` : name}>{name}</span><strong title={title(row.total, metric)}>{display(row.total, metric)}</strong></div>
        {identity && <small className="usage-ranking-identity" title={identity}>{identity}</small>}
        <div className="usage-ranking-track" aria-hidden="true"><span style={{ width: `${width}%` }} /></div>
        {!!(metric === "cost" ? row.total.unknownCost || row.total.estimatedRecords : row.total.unknownTokens) && <small>{metric === "cost" ? [row.total.estimatedRecords ? "含估算" : "", row.total.unknownCost ? "部分未计价" : ""].filter(Boolean).join(" · ") : "Token 未完整上报"}</small>}
      </li>;
    })}</ol> : <p className="usage-empty">{empty}</p>;
  };
  return <section className="usage-local-report" aria-labelledby="local-usage-heading" aria-busy={loading} data-partial={report?.partial || undefined}>
    <header className="usage-section-heading usage-overview-heading"><h2 id="local-usage-heading">用量概览</h2><button type="button" className="btn btn-ghost" onClick={onDetails}>查看明细 →</button></header>
    <div className="usage-totals" aria-label="用量核心指标">
      <div><span>总 Token</span><strong title={tokenTitle(total)}>{tokens(total)}</strong></div>
      <div><span>本机费用 · USD</span><strong title={total ? amountTitle(total) : undefined}>{total ? amount(total, false) : "—"}</strong>{!!total?.estimatedRecords && <small>含估算</small>}</div>
      <div><span>缓存命中率</span><strong>{percent(usageCacheHit(total))}</strong></div>
      <div><span>账务记录</span><strong>{total ? exact(total.records) : "—"}</strong></div>
    </div>
    <div className="usage-analysis-toolbar"><span>分析指标</span><div className="usage-segment" role="group" aria-label="图表指标"><button type="button" aria-pressed={metric === "tokens"} onClick={() => setMetric("tokens")}>Token</button><button type="button" aria-pressed={metric === "cost"} onClick={() => setMetric("cost")}>费用</button></div></div>
    <section className="usage-section usage-trend" aria-labelledby="usage-trend-heading">
      <header className="usage-section-heading"><div><h3 id="usage-trend-heading">{metric === "tokens" ? "Token 用量趋势" : "费用趋势"}</h3><p>{analytics ? `${analytics.bucketDays === 1 ? "按天" : `每 ${analytics.bucketDays} 个日历日汇总`} · ${analytics.timeZone} · ${metric === "tokens" ? "Token" : "USD"}` : "真实调用日期 · 同一筛选范围"}</p></div><span className="usage-chart-scale">峰值 {peakKnown ? metric === "tokens" ? compactNumber(max) : money(max) : "—"}</span></header>
      {analytics && trend.length && report?.count ? <>
        <div className="usage-trend-plot">
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight + 12}`} preserveAspectRatio="none" role="img" aria-labelledby="usage-trend-heading usage-trend-description">
            <desc id="usage-trend-description">{trend.length}个时间段的{metric === "tokens" ? "Token 用量" : "费用"}，精确值可展开下方趋势数据表查看。{report.partial || report.building ? "当前为部分统计，仅代表已核对记录。" : ""}</desc>
            {[0, .5, 1].map(y => <line key={y} x1="0" x2={chartWidth} y1={chartHeight * y + 6} y2={chartHeight * y + 6} className="usage-gridline" />)}
            {trend.map((bucket, i) => {
              const n = value(bucket.total, metric), height = Number.isFinite(n) && max > 0 ? n / max * chartHeight : 0;
              return <g key={bucket.from}><title>{bucket.from}{bucket.to !== bucket.from ? ` 至 ${bucket.to}` : ""}：{display(bucket.total, metric)}{metric === "tokens" ? " Token" : " USD"} · {bucket.count} 条记录{bucket.total.unknownTokens ? " · Token 不完整" : ""}{bucket.total.unknownCost && metric === "cost" ? " · 费用未完整计价" : ""}{bucket.total.estimatedRecords && metric === "cost" ? " · 含估算" : ""}</title><rect x={i * slot + slot * .18} width={Math.max(1, slot * .64)} y={chartHeight - height + 6} height={height} rx={Math.min(3, slot * .1)} className="usage-trend-bar" /></g>;
            })}
          </svg>
        </div>
        <div className="usage-trend-axis"><span>{trend[0].from}</span>{trend.length > 2 && <span>{trend[Math.floor((trend.length - 1) / 2)].from}</span>}<span>{trend.at(-1)!.to}</span></div>
        <details className="usage-chart-data"><summary>查看趋势数据</summary><div className="usage-table-region"><table className="usage-table"><thead><tr><th scope="col">日期</th><th scope="col">记录</th><th scope="col">{metric === "tokens" ? "Token" : "费用（USD）"}</th><th scope="col">数据状态</th></tr></thead><tbody>{trend.map(bucket => <tr key={bucket.from}><th scope="row">{bucket.from}{bucket.to !== bucket.from ? ` — ${bucket.to}` : ""}</th><td>{bucket.count}</td><td title={title(bucket.total, metric)}>{!bucket.count ? "0" : display(bucket.total, metric) === "—" ? "—" : exact(value(bucket.total, metric))}</td><td>{[bucket.total.unknownTokens ? "Token 不完整" : "", bucket.total.unknownCost ? "部分未计价" : "", bucket.total.estimatedRecords ? "含估算" : ""].filter(Boolean).join(" · ") || (report.partial || report.building ? "仅已核对部分" : "已核对")}</td></tr>)}</tbody></table></div></details>
      </> : <p className="usage-empty">{analytics?.undated.count ? "暂无日期数据" : empty}</p>}
      {!!analytics?.undated.count && <p className="usage-quality">时间未知 · {exact(analytics.undated.count)} 条</p>}
    </section>
    <div className="usage-breakdowns">
      <section className="usage-section" aria-labelledby="usage-model-ranking"><header className="usage-section-heading"><div><h3 id="usage-model-ranking">模型用量排名</h3><p>Top 5 · {metric === "tokens" ? "Token" : "USD"}</p></div></header>{rank(analytics?.models[metric] ?? [], "models")}</section>
      <section className="usage-section" aria-labelledby="usage-distribution-heading"><header className="usage-section-heading"><h3 id="usage-distribution-heading">用量分布</h3><div className="usage-segment" role="group" aria-label="分布维度"><button type="button" aria-pressed={dimension === "workspaces"} onClick={() => setDimension("workspaces")}>工作空间</button><button type="button" aria-pressed={dimension === "providers"} onClick={() => setDimension("providers")}>供应商</button></div></header>{rank(analytics?.[dimension][metric] ?? [], dimension)}</section>
    </div>
    <details className="usage-method-details usage-token-details"><summary>Token 构成</summary><div className="usage-token-parts">{costParts.map(part => <div key={part}><span>{costPartLabels[part]}</span><strong title={tokenTitle(total, part)}>{tokens(total, part)}</strong></div>)}</div><p>输入合计 <strong>{compactNumber(usageInputTotal(total))}</strong></p></details>
  </section>;
}
