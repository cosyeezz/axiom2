import { Fragment, memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FilePreviewContext, type OpenFileReference } from "./FileLink.js";
import { FilePreviewPanel } from "./FilePreview.js";
import { useScope } from "../transport.js";
import { updateDraft, getDraft } from "../drafts.js";
import { threadScope, emptyThread, agentScope, emptyAgent, activeStatus, type ThreadIndex } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
import { ModelChangeNotice } from "./ModelChangeNotice.js";
import { Message } from "./Message.js";
import { ActivityGroup } from "./ToolActivity.js";
import { Environment } from "./SessionState.js";
import { optimisticState, useOptimistic } from "./optimistic.js";
import { MessageImages } from "./MessageImages.js";
import { useReadReceipt } from "./useReadReceipt.js";
import { reconcileInputs } from "./reconcile-inputs.js";
import { useStickyDisclosures } from "./useStickyDisclosures.js";
import { OriginalMessages, useOriginalConversation, useThreadMessage } from "./OriginalConversation.js";
import "../styles/thread-navigation.css";
function ThreadActivityGroup({ scope, group, tail, tailReply, index }: {
  scope: Scope; group: NonNullable<ThreadIndex["groups"]>[number]; tail: boolean; tailReply?: string; index: ThreadIndex;
}) {
  const last = useThreadMessage(scope, group.ids.at(-1)!);
  const reply = useThreadMessage(scope, tailReply ?? group.id);
  // A lone following reply can still acquire calls and merge back into this group.
  // New segments, user input, compression and failed/stopped attempts close that window.
  const canContinue = tail || !!tailReply && (!reply || reply.role === "assistant" &&
    !reply.calls?.length && !reply.compression && !reply.taskNotice && !reply.error &&
    reply.status !== "failed" && reply.status !== "cancelled");
  const activeRunId = canContinue && activeStatus(index.runStatus) ? index.runId : undefined;
  const awaitingMore = canContinue && activeStatus(index.runStatus) && (!last?.runId || last.runId === index.runId);
  return <ActivityGroup awaitingMore={awaitingMore} activeRunId={activeRunId} messageIds={group.ids}>
    {group.ids.map((id, activityOrder) => <Message key={id} scope={scope} id={id} inActivity activityOrder={activityOrder} thinkingOnly={group.thinkingOnlyIds?.includes(id)} />)}
  </ActivityGroup>;
}

function ThreadView({ scope, nested = false }: { scope: Scope | null; nested?: boolean }) {
  const [preview, setPreview] = useState<OpenFileReference | null>(null);
  const closePreview = () => { setPreview(null); if (preview?.trigger.isConnected) preview.trigger.focus({ preventScroll: true }); };
  const index = useScope(scope?.sessionId ? threadScope(scope) : null, emptyThread);
  // Keep the collection subscribed even for an empty or entirely compressed thread.
  useScope(scope?.sessionId ? `messages:${scope.workspaceId}:${scope.sessionId}` : null, null);
  const original = useOriginalConversation(scope, index);
  const pending = useOptimistic(scope);
  useEffect(() => {
    if (!scope?.sessionId) return;
    const check = () => { void reconcileInputs(scope).catch(() => {}); };
    check(); const timer = setInterval(check, 5000);
    return () => clearInterval(timer);
  }, [scope?.workspaceId, scope?.sessionId]);
  const info = useScope(scope ? agentScope(scope) : null, emptyAgent);
  const scroller = useRef<HTMLElement>(null), content = useRef<HTMLDivElement>(null), bottom = useRef(true);
  const previousOriginal = useRef(original.enabled);
  useLayoutEffect(() => {
    if (previousOriginal.current !== original.enabled) bottom.current = false;
    previousOriginal.current = original.enabled;
  }, [original.enabled]);
  useStickyDisclosures(content, bottom);
  const [edges, setEdges] = useState({ top: true, bottom: true });
  useReadReceipt(scope, index, info, edges.bottom && original.ready, scroller);
  const measure = () => {
    const el = scroller.current;
    if (!el) return;
    const top = el.scrollTop < 2, end = el.scrollHeight - el.scrollTop - el.clientHeight < 2;
    setEdges((old) => old.top === top && old.bottom === end ? old : { top, bottom: end });
  };
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (bottom.current && !getSelection()?.toString()) scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
      measure();
    });
    if (content.current) observer.observe(content.current);
    if (scroller.current) observer.observe(scroller.current);
    return () => observer.disconnect();
  }, []);
  const visiblePending = pending.filter((item) => !item.queued);
  const lastPendingId = visiblePending.at(-1)?.id;
  useEffect(() => {
    if (lastPendingId) { bottom.current = true; scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }
  }, [lastPendingId]);
  useEffect(() => {
    if (!scope || !info.run || !["failed", "cancelled", "interrupted"].includes(info.run.status)) return;
    for (const item of pending) if (item.state === "accepted" && item.inputId === info.run.id)
      optimisticState(scope, item.id, "uncertain");
  }, [info.run, pending, scope]);
  const groups: NonNullable<ThreadIndex["groups"]> = original.showing ? original.groups
    : index.groups ?? index.ids.map((id) => ({ id, ids: [id], activity: false }));
  const scroll = (direction: "top" | "up" | "down" | "bottom") => {
    const el = scroller.current;
    if (!el) return;
    bottom.current = direction === "bottom";
    const top = direction === "top" ? 0 : direction === "bottom" ? el.scrollHeight
      : el.scrollTop + (direction === "up" ? -1 : 1) * el.clientHeight * 0.85;
    el.scrollTo({ top, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };
  return <FilePreviewContext.Provider value={setPreview}><div className="thread-shell">
    <section ref={scroller} className="thread" id={nested ? undefined : "thread"} aria-label="消息记录"
      onScroll={(e) => { const n = e.currentTarget; bottom.current = n.scrollHeight - n.scrollTop - n.clientHeight < 60; measure(); }}>
      <div ref={content} className="container thread-content"><div id={nested ? undefined : "messages"}>
        {scope?.sessionId && <Environment scope={scope} />}
        {index.error && <p className="execution-alert">{index.error}</p>}
        {original.enabled && <div className="original-conversation-status" role="status">
          {original.error ? "原始会话读取失败，已保留当前对话" : original.loading ? "正在读取原始会话…" : "正在查看原始会话"}
          {original.error && <p className="execution-alert" role="alert">{original.error} <button type="button" className="btn" onClick={original.retry}>重新加载</button></p>}
        </div>}
        <OriginalMessages.Provider value={original.showing ? original.messages : null}>
        {scope?.sessionId && groups.map((group, groupIndex) => <Fragment key={group.id}>
          {group.selectionChange && <ModelChangeNotice change={group.selectionChange} />}
          {group.activity ? <ThreadActivityGroup scope={scope} group={group} tail={groupIndex === groups.length - 1}
            tailReply={groupIndex === groups.length - 2 && !groups[groupIndex + 1].activity && !groups[groupIndex + 1].selectionChange ? groups[groupIndex + 1].id : undefined} index={index} />
            : <Message scope={scope} id={group.id} hideThinking={group.hideThinking} activeRunId={groupIndex === groups.length - 1 && activeStatus(index.runStatus) ? index.runId : undefined} />}
        </Fragment>)}
        </OriginalMessages.Provider>
        {scope && visiblePending.map((item) => <article key={item.id} className="log-row message-result" aria-label="用户消息">
          <div><div className="message-body user-text"><p style={{ whiteSpace: "pre-wrap" }}>{item.draft.text}</p>
            {(item.draft.attachments ?? []).filter((a) => a.kind !== "image").map((a) => <span className="meta" key={a.id}>{a.name} </span>)}
            <MessageImages images={item.message.images} scope={scope} messageId={item.id} />
          </div><small className="meta" role="status">
            {{ sending: "正在发送…", accepted: "已受理，等待进入会话", uncertain: "正在确认发送结果…" }[item.state]}
          </small></div>
        </article>)}
        {!groups.length && !pending.length && !index.error && !original.loading && !original.error && <div className="empty-state">
          <h2>从一个想法，一行代码开始。</h2><p>描述目标、粘贴代码，或附上需要检查的文件。支持 Markdown。</p>
          <div className="quick-prompts">{[["审查代码", "帮我分析这段代码的潜在问题："], ["规划功能", "请帮我规划以下功能的实现步骤："], ["排查错误", "请解释以下错误，并给出排查建议："]].map(([label, text]) =>
            <button className="btn" key={label} disabled={!scope?.sessionId} onClick={() => {
              updateDraft(scope!, { text }); document.getElementById(nested ? `prompt-${scope!.sessionId}` : "prompt")?.focus();
            }}>{label}</button>)}</div>
        </div>}
      </div></div>
    </section>
    <nav className="thread-navigation" aria-label="会话滚动">
      {([ ["top", "回到最上", "M7 5h10M7 14l5-5 5 5M12 9v11"], ["up", "向上滚动一屏", "m6 15 6-6 6 6"],
        ["down", "向下滚动一屏", "m6 9 6 6 6-6"], ["bottom", "回到最下", "M7 19h10M7 10l5 5 5-5M12 4v11"] ] as const).map(([direction, label, path]) =>
        <button type="button" className="action-icon" key={direction} data-tooltip={label} aria-label={label} disabled={direction === "top" || direction === "up" ? edges.top : edges.bottom} onClick={() => scroll(direction)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>
        </button>)}
    </nav>
    {preview && <FilePreviewPanel key={`${preview.messageId}:${preview.href}`} reference={preview} onClose={closePreview} />}
  </div></FilePreviewContext.Provider>;
}

// Remount local viewing state on every workspace/session change, including child views.
export const AgentThread = memo(function AgentThread(props: { scope: Scope | null; nested?: boolean }) {
  return <ThreadView key={`${props.scope?.workspaceId}:${props.scope?.sessionId}`} {...props} />;
});
