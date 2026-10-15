import { createContext, memo, useContext, useEffect, useMemo, useState } from "react";
import { command } from "../transport.js";
import { useThreadMessage } from "./OriginalConversation.js";
import { Icon } from "../components.js";
import { type ChatMessage } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
import { ThinkingDots } from "./ThinkingDots.js";
import { Markdown } from "./Markdown.js";
import "../styles/activity-status.css";
import { toolPreview, toolStatusLabels, toolSummary, type ToolCall, type ToolStatus } from "./tool-summary.js";

export type ActivityFact = { name: string; icon: string; target: string; status: ToolStatus; kind?: "message" | "notice"; runId?: string; order: readonly [number, number] };
type Reporter = (id: string, fact: ActivityFact | null) => void;
export const ActivityContext = createContext<Reporter>(() => {});
export const ActivityExpanded = createContext(true);

function RunningStatusIcon() {
  return <svg className="activity-status-dots" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M0 0h24v24H0z" fill="none" />
    <circle cx="18" cy="12" r="0" fill="currentColor">
      <animate attributeName="r" begin=".67" calcMode="spline" dur="1.5s" keySplines="0.2 0.2 0.4 0.8;0.2 0.2 0.4 0.8;0.2 0.2 0.4 0.8" repeatCount="indefinite" values="0;2;0;0" />
    </circle>
    <circle cx="12" cy="12" r="0" fill="currentColor">
      <animate attributeName="r" begin=".33" calcMode="spline" dur="1.5s" keySplines="0.2 0.2 0.4 0.8;0.2 0.2 0.4 0.8;0.2 0.2 0.4 0.8" repeatCount="indefinite" values="0;2;0;0" />
    </circle>
    <circle cx="6" cy="12" r="0" fill="currentColor">
      <animate attributeName="r" begin="0" calcMode="spline" dur="1.5s" keySplines="0.2 0.2 0.4 0.8;0.2 0.2 0.4 0.8;0.2 0.2 0.4 0.8" repeatCount="indefinite" values="0;2;0;0" />
    </circle>
  </svg>;
}

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

function ActivitySummary({ fact }: { fact: ActivityFact }) {
  if (fact.kind === "message" && fact.icon === "thinking") {
    return fact.name === "thinking" ? <ThinkingDots /> : <span className="thinking-preview"><Markdown text={fact.target} compact /></span>;
  }
  return <><span className="tool-icon" data-tool-icon={fact.icon}><Icon name={`tool-${fact.icon}`} /></span><span><span className="tool-name">{fact.name}</span> · {fact.target}</span></>;
}

export function ActivityGroup({ children, awaitingMore = false, activeRunId, messageIds = [] }: { children: React.ReactNode; awaitingMore?: boolean; activeRunId?: string; messageIds?: string[] }) {
  const [open, setOpen] = useState(false);
  const [facts, setFacts] = useState<Record<string, ActivityFact>>({});
  const report = useMemo<Reporter>(() => (id, fact) => setFacts((previous) => {
    if (fact && previous[id]?.name === fact.name && previous[id]?.icon === fact.icon && previous[id]?.target === fact.target && previous[id]?.status === fact.status && previous[id]?.kind === fact.kind && previous[id]?.runId === fact.runId && previous[id]?.order[0] === fact.order[0] && previous[id]?.order[1] === fact.order[1]) return previous;
    if (!fact && !previous[id]) return previous;
    const next = { ...previous };
    if (fact) next[id] = fact;
    else delete next[id];
    return next;
  }), []);
  const entries = Object.entries(facts).sort((a, b) => a[1].order[0] - b[1].order[0] || a[1].order[1] - b[1].order[1]);
  const items = entries.map(([, fact]) => fact);
  // Local tool/task outcomes belong to their rows, not the whole process.
  const messages = items.filter((item) => item.kind === "message");
  const running = items.some((item) => item.status === "running");
  // Earlier failed attempts stay visible inside the process; a later assistant
  // continuation determines its eventual outcome, independently of tool results.
  const outcome = messages.at(-1)?.status;
  const failed = outcome === "failed";
  const cancelled = outcome === "cancelled";
  const unknown = items.some((item) => item.status === "unknown");
  const calls = entries.filter(([, fact]) => !fact.kind);
  const ready = messageIds.every(id => facts[`message:${id}`]);
  // Notices may have no run ID; retain ownership from all messages in the group.
  const awaitingRun = !!activeRunId && items.some(item => item.runId === activeRunId);
  // The current process stays active through recovery; settled history reflects
  // the last assistant outcome without erasing earlier errors from its details.
  const status = running || awaitingMore || awaitingRun ? "running" : failed ? "failed" : cancelled ? "cancelled" : unknown || !items.length || !ready ? "unknown" : "completed";
  const [statusChange, setStatusChange] = useState({ status, animateCompletion: false, hasCompleted: status === "completed" });
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
  const summaries = entries.filter(([, fact]) => fact.name);
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
  return <ActivityContext.Provider value={report}>
    <details className="activity tool-activity" open={open} data-status={status}>
      <summary onClick={(e) => { e.preventDefault(); setOpen((value) => !value); }}>
        <span className="activity-status" data-state={status} role="img" aria-label={toolStatusLabels[status]} data-tooltip={toolStatusLabels[status]}>
          {status === "running" ? <RunningStatusIcon /> : status === "completed" ? <CompletedStatusIcon animate={statusChange.animateCompletion} /> :
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" />{status === "failed" ? <path d="m9 9 6 6m0-6-6 6" /> : status === "cancelled" ? <path d="M9 8v8m6-8v8" /> : <path d="M12 7v6m0 4h.01" />}</svg>}
        </span>
        <span className="activity-overview">
          <span className="activity-title">执行过程{calls.length ? ` · ${calls.length} 项` : ""}</span>
        </span>
        <Icon name="chevron" />
          {!open && <span className="activity-ticker" aria-live="polite" aria-atomic="true">
            {!current && <span className="activity-current">{status === "running" ? <ThinkingDots /> : "思考与任务记录"}</span>}
            {previous && <span key={`out-${previous[0]}`} className="activity-current activity-current-out" data-tool={previous[1].name} data-status={previous[1].status} aria-hidden="true"><ActivitySummary fact={previous[1]} /></span>}
            {current && <span key={latest![0]} className={`activity-current${previous ? " activity-current-in" : ""}`} data-tool={current.name} data-status={current.status} data-tooltip={current.kind === "message" && current.icon === "thinking" ? undefined : `${current.name} · ${current.target}`}><ActivitySummary fact={current} /></span>}
          </span>}
      </summary>
      <ActivityExpanded.Provider value={open}><div className="activity-content">{children}</div></ActivityExpanded.Provider>
    </details>
  </ActivityContext.Provider>;
}

function ToolDetails({ scope, call, message, result }: { scope: Scope; call: ToolCall; message: ChatMessage; result: ChatMessage | null }) {
  const [full, setFull] = useState<ChatMessage | null>(null);
  const [fullInput, setFullInput] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let active = true;
    setFull(null); setFullInput(null); setError(""); setLoading(false);
    if (!result?.truncated && !message.truncated) return;
    setLoading(true);
    void Promise.all([
      result?.truncated ? command<ChatMessage>("message.get", { id: result.id }, scope) : Promise.resolve(null),
      message.truncated ? command<ChatMessage>("message.get", { id: message.id }, scope) : Promise.resolve(null),
    ]).then(([output, parent]) => {
      if (!active) return;
      setFull(output);
      setFullInput(parent?.calls?.find((item) => item.id === call.id)?.input ?? null);
    }).catch((e: Error) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [scope.workspaceId, scope.sessionId, result, message.id, message.truncated, call.id, call.input, attempt]);
  const output = full ?? result;
  return <div className="tool-detail">
    <div className="tool-detail-label" data-tooltip={call.name}>输入参数</div>
    <pre>{fullInput ?? call.input}</pre>
    <div className="tool-detail-label">执行输出</div>
    <pre>{output?.text || output?.error || "尚未记录输出"}</pre>
    {loading && <p className="tool-truncated" role="status">正在加载完整记录…</p>}
    {error && <p className="execution-alert" role="alert">{error}<button type="button" className="btn" onClick={() => retry((value) => value + 1)}>重新加载</button></p>}
    {output?.truncated && <p className="tool-truncated">当前仅展示部分输出</p>}
    {message.truncated && fullInput === null && <p className="tool-truncated">当前仅展示部分输入</p>}
  </div>;
}

export const Tool = memo(function Tool({ scope, call, message, messageOrder = 0, callOrder = 0 }: { scope: Scope; call: ToolCall; message: ChatMessage; messageOrder?: number; callOrder?: number }) {
  const result = useThreadMessage(scope, `tool-${call.id}`);
  const report = useContext(ActivityContext);
  const groupOpen = useContext(ActivityExpanded);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!groupOpen) setOpen(false); }, [groupOpen]);
  const summary = useMemo(() => toolSummary(call), [call.name, call.input]);
  const status = result?.status || (message.status === "failed" || message.status === "cancelled" ? message.status : message.streaming ? "running" : "unknown");
  const preview = toolPreview(result);
  const duration = result?.durationMs != null ? `${(result.durationMs / 1000).toFixed(1)}s` : "—";
  const durationLabel = `${toolStatusLabels[status]} · ${result?.durationMs != null ? `耗时 ${duration}` : "耗时未知"}`;
  useEffect(() => {
    report(call.id, { name: summary.label, icon: summary.icon, target: `${summary.target}${summary.detail ? ` · ${summary.detail}` : ""}${status === "failed" ? ` · ${preview}` : ""}`, status, order: [messageOrder, callOrder] });
  }, [report, call.id, summary.label, summary.icon, summary.target, summary.detail, status, preview, messageOrder, callOrder]);
  useEffect(() => () => report(call.id, null), [report, call.id]);
  return <details className="tool-call" data-status={status} aria-label={summary.label} open={groupOpen && open}>
    <summary className="tool-header" onClick={(event) => { event.preventDefault(); setOpen(value => !value); }}>
      <span className="tool-heading" data-tool={summary.label} data-tooltip={call.name}><span className="tool-icon" data-tool-icon={summary.icon}><Icon name={`tool-${summary.icon}`} /></span><strong className="tool-name">{summary.label}</strong>{!open && <code className="tool-target" data-tooltip={summary.target}>{summary.target}</code>}{summary.detail && <span className="tool-input-detail">{summary.detail}</span>}{status === "failed" && !open && <span className="tool-input-detail" data-tooltip={preview}>{preview}</span>}</span>
      <small className="tool-duration" data-tooltip={durationLabel} aria-label={durationLabel}>{duration}</small>
    </summary>
    {groupOpen && open && <ToolDetails scope={scope} call={call} message={message} result={result} />}
  </details>;
});
