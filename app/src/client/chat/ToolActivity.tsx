import { createContext, memo, useContext, useEffect, useMemo, useState } from "react";
import { command, useScope } from "../transport.js";
import { Icon } from "../components.js";
import { messageScope, type ChatMessage } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
import { ThinkingDots } from "./ThinkingDots.js";
import "../styles/activity-status.css";
import { toolPreview, toolStatusLabels, toolSummary, type ToolCall, type ToolStatus } from "./tool-summary.js";

export type ActivityFact = { name: string; icon: string; target: string; status: ToolStatus; kind?: "message" | "notice"; order: readonly [number, number] };
type Reporter = (id: string, fact: ActivityFact | null) => void;
export const ActivityContext = createContext<Reporter>(() => {});
export const ActivityExpanded = createContext(true);

function ActivitySummary({ fact }: { fact: ActivityFact }) {
  return <><span className="tool-icon" data-tool-icon={fact.icon}><Icon name={`tool-${fact.icon}`} /></span>{fact.kind === "message" && fact.name === "thinking" ? <ThinkingDots /> : <span><span className="tool-name">{fact.name}</span> · {fact.target}</span>}</>;
}

export function ActivityGroup({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [facts, setFacts] = useState<Record<string, ActivityFact>>({});
  const report = useMemo<Reporter>(() => (id, fact) => setFacts((previous) => {
    if (fact && previous[id]?.name === fact.name && previous[id]?.icon === fact.icon && previous[id]?.target === fact.target && previous[id]?.status === fact.status && previous[id]?.kind === fact.kind && previous[id]?.order[0] === fact.order[0] && previous[id]?.order[1] === fact.order[1]) return previous;
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
  const failed = messages.some((item) => item.status === "failed");
  const cancelled = messages.some((item) => item.status === "cancelled");
  const unknown = items.some((item) => item.status === "unknown");
  const calls = entries.filter(([, fact]) => !fact.kind);
  const status = running ? "running" : failed ? "failed" : cancelled ? "cancelled" : unknown || !items.length ? "unknown" : "completed";
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
        <span className="activity-status" data-state={status} role="img" aria-label={toolStatusLabels[status]} title={toolStatusLabels[status]}>
          {status === "running" || status === "completed" ? <span className="activity-status-glyph" /> :
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" />{status === "failed" ? <path d="m9 9 6 6m0-6-6 6" /> : status === "cancelled" ? <path d="M9 8v8m6-8v8" /> : <path d="M12 7v6m0 4h.01" />}</svg>}
        </span>
        <span className="activity-overview">
          <span className="activity-title">执行过程{calls.length ? ` · ${calls.length} 项` : ""}</span>
        </span>
        <Icon name="chevron" />
          {!open && <span className="activity-ticker" aria-live="polite" aria-atomic="true">
            {!current && <span className="activity-current">{status === "running" ? <ThinkingDots /> : "思考与任务记录"}</span>}
            {previous && <span key={`out-${previous[0]}`} className="activity-current activity-current-out" data-tool={previous[1].name} aria-hidden="true"><ActivitySummary fact={previous[1]} /></span>}
            {current && <span key={latest![0]} className={`activity-current${previous ? " activity-current-in" : ""}`} data-tool={current.name} title={current.name === "thinking" ? undefined : `${current.name} · ${current.target}`}><ActivitySummary fact={current} /></span>}
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
    <div className="tool-detail-label" title={call.name}>输入参数</div>
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
  const result = useScope<ChatMessage | null>(messageScope(scope, `tool-${call.id}`), null);
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
      <span className="tool-heading" data-tool={summary.label} title={call.name}><span className="tool-icon" data-tool-icon={summary.icon}><Icon name={`tool-${summary.icon}`} /></span><strong className="tool-name">{summary.label}</strong>{!open && <code className="tool-target" title={summary.target}>{summary.target}</code>}{summary.detail && <span className="tool-input-detail">{summary.detail}</span>}{status === "failed" && !open && <span className="tool-input-detail" title={preview}>{preview}</span>}</span>
      <small className="tool-duration" title={durationLabel} aria-label={durationLabel}>{duration}</small>
    </summary>
    {groupOpen && open && <ToolDetails scope={scope} call={call} message={message} result={result} />}
  </details>;
});
