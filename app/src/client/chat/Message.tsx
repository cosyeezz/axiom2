import { EditableUserMessage } from "./EditableUserMessage.js";
import { commitDelivery } from "../latency.js";
import { memo, useContext, useLayoutEffect, useState } from "react";
import { useFullMessage } from "./useFullMessage.js";
import { useThreadMessage } from "./OriginalConversation.js";
import { Icon } from "../components.js";
import { FoldIcon } from "../StatusIcons.js";
import { type ChatMessage } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
import { TaskCards } from "../tasks/TaskCards.js";
import { TaskOperation } from "../tasks/TaskOperation.js";
import { taskToolName } from "../../shared/tasks.js";
import { AnnotatedReply } from "./ReplyAnnotations.js";
import { Markdown } from "./Markdown.js";
import { CompressionSummary } from "./CompressionSummary.js";
import { MessageImages } from "./MessageImages.js";
import { ActivityExpanded, ActivityGroup, Tool } from "./ToolActivity.js";
import { TaskNotice } from "./TaskNotice.js";
import { Thinking } from "./Thinking.js";
import { CopyReply } from "./CopyReply.js";
function FullMessageControl({ loading, error, load }: { loading?: boolean; error?: string; load: () => Promise<void> }) {
  return <div className="message-full-control">
    <button type="button" className="btn" disabled={loading} onClick={() => void load()}>{loading ? "正在加载…" : error ? "重新加载完整文本" : "展开完整文本"}</button>
    {loading && <span role="status" className="meta">正在读取完整文本…</span>}
    {error && <p className="execution-alert" role="alert">{error}</p>}
  </div>;
}
function CompactionCard({ m, scope, id }: { m: ChatMessage; scope: Scope; id: string }) {
  const [open, setOpen] = useState(false);
  const full = useFullMessage(scope, m);
  const compression = m.compression!;
  return <details className="compaction-card" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>
      <span className="compaction-icon" aria-hidden="true">
        <FoldIcon />
      </span>
      <span className="compaction-heading">
        <span className="compaction-number">上下文压缩 <span>#{String(compression.number).padStart(2, "0")}</span></span>
        <span className="compaction-title">{compression.title}</span>
      </span>
      <span className="compaction-tokens" data-tooltip="pi 内容估算，不是计费用量">
        <span className="compaction-token-values"><span>≈{compression.before.toLocaleString()}</span><span className="compaction-arrow" aria-label="压缩至">→</span><span className="compaction-token-after">{compression.after == null ? "—" : `≈${compression.after.toLocaleString()}`}</span></span>
        <span className="compaction-token-label">Token · 估算</span>
      </span>
      <span className="compaction-chevron" aria-hidden="true"><Icon name="chevron" /></span>
    </summary>
    {open && <div className="compaction-body">
      <CompressionSummary text={full.message?.text ?? m.text} />
      {m.truncated && !full.message && <div className="compaction-load">
        <span>摘要较长，当前仅展示部分内容</span>
        <FullMessageControl {...full} />
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
  callsOnly = false,
  activeRunId,
  initialTaskInputId,
}: {
  scope: Scope;
  id: string;
  inActivity?: boolean;
  activityOrder?: number;
  thinkingOnly?: boolean;
  hideThinking?: boolean;
  callsOnly?: boolean;
  activeRunId?: string;
  initialTaskInputId?: string | null;
}) {
  const source = useThreadMessage(scope, id);
  const full = useFullMessage(scope, source);
  const m = source && full.message ? {
    ...source,
    text: full.message.text,
    thinking: full.message.thinking ?? source.thinking,
    calls: full.message.calls ?? source.calls,
    images: full.message.images ?? source.images,
    truncated: false,
  } : source;
  const groupOpen = useContext(ActivityExpanded);
  useLayoutEffect(() => {
    if (source?.role === "assistant" && (!inActivity || groupOpen)) commitDelivery(source);
  }, [source, inActivity, groupOpen]);
  if (!m || m.role === "toolResult") return null;
  // The structured brief at the beginning of this child thread owns the
  // initial delegation. Never suppress legacy or batched input messages.
  if (m.role === "user" && initialTaskInputId && m.inputIds?.length === 1 && m.inputIds[0] === initialTaskInputId) return null;
  if (!thinkingOnly && m.compression) return <CompactionCard m={m} scope={scope} id={id} />;
  if (!thinkingOnly && m.taskNotice) return <TaskNotice message={m} />;
  // Body and process slices subscribe to the same message without moving text
  // when a later tool call or a disclosure toggle arrives.
  const hasProcess = inActivity || !!(!hideThinking && (m.thinking || m.thinkingActive || m.calls?.length));
  const process = (expanded: boolean, part: "thinking" | "calls" | "all" = "all") => <>
    {part !== "calls" && expanded && !hideThinking && !callsOnly && (m.thinking || m.thinkingActive) && <Thinking scope={scope} message={m} text={m.thinking ?? ""} active={!!m.thinkingActive && !!m.streaming} />}
    {part !== "thinking" && !hideThinking && !thinkingOnly && m.calls?.map((call, callOrder) => {
      const name = taskToolName(call.name);
      const key = `${scope.workspaceId}:${scope.sessionId}:${call.id}`;
      if (name) return <div key={key}>
        {name === "delegate" ? <TaskCards scope={scope} call={call} message={m} /> : <TaskOperation scope={scope} call={call} message={m} name={name} />}
      </div>;
      return expanded ? <Tool key={key} scope={scope} call={call} message={m} messageOrder={activityOrder} callOrder={callOrder} /> : null;
    })}
  </>;
  return (
    <article
      className={`log-row${inActivity ? " activity-message" : m.streaming ? " message-progress" : " message-result"}${m.status === "cancelled" ? " message-stopped" : ""}`}
      aria-label={m.role === "user" ? "用户消息" : "助手回复"}
    >
      <div>
        {!thinkingOnly && !callsOnly && m.status === "cancelled" && (
          <p className="message-state">回复已停止</p>
        )}
        {inActivity && !thinkingOnly && !callsOnly && m.error && <p className="execution-alert" role="alert">{m.error}</p>}
        {hasProcess && (inActivity ? process(groupOpen, "thinking") : <ActivityGroup inline scope={scope} messageIds={[m.id]} awaitingMore={!!activeRunId && m.runId === activeRunId}>{(open) => process(open)}</ActivityGroup>)}
        {!thinkingOnly && !callsOnly && (!inActivity || groupOpen) && <>{m.role === "user" ? <EditableUserMessage key={`${scope.workspaceId}:${scope.sessionId}:${id}`} message={m} scope={scope} /> : (m.text || m.images?.length) ? <div
          className={`message-body${m.role === "assistant" && m.text ? " reply-body" : ""}${m.images?.length ? " has-image-attachments" : ""}`}
        >
          {m.text && <div className="markdown">{m.role === "assistant" && !inActivity ?
            <AnnotatedReply scope={scope} messageId={id} text={m.text} streaming={m.streaming} /> :
            <Markdown text={m.text} images={m.role === "assistant" ? { scope, messageId: id } : undefined} />}</div>}
          <MessageImages key={`${scope.workspaceId}:${scope.sessionId}:${id}`} images={m.images} scope={scope} messageId={id} />
        </div> : null}
        {!inActivity && m.error && (
          <p className="execution-alert" role="alert">
            {m.error}
          </p>
        )}
        {!full.message && (m.textLength !== undefined ? m.textLength > m.text.length : m.truncated) && <FullMessageControl {...full} />}
        {/* Only a finished final delivery owns the reply copy action. */}
        {m.role === "assistant" && !inActivity && (!activeRunId || !!m.runId && m.runId !== activeRunId) && m.phase === "final_answer" && !m.streaming &&
          (!m.status || m.status === "completed") && !m.error && !m.calls?.length && !!m.text &&
          <CopyReply key={`copy:${scope.workspaceId}:${scope.sessionId}:${id}`} message={m} scope={scope} />}</>}
        {inActivity && process(groupOpen, "calls")}
      </div>
    </article>
  );
});
