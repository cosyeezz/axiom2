import { useEffect, useState } from "react";
import { useScope } from "../transport.js";
import { agentScope, emptyAgent, running } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
export function Usage({ scope }: { scope?: Scope }) {
  const info = useScope(scope ? agentScope(scope) : null, emptyAgent),
    usage = info.usage,
    label = info.task ? "子会话" : "主会话";
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running(info.run)) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [info.run?.id, info.run?.status]);
  const elapsed = info.run
    ? ((info.run.endedAt ?? now) - info.run.startedAt) / 1000
    : null;
  const cacheTotal = usage
    ? usage.input + usage.cacheRead + usage.cacheWrite
    : 0;
  return (
    <div className="usage" aria-label="Token、缓存、耗时与预计花费统计">
      <div className="usage-row">
        <span
          className="usage-metric"
          data-od-id="context-capacity"
          title={
            usage
              ? `${label}累计 Token：${usage.total}；上下文为 pi 估算`
              : "上下文占用：未知"
          }
        >
          <svg className="usage-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3.34 19a10 10 0 1 1 17.32 0" />
            <path className="gauge-needle" d="m12 14 4-4" />
          </svg>
          <strong>{usage?.context?.tokens?.toLocaleString() ?? "—"}</strong>
          <strong>· {usage?.context?.percent?.toFixed(1) ?? "—"}%</strong>
        </span>
        <span
          className="usage-metric"
          data-od-id="cache-tokens"
          title={
            usage
              ? `${label}缓存读取 ${usage.cacheRead} · 写入 ${usage.cacheWrite}`
              : "缓存命中率：未知"
          }
        >
          <svg className="usage-icon" viewBox="0 0 24 24" aria-hidden="true">
            <g className="cache-body">
              <ellipse cx="11" cy="5" rx="8" ry="3" />
              <path d="M3 5v14c0 1.7 3.6 3 8 3M19 5v5M3 12c0 1.7 3.6 3 8 3" />
            </g>
            <path className="cache-bolt" d="m19 12-4 6h4l-1 4 5-7h-4z" />
          </svg>
          <strong>
            {usage && cacheTotal
              ? ((usage.cacheRead / cacheTotal) * 100).toFixed(0)
              : "—"}
            %
          </strong>
        </span>
        <span
          className="usage-metric"
          data-od-id="run-duration"
          title="当前执行耗时（服务端起止时间）"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <strong>
            {elapsed != null ? `${Math.max(0, elapsed).toFixed(0)}s` : "—"}
          </strong>
        </span>
        <span
          className="usage-metric"
          data-od-id="estimated-cost"
          title={`${label}累计预计费用（pi 定价）；未提供价格显示未知`}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 6v12m3-9h-4.5a2 2 0 0 0 0 4h3a2 2 0 0 1 0 4H9" />
          </svg>
          <strong>
            {usage?.cost != null ? `$${usage.cost.toFixed(4)}` : "—"}
          </strong>
        </span>
      </div>
    </div>
  );
}
