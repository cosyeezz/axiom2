import { useEffect, useRef, useState } from "react";
import type { ProviderRequestStatistics } from "../../shared/provider-requests.js";
import type { UsageProvider } from "../../shared/model-usage.js";
import { command, useConnectionState } from "../transport.js";
import "../styles/provider-requests.css";

export type RequestDisplayCache = { value: ProviderRequestStatistics; generation: number; receivedAt: number };
/** Independent from historical ledger scans, official quotas and workspace filters. */
export function ProviderRequests({ providers, selected, cached, onReport }: { providers: UsageProvider[]; selected?: string | null; cached?: RequestDisplayCache; onReport?: (value: RequestDisplayCache) => void }) {
  const { connected, generation } = useConnectionState();
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  const [report, setReport] = useState<ProviderRequestStatistics | undefined>(cached?.value), [error, setError] = useState("");
  const [freshGeneration, setFreshGeneration] = useState<number>();
  const initial = useRef(cached), receive = useRef(onReport); receive.current = onReport;
  useEffect(() => {
    const changed = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useEffect(() => {
    setFreshGeneration(undefined);
    if (!connected || !visible) return;
    let active = true, timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const value = await command<ProviderRequestStatistics>("usage.requests", {}, {}, crypto.randomUUID(), controller.signal);
        if (active) { setReport(value); setError(""); setFreshGeneration(generation); receive.current?.({ value, generation, receivedAt: Date.now() }); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "请求统计暂不可用"); }
      finally { if (active) timer = setTimeout(poll, 1000); }
    };
    const warm = initial.current; initial.current = undefined;
    const delay = warm?.generation === generation ? Math.max(0, Math.min(1000, 1000 - (Date.now() - warm.receivedAt))) : 0;
    if (delay > 0) { setFreshGeneration(generation); timer = setTimeout(poll, delay); } else void poll();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [connected, visible, generation]);
  const ids = [...new Set([...providers.filter(provider => provider.revision !== "independent").map(provider => provider.id),
    ...(report?.providers.map(provider => provider.providerId) ?? [])])].filter(id => selected === undefined || id === selected);
  const stale = !connected || !visible || !!error || freshGeneration !== generation;
  const number = (value: number | undefined) => value === undefined || !report ? "—" : value.toLocaleString("zh-CN");
  return <section className="usage-section provider-requests" aria-labelledby="provider-requests-heading" data-stale={stale || undefined}>
    <header className="usage-section-heading"><div><h2 id="provider-requests-heading">供应商请求统计</h2>
      <p>当前后台 · 全部工作空间</p></div></header>
    {ids.length > 0 ? <div className="provider-requests-table" role="region" aria-label="供应商请求监控指标" tabIndex={0}>
      <table><thead><tr><th scope="col">供应商连接</th><th scope="col">当前并发</th><th scope="col">峰值并发</th><th scope="col">RPM</th></tr></thead>
        <tbody>{ids.map(id => {
          const row = report?.providers.find(provider => provider.providerId === id), provider = providers.find(provider => provider.id === id);
          return <tr key={id}><th scope="row"><span title={provider?.name ?? id}>{provider?.name ?? id}</span><small title={id}>{id}{row?.callLevel ? " · 含调用级统计" : ""}</small></th>
            <td>{number(row?.current ?? (report ? 0 : undefined))}</td><td>{number(row?.peak ?? (report ? 0 : undefined))}</td><td>{number(row?.rpm ?? (report ? 0 : undefined))}</td></tr>;
        })}</tbody></table>
    </div> : <p className="usage-method">{report ? "当前范围尚无供应商请求记录。" : "正在读取请求统计…"}</p>}
    <p className="usage-method" role="status">{!connected ? "连接已断开，保留上次数据。" : error ? `更新失败，保留上次数据：${error}` : !visible ? "页面隐藏，已暂停刷新。" : report && stale ? "正在更新，保留上次数据。" : report ? `更新于 ${new Date(report.updatedAt).toLocaleTimeString()}` : "尚未取得实时统计。"}</p>
  </section>;
}
