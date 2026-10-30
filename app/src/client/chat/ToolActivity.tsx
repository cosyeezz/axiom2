import { createContext, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LocalPath, isLocalPath } from "../LocalPath.js";
import { MessagePartBody } from "./MessagePartBody.js";
import { useRememberedDisclosure, useThreadMessage } from "./OriginalConversation.js";
import { Icon } from "../components.js";
import type { ChatMessage, RunOrigin } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
import { taskToolName } from "../../shared/tasks.js";
import { ProcessIcon } from "./ProcessIcon.js";
import { ThinkingDots } from "./ThinkingDots.js";
import { MemoryQueryFeedback, MemoryQueryStage } from "./MemoryQueryFeedback.js";
import { Markdown } from "./Markdown.js";
import "../styles/activity-status.css";
import { useActivityFacts } from "./ActivityFacts.js";
import { ProcessTitle, ProcessOutcome } from "./ProcessStatus.js";
import type { CallReference } from "../../shared/process-layout.js";
import type { HistoryGroup } from "../../shared/history.js";
import { toolPreview, toolStatusLabels, toolSummary, ordinaryToolStatus, type ToolCall, type ToolStatus } from "./tool-summary.js";

import type { ToolIcon } from "../../shared/tool-summary.js";
export type ActivityFact = { name: string; icon: ToolIcon | "thinking"; target: string; status: ToolStatus; startedAt?: number; durationMs?: number; kind?: "message" | "notice"; evidence?: boolean; hasContent?: boolean; runId?: string; origin?: RunOrigin; order: readonly [number, number] };
export const ActivityExpanded = createContext(true);
export const ActivitySettled = createContext(false);

function CompletedStatusIcon({ animate }: { animate: boolean }) {
  const strokes = [
    { name: "arc", d: "M14 3.223a9.003 9.003 0 0 1 0 17.554", begin: "0.3s", duration: "0.9s" },
    { name: "check", d: "M9 12l2 2l4 -4", begin: "1.2s", duration: "0.8s" },
  ];
  return <svg className="activity-status-completed" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <g className="activity-completed-dashes" opacity={animate ? 0 : 1}>
      {animate && <animate attributeName="opacity" from="0" to="1" begin="0s" dur="0.2s" repeatCount="1" fill="freeze" />}
      <path d="M10 20.777a8.942 8.942 0 0 1 -2.48 -.969" />
      <path d="M4.579 17.093a8.961 8.961 0 0 1 -1.227 -2.592" />
      <path d="M3.124 10.5c.16 -.95 .468 -1.85 .9 -2.675l.169 -.305" />
      <path d="M6.907 4.579a8.954 8.954 0 0 1 3.093 -1.356" />
    </g>
    {strokes.map(stroke => <path key={stroke.name} className={`activity-completed-${stroke.name}`} d={stroke.d} pathLength="100" strokeDasharray="100 100" strokeDashoffset={animate ? 100 : 0} opacity={animate ? 0 : 1}>
      {animate && <>
        <set attributeName="opacity" to="1" begin={stroke.begin} fill="freeze" />
        <animate attributeName="stroke-dashoffset" from="100" to="0" begin={stroke.begin} dur={stroke.duration} calcMode="linear" repeatCount="1" fill="freeze" />
      </>}
    </path>)}
  </svg>;
}

function toolGlyphKind(icon: ActivityFact["icon"]) {
  return icon === "thinking" ? "think" : icon;
}

function ActivitySummary({ fact, settled = false }: { fact: ActivityFact; settled?: boolean }) {
  if (fact.kind === "message" && fact.icon === "thinking") {
    return <><ProcessIcon kind="think" />{!fact.target && fact.name === "thinking" && !settled ? <ThinkingDots /> : <span className="thinking-preview"><Markdown text={fact.target || "思考记录"} compact /></span>}</>;
  }
  return <>{fact.kind ? <span className="tool-icon" data-tool-icon={fact.icon}><Icon name={`tool-${fact.icon}`} /></span> : <ProcessIcon kind={toolGlyphKind(fact.icon)} />}<span><span className="tool-name">{fact.name}</span> · {fact.target}</span></>;
}

export function ActivityGroup({ scope, children, requesting = false, awaitingMore = false, activeRunId, messageIds = [], thinkingOnlyIds = [], callsOnlyIds = [], callIds, inline = false, settled = false, animateFold = false, summary, prefixSummary, disclosureKey, className = "" }: {
  scope: Scope; children: React.ReactNode | ((open: boolean, evidence: Set<string>) => React.ReactNode);
  inline?: boolean; settled?: boolean; animateFold?: boolean; requesting?: boolean;
  awaitingMore?: boolean; activeRunId?: string; messageIds?: string[]; thinkingOnlyIds?: string[]; callsOnlyIds?: string[]; callIds?: string[];
  /** Lightweight archived facts render the original header without reading message bodies. */
  summary?: HistoryGroup["process"];
  /** Archived prefix contributes counts/preview, never overrides a live tail's state. */
  prefixSummary?: HistoryGroup["process"]; disclosureKey?: string; className?: string;
}) {
  const [expanded, setOpen] = useRememberedDisclosure(disclosureKey ?? `process:${JSON.stringify([messageIds, thinkingOnlyIds, callsOnlyIds, callIds, inline])}`, animateFold);
  const [folding, setFolding] = useState(animateFold);
  const card = useRef<HTMLDetailsElement>(null);
  useLayoutEffect(() => {
    if (!folding || !card.current) return;
    const node = card.current;
    const finish = () => { setOpen(false); setFolding(false); };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { finish(); return; }
    const summary = node.querySelector("summary")!;
    const animation = node.animate([
      { height: `${node.getBoundingClientRect().height}px` },
      { height: `${summary.getBoundingClientRect().height + 2}px` },
    ], { duration: 360, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "forwards" });
    animation.onfinish = finish;
    return () => { animation.onfinish = null; animation.cancel(); };
  }, [folding]);
  const entries = useActivityFacts(scope, messageIds, thinkingOnlyIds, callsOnlyIds, callIds);
  const facts = new Map(entries);
  const evidence = new Set(entries.filter(([, fact]) => fact.evidence).map(([id]) => id.slice("message:".length)));
  const items = entries.map(([, fact]) => fact);
  // A streaming placeholder is status, not expandable content. Archived groups
  // still open lazily: their bodies are not present in the live facts snapshot.
  const canExpand = !!summary || !!prefixSummary || items.some(item => !item.kind || item.hasContent);
  const open = expanded && canExpand;
  useEffect(() => { if (!canExpand) setOpen(false); }, [canExpand, setOpen]);
  // Local tool/task outcomes belong to their rows, not the whole process.
  const messages = items.filter((item) => item.kind === "message");
  // Coalesced cards can span runs. Stale deltas from an earlier run must not
  // reactivate it after its successor has already completed.
  const latestRun = messages.findLast(item => !!item.runId)?.runId;
  const currentOrders = new Set(messages.filter(item => !item.runId || item.runId === latestRun).map(item => item.order[0]));
  const currentItems = items.filter(item => currentOrders.has(item.order[0]));
  const running = currentItems.some((item) => item.status === "running");
  // Earlier failed attempts stay visible inside the process; a later assistant
  // continuation determines its eventual outcome, independently of tool results.
  const outcome = messages.at(-1)?.status;
  const failed = outcome === "failed";
  const cancelled = outcome === "cancelled";
  const unknown = currentItems.some((item) => item.status === "unknown");
  const calls = entries.filter(([, fact]) => !fact.kind);
  const ready = messageIds.every(id => facts.has(`message:${id}`));
  // Notices may have no run ID; retain ownership from all messages in the group.
  const awaitingRun = !!activeRunId && items.some(item => item.runId === activeRunId);
  // The current process stays active through recovery; settled history reflects
  // the last assistant outcome without erasing earlier errors from its details.
  const status = summary?.status ?? (settled ? failed ? "failed" : cancelled ? "cancelled" : "completed" : running || requesting || awaitingMore || awaitingRun ? "running" : failed ? "failed" : cancelled ? "cancelled" : unknown || !items.length || !ready ? "unknown" : "completed");
  // Transport phases maintain the row, never invent a new thinking activity.
  // Chronological facts win over stale running flags from an earlier operation.
  const operationItems = activeRunId && activeRunId !== latestRun ? [] : currentItems;
  const currentOperation = operationItems.filter(fact => fact.name).at(-1);
  const thinking = !!currentOperation && currentOperation.kind === "message" && currentOperation.icon === "thinking";
  // A local segment can finish before final delivery. Its label reflects that
  // status; only the delivered outer card owns the checkmark and whole-turn fold.
  const label = status === "running" ? !currentOperation ? "请求中" : thinking ? "正在思考" : "调用工具" : status === "completed" ? "执行完成" : status === "failed" ? "执行失败" : status === "cancelled" ? "执行已停止" : "结果待确认";
  const showStatusIcon = status !== "running" && (!inline || status !== "completed");
  const succeeded = summary?.succeeded ?? (prefixSummary?.succeeded ?? 0) + calls.filter(([, fact]) => fact.status === "completed").length;
  const failedCalls = summary?.failed ?? (prefixSummary?.failed ?? 0) + calls.filter(([, fact]) => fact.status === "failed").length;
  const [statusChange, setStatusChange] = useState(() => ({ status,
    // A newly mounted delivered aggregate is already completed; its explicit
    // live-fold transition must still play the original slow check drawing.
    animateCompletion: animateFold && status === "completed" && !matchMedia("(prefers-reduced-motion: reduce)").matches,
    hasCompleted: status === "completed" }));
  if (statusChange.status !== status) {
    // Facts always determine status; only completion animation is remembered.
    // Resumed activity can reopen the process without replaying completion later.
    setStatusChange({
      status,
      animateCompletion: !statusChange.hasCompleted && statusChange.status === "running" && status === "completed",
      hasCompleted: statusChange.hasCompleted || status === "completed",
    });
  }
  // Call order, not result arrival or status priority, determines the latest activity.
  const summaries = useMemo<[string, ActivityFact][]>(() => summary?.latest
    ? [["archive:latest", { ...summary.latest, order: [0, 0] }]]
    : entries.some(([, fact]) => fact.name) ? entries.filter(([, fact]) => fact.name)
    : prefixSummary?.latest ? [["archive:latest", { ...prefixSummary.latest, order: [0, 0] }]] : [], [summary, prefixSummary, entries]);
  const latest = summaries.at(-1);
  const current = latest?.[1];
  const [previous, setPrevious] = useState<typeof latest>(undefined);
  const [seen, setSeen] = useState(latest);
  if (seen?.[0] !== latest?.[0] || seen?.[1] !== latest?.[1]) {
    if (seen?.[0] !== latest?.[0]) setPrevious(seen);
    setSeen(latest);
  }
  useEffect(() => {
    if (!previous) return;
    const timeout = setTimeout(() => setPrevious(undefined), 320);
    return () => clearTimeout(timeout);
  }, [previous]);
  return <ActivitySettled.Provider value={settled}>
    <details ref={card} className={`activity tool-activity${inline ? " process-live" : ""}${className ? ` ${className}` : ""}`} open={open} data-folding={folding || undefined} data-status={status} data-status-icon={showStatusIcon} data-settled={settled || undefined} data-call-count={summary?.calls ?? (prefixSummary?.calls ?? 0) + calls.length}>
      <summary aria-disabled={!canExpand || undefined} tabIndex={canExpand ? undefined : -1} onClick={(e) => { e.preventDefault(); if (!canExpand) return; if (folding) { setFolding(false); setOpen(true); } else setOpen((value) => !value); }}>
        {showStatusIcon && <span className="activity-status" data-state={status} role="img" aria-label={toolStatusLabels[status]} data-tooltip={toolStatusLabels[status]}>
          {status === "completed" ? <CompletedStatusIcon animate={statusChange.animateCompletion} /> :
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" />{status === "failed" ? <path d="m9 9 6 6m0-6-6 6" /> : status === "cancelled" ? <path d="M9 8v8m6-8v8" /> : <path d="M12 7v6m0 4h.01" />}</svg>}
        </span>}
        <span className="activity-overview">
          <ProcessTitle label={label} active={status === "running"} thinking={thinking} />
        </span>
        {failedCalls > 0 && <span className="process-counts"><span>成功 {succeeded}</span><span data-status={failedCalls ? "failed" : undefined}>失败 {failedCalls}</span></span>}
        {!inline && canExpand && <Icon name="chevron" />}
          {!inline && (!open || folding) && <span className="activity-ticker" aria-live="polite" aria-atomic="true">
            {!current && <span className="activity-current">{status === "running" ? <ThinkingDots /> : summary?.preview || prefixSummary?.preview || "思考与任务记录"}</span>}
            {previous && <span key={`out-${previous[0]}`} className="activity-current activity-current-out" data-tool={previous[1].name} data-status={previous[1].status} aria-hidden="true"><ActivitySummary fact={previous[1]} settled={settled} /></span>}
            {current && <span key={latest![0]} className={`activity-current${previous ? " activity-current-in" : ""}`} data-tool={current.name} data-status={current.status} data-tooltip={current.kind === "message" && current.icon === "thinking" ? undefined : `${current.name} · ${current.target}`}><ActivitySummary fact={current} settled={settled} /></span>}
          </span>}
      </summary>
      <ActivityExpanded.Provider value={open}><div className="activity-content">{typeof children === "function" ? children(open, evidence) : children}</div></ActivityExpanded.Provider>
    </details>
  </ActivitySettled.Provider>;
}

export function ToolElapsed({ status, startedAt, durationMs }: { status: ToolStatus; startedAt?: number; durationMs?: number }) {
  const settled = useContext(ActivitySettled);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (settled || status !== "running" || startedAt === undefined) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [status, startedAt, settled]);
  // A stale running result has no confirmed end time. Do not fabricate an
  // ever-growing duration for an earlier run or a settled archive.
  const elapsed = !settled && status === "running" && startedAt !== undefined ? Math.max(0, now - startedAt) : durationMs;
  const duration = elapsed == null ? "—" : `${(elapsed / 1000).toFixed(1)}s`;
  const label = `${toolStatusLabels[status]} · ${elapsed == null ? "耗时未知" : `耗时 ${duration}`}`;
  if (elapsed != null && elapsed <= 2000) return null;
  const latency = elapsed != null && elapsed > 60000 ? "long" : elapsed != null && elapsed > 10000 ? "slow" : "normal";
  return <small className="tool-duration" data-latency={latency} data-tooltip={label} aria-label={label}>{duration}</small>;
}
export function ToolReference({ scope, reference }: { scope: Scope; reference: CallReference }) {
  const message = useThreadMessage(scope, reference.messageId);
  const call = message?.calls?.find(c => c.id === reference.callId);
  return message && call ? <Tool scope={scope} call={call} message={message} /> : null;
}

function ToolDetails({ scope, call, message, result }: { scope: Scope; call: ToolCall; message: ChatMessage; result: ChatMessage | null }) {
  return <div className="tool-detail">
    <div className="tool-detail-label" data-tooltip={call.name}>输入参数</div>
    <MessagePartBody scope={scope} message={message} callId={call.id} fallback="无输入参数" />
    <div className="tool-detail-label">执行输出</div>
    <MessagePartBody scope={scope} message={result} taskTool={taskToolName(call.name)} />
    {call.name.replace(/^functions\./, "") === "memory_query" && <MemoryQueryFeedback scope={scope} toolCallId={call.id} />}
  </div>;
}

export const Tool = memo(function Tool({ scope, call, message, messageOrder = 0, callOrder = 0 }: { scope: Scope; call: ToolCall; message: ChatMessage; messageOrder?: number; callOrder?: number }) {
  const result = useThreadMessage(scope, `tool-${call.id}`);
  const groupOpen = useContext(ActivityExpanded);
  const [open, setOpen] = useRememberedDisclosure(`tool:${message.id}:${call.id}`);
  useEffect(() => { if (!groupOpen) setOpen(false); }, [groupOpen]);
  const summary = useMemo(() => toolSummary(call), [call.name, call.input, call.summary]);
  const toolPath = useMemo(() => {
    try {
      const input = JSON.parse(call.input), path = input.path ?? input.file_path;
      if (typeof path === "string" && ["read", "edit", "write", "search"].includes(summary.icon)) return path;
    } catch { /* Compact transcript inputs may be incomplete. Never open a truncated path. */ }
    return call.summary && ["read", "edit", "write"].includes(summary.icon) && !summary.target.endsWith("…") ? summary.target : undefined;
  }, [call.input, summary]);
  const detailPath = summary.icon === "search" && summary.detail ? toolPath : undefined;
  const targetPath = detailPath ? undefined : toolPath;
  const settled = useContext(ActivitySettled);
  const status = ordinaryToolStatus(message, result);
  const active = status === "running" && !settled;
  const preview = toolPreview(result);
  return <details className="tool-call" data-status={status} aria-label={summary.label} open={groupOpen && open}>
    <summary className="tool-header" onClick={(event) => { event.preventDefault(); setOpen(value => !value); }}>
      <span className="tool-heading" data-tool={call.name.replace(/^functions\./, "")} data-tooltip={call.name}>
        <ProcessIcon kind={toolGlyphKind(summary.icon)} active={active} />
        <span className={`process-status-text${active ? " is-active" : ""}`}>
          <span className="tool-action-label"><strong className="tool-name">{summary.label}</strong>{!open && " · "}</span>{!open && (targetPath ? <LocalPath path={targetPath} scope={scope}><code className="tool-target">{summary.target}</code></LocalPath> : <code className="tool-target" data-tooltip={summary.target}>{summary.target}</code>)}
          {call.name.replace(/^functions\./, "") === "memory_query" && <MemoryQueryStage scope={scope} toolCallId={call.id} enabled={groupOpen && (active || open)} />}
          {summary.detail && <span className="tool-input-detail"> · {detailPath || isLocalPath(summary.detail) && !summary.detail.endsWith("…") ? <LocalPath path={detailPath ?? summary.detail} scope={scope}>{summary.detail}</LocalPath> : summary.detail}</span>}
        </span>
        {status === "failed" && !open && <span className="tool-input-detail" data-tooltip={preview}>{preview}</span>}
      </span>
      <span className="tool-result-state">{status !== "completed" && <ProcessOutcome status={status} />}<ToolElapsed status={status} startedAt={result?.toolStartedAt} durationMs={result?.durationMs} /></span>
    </summary>
    {groupOpen && open && <ToolDetails scope={scope} call={call} message={message} result={result} />}
  </details>;
});
