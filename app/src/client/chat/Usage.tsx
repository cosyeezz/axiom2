import { useEffect, useState } from "react";
import { useScope } from "../transport.js";
import { agentScope, emptyAgent, running } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
import { Compression } from "./Compression.js";
import { TaskSettings } from "../tasks/TaskSettings.js";
import { AnnotationToggle } from "./ReplyAnnotations.js";
import { formatDuration } from "./duration.js";
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
  const context = usage?.context;
  const percent =
    context?.tokens != null &&
    Number.isFinite(context.tokens) &&
    context.tokens >= 0 &&
    Number.isFinite(context.window) &&
    context.window > 0
      ? Math.min(100, (context.tokens / context.window) * 100)
      : null;
  const contextLabel =
    percent == null
      ? "上下文占用率未知"
      : `上下文占用率 ${Math.round(percent)}%（${context?.estimated ? "压缩后按当前消息估算，待模型用量校准" : "pi 估算"}）`;
  return (
    <div
      className="usage"
      data-od-id="token-usage"
      role="group"
      aria-label="Token、缓存、耗时与预计花费统计"
    >
      <div className="usage-row">
        <div className="context-controls" data-od-id="context-controls">
          <span
            className="usage-metric"
            data-od-id="context-capacity"
            title={`${contextLabel}；${label}累计 Token：${usage?.total ?? "—"}`}
          >
            <svg
              className="usage-icon"
              viewBox="0 0 24 24"
              role="progressbar"
              aria-label={contextLabel}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent ?? undefined}
            >
              <circle
                className="context-ring-track"
                cx="12"
                cy="12"
                r="9"
                strokeDasharray={percent == null ? "2 3" : undefined}
              />
              <circle
                className="context-ring-fill"
                cx="12"
                cy="12"
                r="9"
                pathLength="100"
                strokeDasharray="100 100"
                strokeDashoffset={100 - (percent ?? 0)}
                transform="rotate(-90 12 12)"
              />
            </svg>
            <span className="screen-reader">上下文占用：</span>
            <strong>{context?.estimated && context.tokens != null ? "≈" : ""}{context?.tokens?.toLocaleString("zh-CN") ?? "—"}</strong>
            <strong aria-label={contextLabel}>
              · {percent == null ? "—" : Math.round(percent)}%
            </strong>
          </span>
        </div>
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
            <g>
              <path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z" />
              <path d="M4 13h4" />
            </g>
            <g stroke="var(--accent-hover)">
              <path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z" />
              <path d="M16 17h4" />
            </g>
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
          <strong>{formatDuration(elapsed)}</strong>
        </span>
        <span
          className="usage-metric"
          data-od-id="estimated-cost"
          title={`${label}累计预计费用（pi 定价）；未提供价格显示未知`}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <line x1="12" x2="12" y1="2" y2="22" />
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
          <strong>
            {usage?.cost != null ? `$${usage.cost.toFixed(4)}` : "—"}
          </strong>
        </span>
      </div>
      <div className="usage-settings" role="group" aria-label="批注、子代理与压缩设置">
        <AnnotationToggle scope={scope} />
        <TaskSettings />
        <Compression key={scope?.sessionId ?? "empty"} scope={scope} />
      </div>
    </div>
  );
}
