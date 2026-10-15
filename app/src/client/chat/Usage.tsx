import { useEffect, useState } from "react";
import { useScope } from "../transport.js";
import { agentScope, emptyAgent, running } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
import { Compression } from "./Compression.js";
import { TaskSettings } from "../tasks/TaskSettings.js";
import { AnnotationToggle } from "./ReplyAnnotations.js";
import { OriginalConversationToggle } from "./OriginalConversation.js";
import { formatDuration, sessionDuration } from "./duration.js";
import { CostsPopover } from "../pages/Costs.js";
export function Usage({ scope }: { scope?: Scope }) {
  const info = useScope(scope ? agentScope(scope) : null, emptyAgent),
    usage = info.usage,
    label = info.task ? "子会话" : "主会话";
  const [now, setNow] = useState(Date.now());
  const [costWindow, setCostWindow] = useState<{ scope: Scope; trigger: HTMLButtonElement } | null>(null);
  useEffect(() => { setCostWindow(null); }, [scope?.workspaceId, scope?.sessionId]);
  useEffect(() => {
    if (!running(info.run)) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [info.run?.id, info.run?.status]);
  const elapsed = sessionDuration(info, now);
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
            data-tooltip={`${contextLabel}；${label}累计 Token：${usage?.total ?? "—"}`}
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
          data-tooltip={
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
          data-tooltip={`${label}累计运行时间（不含停止后的空闲时间）`}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <strong>{formatDuration(elapsed)}</strong>
        </span>
        <button
          type="button"
          className="usage-metric cost-trigger"
          aria-label="查看费用明细"
          aria-haspopup="dialog"
          aria-expanded={!!costWindow}
          disabled={!scope}
          onClick={(event) => setCostWindow(costWindow || !scope ? null : { scope, trigger: event.currentTarget })}
          data-od-id="estimated-cost"
          data-tooltip={`${label}累计预计费用（pi 定价）；点击查看主 Agent、各子 Agent、压缩与工具费用明细`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="182 182 660 660" aria-hidden="true">
            <path fill="currentColor" d="M559.7 488.8l-25.4-5.9V348.6c38 5.2 61.5 29 65.5 58.2c.5 4 3.9 6.9 7.9 6.9h44.9c4.7 0 8.4-4.1 8-8.8c-6.1-62.3-57.4-102.3-125.9-109.2V263c0-4.4-3.6-8-8-8h-28.1c-4.4 0-8 3.6-8 8v33c-70.8 6.9-126.2 46-126.2 119c0 67.6 49.8 100.2 102.1 112.7l24.7 6.3v142.7c-44.2-5.9-69-29.5-74.1-61.3c-.6-3.8-4-6.6-7.9-6.6H363c-4.7 0-8.4 4-8 8.7c4.5 55 46.2 105.6 135.2 112.1V761c0 4.4 3.6 8 8 8h28.4c4.4 0 8-3.6 8-8.1l-.2-31.7c78.3-6.9 134.3-48.8 134.3-124c-.1-69.4-44.2-100.4-109-116.4m-68.6-16.2c-5.6-1.6-10.3-3.1-15-5c-33.8-12.2-49.5-31.9-49.5-57.3c0-36.3 27.5-57 64.5-61.7zM534.3 677V543.3c3.1.9 5.9 1.6 8.8 2.2c47.3 14.4 63.2 34.4 63.2 65.1c0 39.1-29.4 62.6-72 66.4" />
          </svg>
          <strong>
            {usage?.cost != null ? `$${usage.cost.toFixed(4)}` : "—"}
          </strong>
        </button>
        {costWindow && costWindow.scope.workspaceId === scope?.workspaceId && costWindow.scope.sessionId === scope?.sessionId && <CostsPopover scope={costWindow.scope} trigger={costWindow.trigger} onClose={() => setCostWindow(null)} />}
      </div>
      <div className="usage-settings" role="group" aria-label="批注、原始会话、子代理与压缩设置">
        <AnnotationToggle scope={scope} />
        <OriginalConversationToggle scope={scope} />
        <TaskSettings />
        <Compression key={scope?.sessionId ?? "empty"} scope={scope} />
      </div>
    </div>
  );
}
