import { useEffect, useRef, useState } from "react";
import type { UsageRecordPage } from "../../shared/model-usage.js";
import type { ProviderUsage } from "../../shared/provider-usage.js";
import { estimateQuotaWindow, quotaSamplePeriod, type QuotaEstimate, type QuotaPeriod, type QuotaWindow } from "../../shared/quota-estimate.js";
import { command, useConnectionState } from "../transport.js";

export type QuotaReference = { providerId: string; label: string; metricIds: string[]; title?: string; limitation?: string; scopeNote?: string };
type Sample = { id: string; estimate?: QuotaEstimate; reason?: string };
const usd = (value: number) => value !== 0 && (value < .00005 || value >= 1e6) ? `$${value.toExponential(3)}`
  : `$${value.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;

/** Explicitly separate local extrapolation from the read-only official quota and absolute-Token valuation. */
export function ProviderQuotaEstimate({ usage, reference, revision, enabled = true }: { usage: ProviderUsage; reference: QuotaReference; revision: number; enabled?: boolean }) {
  const { connected, generation } = useConnectionState();
  const [visible, setVisible] = useState(() => document.visibilityState === "visible"), [clock, setClock] = useState(Date.now);
  const [result, setResult] = useState<{ key: string; samples: Sample[]; busy: boolean; error?: string }>();
  const sampledRevision = useRef(0);
  const windows = usage.metrics.filter((metric): metric is QuotaWindow => metric.kind === "window" && reference.metricIds.includes(metric.id));
  const periods = windows.map(window => ({ window, period: reference.limitation ? undefined : quotaSamplePeriod(usage, window, Math.max(clock, Date.now())) }));
  // Values, not response object identity: a cached official read must not restart an unchanged sample scan.
  const key = JSON.stringify([reference.providerId, usage.providerId, usage.updatedAt, usage.status, !!usage.stale, revision,
    periods.map(({ window, period }) => [window.id, window.usedPercent, period])]);
  const request = JSON.stringify(periods.flatMap(({ window, period }) => period ? [{ id: window.id, usedPercent: window.usedPercent, ...period }] : []));
  useEffect(() => {
    const changed = () => { setVisible(document.visibilityState === "visible"); setClock(Date.now()); };
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useEffect(() => {
    // Stop showing an old window's estimate at reset, even if official polling has not yet fired.
    const deadlines = windows.flatMap(window => window.resetsAt && window.resetsAt > clock ? [window.resetsAt] : []);
    if (!deadlines.length) return;
    const timer = setTimeout(() => setClock(Date.now()), Math.min(2_147_483_647, Math.max(1, Math.min(...deadlines) - Date.now())));
    return () => clearTimeout(timer);
  }, [key, clock]);
  useEffect(() => {
    if (!connected || !visible || !enabled) return;
    const requests = JSON.parse(request) as (QuotaPeriod & { id: string; usedPercent: number })[];
    if (!requests.length) return;
    let active = true, index = 0, batches = 0, rebuilt = false;
    const manualRefresh = sampledRevision.current !== revision;
    sampledRevision.current = revision;
    const samples: Sample[] = [], controller = new AbortController(), started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setResult({ key, samples: [], busy: true });
    const read = async (continuation = false, snapshot?: string, refresh = false) => {
      const current = requests[index];
      try {
        if (refresh) rebuilt = true;
        const page = await command<UsageRecordPage>("usage.ledger", { providerId: reference.providerId, from: current.from, to: current.to,
          pageSize: 1, refresh, continue: continuation, snapshot }, {}, crypto.randomUUID(), controller.signal);
        if (!active) return;
        const outdated = !Number.isFinite(page.updatedAt) || page.updatedAt < current.to;
        if (page.background?.state === "error") throw Error("background sample unavailable");
        if (page.building || page.background?.state === "updating") {
          // The sidecar may still be publishing or preparing this filter. Never treat its old watermark as fresh.
          if (++batches >= 64 || Date.now() - started >= 60_000) throw Error("incomplete");
          timer = setTimeout(() => { void read(true, page.snapshot); }, page.background ? 1000 : 100);
          return;
        }
        // Request one asynchronous refresh; do not force a scan for every window or poll.
        if (outdated) {
          if (rebuilt) throw Error("outdated sample");
          void read(false, undefined, true);
          return;
        }
        const estimate = estimateQuotaWindow(current.usedPercent, page);
        const reason = page.partial ? "本机记录未完整核对" : page.total.unknownCost || page.total.unknownTokens ? "窗口内存在未计价或不完整记录"
          : !page.total.records || page.total.knownCost <= 0 ? "窗口内暂无已计价样本" : "样本金额无法外推";
        samples.push({ id: current.id, estimate, ...(!estimate ? { reason } : {}) });
        index++;
        setResult({ key, samples: [...samples], busy: index < requests.length });
        if (index < requests.length) void read();
      } catch {
        if (active) setResult({ key, samples: [...samples], busy: false, error: "本机样本核对未完成，请刷新额度重试。" });
      }
    };
    void read(false, undefined, manualRefresh);
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [key, request, reference.providerId, connected, generation, visible, enabled]);
  const current = result?.key === key ? result : undefined;
  const unavailable = reference.limitation ?? (usage.stale || !connected ? "官方额度为旧数据，暂不外推" : usage.status !== "ready" ? "官方额度暂不可用"
    : !windows.length ? "尚无可匹配的额度窗口" : "窗口时间或已用比例不足，暂不能外推");
  return <section className="provider-quota-estimate" aria-label="额度金额预估" aria-busy={current?.busy || undefined}>
    <div className="provider-quota-heading"><strong>{reference.title || "预估总可用金额"}</strong><span>USD · 本机样本估算</span></div>
    <div className="provider-quota-windows" role="status" aria-live="polite">
      {periods.length ? periods.map(({ window, period }) => {
        const sample = period && connected ? current?.samples.find(sample => sample.id === window.id) : undefined, estimate = sample?.estimate;
        const reason = !period || !connected ? unavailable : sample?.reason ?? current?.error ?? "正在核对本机样本…";
        const title = estimate && period ? `样本：${new Date(period.from).toLocaleString()} — ${new Date(period.to).toLocaleString()}；${estimate.records} 条账务，${usd(estimate.used)}；100% = ${usd(estimate.used)} ÷ ${window.usedPercent}%；剩余 = 总额 × ${100 - window.usedPercent!}%；基于历史已计价费用，含已有参考价估算，不代表官方余额。` : reason;
        return <div className="provider-quota-window" key={window.id} title={title}>
          <span className="provider-quota-label">{window.label.replace(/已用$/, "")}</span>
          <span>100% 总金额 <strong className="num">{estimate ? `约 ${usd(estimate.total)}` : "—"}</strong></span>
          <span>剩余金额 <strong className="num">{estimate ? `约 ${usd(estimate.remaining)}` : "—"}</strong></span>
          <small>{estimate ? `样本 ${estimate.records} 条 · ${usd(estimate.used)} · 已用 ${window.usedPercent}%${window.usedPercent! < 5 ? " · 低比例样本" : ""}` : reason}</small>
        </div>;
      }) : <p className="provider-quota-empty">100% 总金额：— · {unavailable}</p>}
    </div>
    <p className="provider-quota-note">{reference.scopeNote ?? `按本机 ${reference.label} 记录外推，非官方余额；各窗口不可相加。未核对历史换号及其他设备消费。`}</p>
  </section>;
}
