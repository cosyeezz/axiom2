import { memo, useState } from "react";
import { command, useScope } from "../transport.js";
import { Icon } from "../components.js";
import { messageScope, type ChatMessage } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
import { TaskCards } from "../tasks/TaskCards.js";
import { TaskOperation } from "../tasks/TaskOperation.js";
import { taskToolName } from "../../shared/tasks.js";
import { AnnotatedReply } from "./ReplyAnnotations.js";
import { Markdown } from "./Markdown.js";
import { CompressionSummary } from "./CompressionSummary.js";
import { MessageImages } from "./MessageImages.js";
import { ActivityMessageFact, ActivityTaskFact } from "./ActivityFacts.js";
import { ActivityGroup, Tool } from "./ToolActivity.js";
import { TaskNotice } from "./TaskNotice.js";
import { Thinking } from "./Thinking.js";
import { CopyReply } from "./CopyReply.js";
function FullMessage({ scope, id }: { scope: Scope; id: string }) {
  const [text, setText] = useState("");
  return (
    <>
      <button
        type="button"
        className="btn"
        onClick={async () => {
          try {
            const m = await command<ChatMessage>("message.get", { id }, scope);
            setText(m.text);
          } catch (e) {
            setText((e as Error).message);
          }
        }}
      >
        展开完整文本
      </button>
      {text && <pre>{text}</pre>}
    </>
  );
}
function CompactionCard({ m, scope, id }: { m: ChatMessage; scope: Scope; id: string }) {
  const [open, setOpen] = useState(false);
  const [fullText, setFullText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const compression = m.compression!;
  const loadFull = async () => {
    setLoading(true);
    setError("");
    try {
      const full = await command<ChatMessage>("message.get", { id }, scope);
      setFullText(full.text);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return <details className="compaction-card" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>
      <span className="compaction-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 3v5h5M20 21v-5h-5M4 8l5-5M20 16l-5 5M4 12h16" />
        </svg>
      </span>
      <span className="compaction-heading">
        <span className="compaction-number">上下文压缩 <span>#{String(compression.number).padStart(2, "0")}</span></span>
        <span className="compaction-title">{compression.title}</span>
      </span>
      <span className="compaction-tokens" title="pi 内容估算，不是计费用量">
        <span className="compaction-token-values"><span>≈{compression.before.toLocaleString()}</span><span className="compaction-arrow" aria-label="压缩至">→</span><span className="compaction-token-after">{compression.after == null ? "—" : `≈${compression.after.toLocaleString()}`}</span></span>
        <span className="compaction-token-label">Token · 估算</span>
      </span>
      <span className="compaction-chevron" aria-hidden="true"><Icon name="chevron" /></span>
    </summary>
    {open && <div className="compaction-body">
      <CompressionSummary text={fullText ?? m.text} />
      {m.truncated && fullText === null && <div className="compaction-load">
        <span>摘要较长，当前仅展示部分内容</span>
        <button type="button" className="btn" disabled={loading} onClick={loadFull}>{loading ? "正在加载…" : "展开完整文本"}</button>
        {error && <p role="alert">{error}</p>}
      </div>}
    </div>}
  </details>;
}
export const Message = memo(function Message({
  scope,
  id,
  inActivity = false,
  activityOrder = 0,
  thinkingOnly = false,
  hideThinking = false,
}: {
  scope: Scope;
  id: string;
  inActivity?: boolean;
  activityOrder?: number;
  thinkingOnly?: boolean;
  hideThinking?: boolean;
}) {
  const m = useScope<ChatMessage | null>(messageScope(scope, id), null);
  if (!m || m.role === "toolResult") return null;
  if (!thinkingOnly && m.compression) return <CompactionCard m={m} scope={scope} id={id} />;
  if (!thinkingOnly && m.taskNotice) return <><ActivityMessageFact message={m} order={activityOrder} /><TaskNotice message={m} /></>;
  const hasProcess = !!(m.thinking || m.thinkingActive || m.calls?.length);
  const process = <>
    <ActivityMessageFact message={m} order={activityOrder} />
    {!hideThinking && (m.thinking || m.thinkingActive) && <Thinking text={m.thinking ?? ""} active={!!m.thinkingActive && !!m.streaming} />}
    {!thinkingOnly && m.calls?.map((call, callOrder) => {
      const name = taskToolName(call.name);
      const key = `${scope.workspaceId}:${scope.sessionId}:${call.id}`;
      if (name) return <div key={key}>
        <ActivityTaskFact scope={scope} call={call} message={m} order={activityOrder} callOrder={callOrder} />
        {name === "delegate" ? <TaskCards scope={scope} call={call} message={m} /> : <TaskOperation scope={scope} call={call} message={m} name={name} />}
      </div>;
      return <Tool key={key} scope={scope} call={call} message={m} messageOrder={activityOrder} callOrder={callOrder} />;
    })}
  </>;
  return (
    <article
      className={`log-row${inActivity ? " activity-message" : m.streaming ? " message-progress" : " message-result"}${m.status === "cancelled" ? " message-stopped" : ""}`}
      aria-label={m.role === "user" ? "用户消息" : "助手回复"}
    >
      <div>
        {!thinkingOnly && m.status === "cancelled" && (
          <p className="message-state">回复已停止</p>
        )}
        {hasProcess && (inActivity ? process : <ActivityGroup>{process}</ActivityGroup>)}
        {!thinkingOnly && <><div
          className={`message-body${m.role === "user" ? " user-text" : ""}${m.role === "assistant" && !inActivity && m.text ? " reply-body" : ""}${m.images?.length ? " has-image-attachments" : ""}`}
        >
          {m.role === "assistant" && !m.streaming && !inActivity && !!m.text &&
            <CopyReply key={`${scope.workspaceId}:${scope.sessionId}:${id}`} message={m} scope={scope} />}
          {m.text && <div className="markdown">{m.role === "assistant" && !inActivity ?
            <AnnotatedReply scope={scope} messageId={id} text={m.text} streaming={m.streaming} /> :
            <Markdown text={m.text} images={m.role === "assistant" ? { scope, messageId: id } : undefined} />}</div>}
          <MessageImages key={`${scope.workspaceId}:${scope.sessionId}:${id}`} images={m.images} scope={scope} messageId={id} />
        </div>
        {m.error && (
          <p className="execution-alert" role="alert">
            {m.error}
          </p>
        )}
        {m.truncated && <FullMessage scope={scope} id={id} />}</>}
      </div>
    </article>
  );
});
