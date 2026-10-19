import { useEffect, useState, type ReactNode } from "react";
import { useScope } from "../transport.js";
import { agentScope, emptyAgent, running } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
import { Compression } from "./Compression.js";
import { TaskSettings } from "../tasks/TaskSettings.js";
import { AnnotationToggle } from "./ReplyAnnotations.js";
import { OriginalConversationToggle } from "./OriginalConversation.js";
import { durationTooltip, formatDuration, sessionDuration } from "./duration.js";
import { CostsPopover } from "../pages/Costs.js";
import { CacheUsageIcon } from "./UsageIcons.js";
import { ContextMemoryIcon, cacheRatio, validRatio } from "../DataIcons.js";
import { Icon } from "../Icon.js";
import { MetricDetail } from "./MetricDetail.js";
import "../styles/data-icons.css";
export type ContextMemoryInfo = { percent: number | null; label: string; detail: ReactNode };
export type UsageTools = { session: (context: ContextMemoryInfo) => ReactNode; global: ReactNode };
type Metric = "context" | "cache";
export function Usage({ scope, tools }: { scope?: Scope; tools?: UsageTools }) {
  const info = useScope(scope ? agentScope(scope) : null, emptyAgent), usage = info.usage, label = info.task ? "子会话" : "主会话";
  const [now, setNow] = useState(Date.now());
  const [costWindow, setCostWindow] = useState<{ scope: Scope; trigger: HTMLButtonElement } | null>(null);
  const [detail, setDetail] = useState<{ key: Metric; scope: string; trigger: HTMLButtonElement } | null>(null);
  const scopeKey = `${scope?.workspaceId ?? ""}:${scope?.sessionId ?? ""}`;
  useEffect(() => { setCostWindow(null); setDetail(null); }, [scopeKey]);
  useEffect(() => {
    if (!running(info.run)) return;
    setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer);
  }, [info.run?.id, info.run?.status]);
  const elapsed = sessionDuration(info, now), context = usage?.context;
  const percent = validRatio(context?.tokens, context?.window), cache = cacheRatio(usage);
  const estimate = context?.estimated ? "压缩后按当前消息估算，待模型用量校准" : "pi 估算";
  const contextLabel = percent == null ? "上下文占用率未知" : `上下文占用率 ${Math.round(percent)}%（${estimate}）`;
  const cacheLabel = `输入侧缓存读取占比 ${cache == null ? "未知" : `${Math.round(cache)}%`}`;
  const number = (n: number | null | undefined) => n != null && Number.isFinite(n) && n >= 0 ? n.toLocaleString("zh-CN") : "未知";
  const contextDetail = <><div className="metric-summary"><span>上下文占用</span><strong>{percent == null ? "—" : `${percent.toFixed(1)}%`}</strong></div><dl className="metric-facts"><dt>已用 / 容量</dt><dd>{number(context?.tokens)} / {number(context?.window)}</dd><dt>当前会话累计 Token</dt><dd>{number(usage?.total)}</dd></dl><p className="metric-note">当前{label} · {estimate}。上下文占用与累计用量分别统计。</p>{percent != null && percent > 100 && <p className="metric-note" role="status">已超出上下文容量 {number(context!.tokens! - context!.window)} tokens；图标最多显示满圈。</p>}</>;
  const inputTotal = cache == null ? null : (usage?.input ?? 0) + (usage?.cacheRead ?? 0) + (usage?.cacheWrite ?? 0);
  const contextInfo: ContextMemoryInfo = { percent, label: contextLabel, detail: contextDetail };
  const metric = (key: Metric, title: string) => ({ type: "button" as const, "aria-label": `查看${title}`, "aria-haspopup": "dialog" as const, "aria-expanded": detail?.key === key, onClick: (event: React.MouseEvent<HTMLButtonElement>) => { setCostWindow(null); setDetail(detail?.key === key ? null : { key, scope: scopeKey, trigger: event.currentTarget }); } });
  return <div className="usage" data-od-id="token-usage" role="group" aria-label="Token、缓存、耗时与预计花费统计">
    <div className="usage-row">
      {tools ? tools.session(contextInfo) : <button className="usage-metric context-memory-control" data-od-id="context-capacity" data-tooltip={`${contextLabel}；点击查看详情`} {...metric("context", contextLabel)}>
        <ContextMemoryIcon percent={percent} label={contextLabel} />
      </button>}
      <button className="usage-metric" data-od-id="cache-tokens" data-tooltip={`${cacheLabel}；点击查看输入统计`} {...metric("cache", cacheLabel)}>
        <CacheUsageIcon active={running(info.run)} percent={cache} />
      </button>
      <button type="button" className="usage-metric cost-trigger" aria-label="查看费用明细" aria-description="包含当前会话耗时" aria-haspopup="dialog" aria-expanded={!!costWindow} disabled={!scope}
        onClick={event => { setDetail(null); setCostWindow(costWindow || !scope ? null : { scope, trigger: event.currentTarget }); }} data-od-id="estimated-cost" data-tooltip={`${label}累计预计费用（pi 定价） · ${durationTooltip(info)}：${formatDuration(elapsed)}；点击查看费用与耗时明细`}>
        <Icon name="chart-column-increasing" />
      </button>
      {costWindow && costWindow.scope.workspaceId === scope?.workspaceId && costWindow.scope.sessionId === scope?.sessionId && <CostsPopover scope={costWindow.scope} trigger={costWindow.trigger} onClose={() => setCostWindow(null)} sessionSummary={<section className="cost-session-duration" aria-label="当前会话用量"><dl className="cost-session-facts"><div><dt>当前{label}预计费用</dt><dd>{usage?.cost != null ? `$${usage.cost.toFixed(4)}` : "—"}</dd></div><div><dt>运行耗时</dt><dd data-od-id="run-duration" data-tooltip={durationTooltip(info)}>{formatDuration(elapsed)}</dd></div></dl><p>{durationTooltip(info)}；不叠加子会话耗时。</p></section>} />}
      {detail && detail.scope === scopeKey && <MetricDetail trigger={detail.trigger} className={detail.key === "cache" ? "cache-detail" : ""} title={{ context: "上下文占用", cache: "缓存读取" }[detail.key]} subtitle={`当前${label} · ${detail.key === "cache" ? "累计输入统计" : "实时容量"}`} onClose={() => setDetail(null)}>
        {detail.key === "context" ? contextDetail : <>
          <div className="cache-summary"><span>输入复用比例</span><strong>{cache == null ? "—" : `${cache.toFixed(1)}%`}</strong></div>
          <div className="cache-composition" aria-hidden="true">{inputTotal != null && inputTotal > 0 && [["cache-read", usage?.cacheRead], ["cache-input", usage?.input], ["cache-write", usage?.cacheWrite]].map(([key, value]) => typeof value === "number" && value > 0 ? <span key={key} className={String(key)} style={{ flexGrow: value / inputTotal }} /> : null)}</div>
          <div className="cache-ledger-heading"><span>输入构成</span><span>Token</span></div>
          <dl className="cache-ledger"><dt><i className="cache-read" />缓存读取</dt><dd>{number(usage?.cacheRead)}</dd><dt><i className="cache-input" />未缓存输入</dt><dd>{number(usage?.input)}</dd><dt><i className="cache-write" />缓存写入</dt><dd>{number(usage?.cacheWrite)}</dd></dl>
          <p className="metric-note">仅统计当前{label}累计输入，不含模型输出。</p>
          <details className="metric-method"><summary><span>统计口径</span><Icon name="chevron-down" /></summary><p className="metric-note">读取占比 = 缓存读取 ÷ 输入总量。输入总量包含上述三项；这是 Token 构成，不是请求命中概率。无有效输入时显示“—”。</p></details>
        </>}
      </MetricDetail>}
    </div>
    <div className="usage-settings" role="group" aria-label="会话工具"><AnnotationToggle scope={scope} /><OriginalConversationToggle scope={scope} /><TaskSettings /><Compression key={scope?.sessionId ?? "empty"} scope={scope} />{tools?.global}</div>
  </div>;
}
