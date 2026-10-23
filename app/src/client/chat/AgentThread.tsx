import { TaskBrief } from "../tasks/TaskBrief.js";
import type { Task } from "../../shared/tasks.js";
import { Fragment, memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FilePreviewOutlet } from "./FilePreviewHost.js";
import { useScope, useScopeOrder } from "../transport.js";
import { updateDraft, getDraft } from "../drafts.js";
import { threadScope, emptyThread, agentScope, emptyAgent, activeStatus, type ThreadIndex } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
import { ModelChangeNotice } from "./ModelChangeNotice.js";
import { Message } from "./Message.js";
import { ProcessFlow } from "./ProcessFlow.js";
import { ModelRequestStatus } from "./ProcessStatus.js";
import { RetryAction } from "./RetryAction.js";
import { Environment } from "./SessionState.js";
import { RestoreSubmission } from "./RestoreSubmission.js";
import { optimisticState, pendingMessageStatus, useOptimistic } from "./optimistic.js";
import { SkillCards } from "./SkillCards.js";
import { Markdown } from "./Markdown.js";
import { MessageImages } from "./MessageImages.js";
import { useReadReceipt } from "./useReadReceipt.js";
import { reconcileInputs } from "./reconcile-inputs.js";
import { useStickyDisclosures } from "./useStickyDisclosures.js";
import { useDisclosureReveal } from "./useDisclosureReveal.js";
import { useThreadScrollIntent } from "./useThreadScrollIntent.js";
import { OriginalMessages, useOriginalConversation, useThreadMessage } from "./OriginalConversation.js";
import { DerivedContext, sessionDerivedCache } from "./derived-cache.js";
import "../styles/thread-navigation.css";
function requestingModel(index: ThreadIndex) {
  return activeStatus(index.runStatus) && index.runStatus !== "stopping" && index.runPhase === "requesting";
}
function ThreadActivityGroup({ scope, group, tail, index, animateFold }: {
  scope: Scope; group: NonNullable<ThreadIndex["groups"]>[number]; tail: boolean; index: ThreadIndex; animateFold: boolean;
}) {
  const last = useThreadMessage(scope, group.ids.at(-1)!);
  const activeRunId = tail && activeStatus(index.runStatus) ? index.runId : undefined;
  const awaitingMore = tail && activeStatus(index.runStatus) && (!last?.runId || last.runId === index.runId);
  const requesting = tail && requestingModel(index);
  const requestInGroup = requesting && !group.folded && !!last?.runId && last.runId === index.runId;
  return <><ProcessFlow scope={scope} group={group} awaitingMore={awaitingMore} activeRunId={activeRunId} settled={!tail} animateFold={animateFold} requesting={requestInGroup} />
    {requesting && !requestInGroup && <ModelRequestStatus />}</>;
}

type ThreadProps = { scope: Scope | null; nested?: boolean; readingRevision?: number; task?: Task; briefRevision?: number };
function ThreadView({ scope, nested = false, readingRevision = 0, task, briefRevision = 0 }: ThreadProps) {
  const index = useScope(scope?.sessionId ? threadScope(scope) : null, emptyThread);
  // Keep the collection subscribed even for an empty or entirely compressed thread.
  const messagesReceived = useScopeOrder(scope?.sessionId ? `messages:${scope.workspaceId}:${scope.sessionId}` : null);
  const threadReceived = useScopeOrder(scope?.sessionId ? threadScope(scope) : null);
  useScopeOrder(scope?.sessionId ? agentScope(scope) : null);
  const historyReceived = !scope?.sessionId || !!messagesReceived && !!threadReceived;
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
  const smoothBottomTarget = useRef<number | null>(null), scrollPosition = useRef(0);
  useThreadScrollIntent(scroller, bottom, scrollPosition);
  const cancelReveal = useDisclosureReveal(scroller, bottom, scrollPosition);
  const selectingMessages = () => {
    const el = scroller.current, selection = getSelection();
    return !!el && !!selection?.toString() &&
      (el.contains(selection.anchorNode) || el.contains(selection.focusNode));
  };
  const scrollToBottom = () => {
    cancelReveal();
    const el = scroller.current;
    if (!el) return;
    smoothBottomTarget.current = null;
    el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
    scrollPosition.current = el.scrollTop;
  };
  // Includes keyboard activation and controls loading content asynchronously.
  const pauseFollowing = () => {
    cancelReveal();
    bottom.current = false;
    smoothBottomTarget.current = null;
    const el = scroller.current;
    if (el) {
      el.scrollTo({ top: el.scrollTop, behavior: "instant" });
      scrollPosition.current = el.scrollTop;
    }
  };
  // Sibling disclosures can resize the thread without a click inside its scroller.
  useLayoutEffect(() => {
    if (readingRevision) pauseFollowing();
  }, [readingRevision]);
  useLayoutEffect(() => {
    if (!briefRevision || !historyReceived || !original.ready) return;
    pauseFollowing();
    const frame = requestAnimationFrame(() => {
      const brief = content.current?.querySelector<HTMLElement>("[data-task-brief]");
      brief?.scrollIntoView({ block: "start", behavior: "instant" });
      brief?.focus({ preventScroll: true });
      if (scroller.current) scrollPosition.current = scroller.current.scrollTop;
    });
    return () => cancelAnimationFrame(frame);
  }, [briefRevision, historyReceived, original.ready]);
  const previousOriginal = useRef(original.enabled);
  useLayoutEffect(() => {
    if (previousOriginal.current !== original.enabled) { cancelReveal(); bottom.current = false; }
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
  // A new keyed view starts at the latest message, including asynchronously loaded history.
  // This positioning is independent of selections left elsewhere in the workbench.
  useLayoutEffect(() => {
    if (!historyReceived || !bottom.current) return;
    scrollToBottom();
    measure();
  }, [historyReceived]);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (bottom.current && !selectingMessages()) scrollToBottom();
      measure();
    });
    if (content.current) observer.observe(content.current);
    if (scroller.current) observer.observe(scroller.current);
    return () => observer.disconnect();
  }, []);
  const visiblePending = pending.filter((item) => !item.queued);
  const previousPendingIds = useRef(new Set<string>());
  useLayoutEffect(() => {
    // Queued steering is a new submission too, even before it becomes a chat bubble.
    // Receipts/removals must not make an older pending item look like another send.
    const submitted = pending.some((item) => !previousPendingIds.current.has(item.id));
    previousPendingIds.current = new Set(pending.map((item) => item.id));
    if (submitted) {
      // Sending ends selection-based reading in this thread, including button submissions.
      if (selectingMessages()) getSelection()?.removeAllRanges();
      bottom.current = true;
      scrollToBottom();
      measure();
    }
  }, [pending]);
  useEffect(() => {
    if (!scope || !info.run || !["failed", "cancelled", "interrupted"].includes(info.run.status)) return;
    for (const item of pending) if (item.state === "accepted" && item.inputId === info.run.id)
      optimisticState(scope, item.id, "uncertain");
  }, [info.run, pending, scope]);
  const groups: NonNullable<ThreadIndex["groups"]> = original.showing ? original.groups
    : index.groups ?? index.ids.map((id) => ({ id, ids: [id], activity: false }));
  const previousGroups = useRef(groups);
  const folding = new Set(groups.filter(group => group.folded && !previousGroups.current.some(previous => previous.id === group.id) &&
    previousGroups.current.some(previous => !previous.folded && previous.ids.some(id => group.ids.includes(id)))).map(group => group.id));
  useLayoutEffect(() => { previousGroups.current = groups; }, [groups]);
  const scroll = (direction: "top" | "up" | "down" | "bottom") => {
    cancelReveal();
    const el = scroller.current;
    if (!el) return;
    bottom.current = direction === "bottom";
    const top = direction === "top" ? 0 : direction === "bottom" ? el.scrollHeight
      : el.scrollTop + (direction === "up" ? -1 : 1) * el.clientHeight * 0.85;
    const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
    smoothBottomTarget.current = direction === "bottom" && behavior === "smooth" ? el.scrollHeight - el.clientHeight : null;
    el.scrollTo({ top, behavior });
  };
  return <div className="thread-shell">
    <section ref={scroller} className="thread" id={nested ? undefined : "thread"} aria-label="消息记录"
      onClickCapture={(event) => {
        // Plain text/background clicks do not express an intent to stop following.
        // Pause before controls expand or asynchronously load content for reading.
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("summary, button, a, input, textarea, select, [role=button]")) pauseFollowing();
      }}
      onScroll={(e) => {
        const n = e.currentTarget;
        const movedDown = n.scrollTop > scrollPosition.current;
        scrollPosition.current = n.scrollTop;
        // Reconciliation can shrink, clamp and regrow the tail before this event arrives.
        // Scroll direction alone cannot distinguish that from a user's upward gesture.
        // Let explicit navigation finish its smooth movement; layout changes still follow via ResizeObserver.
        const navigating = smoothBottomTarget.current !== null && n.scrollTop < smoothBottomTarget.current - 2;
        if (bottom.current && !selectingMessages() && !navigating) scrollToBottom();
        else if (movedDown && n.scrollHeight - n.scrollTop - n.clientHeight < 2) bottom.current = true;
        measure();
      }}>
      <div ref={content} className="container thread-content"><div id={nested ? undefined : "messages"}>
        {task && <TaskBrief task={task} reveal={briefRevision} />}
        {scope?.sessionId && <Environment scope={scope} />}
        {index.error && <p className="execution-alert">{index.error}</p>}
        {original.enabled && <div className="original-conversation-status" role="status">
          {original.error ? "原始会话读取失败，已保留当前对话" : original.loading ? "正在读取原始会话…" : "正在查看原始会话"}
          {original.error && <p className="execution-alert" role="alert">{original.error} <button type="button" className="btn" onClick={original.retry}>重新加载</button></p>}
        </div>}
        <DerivedContext.Provider value={original.showing ? original.messages.derived : sessionDerivedCache(`${scope?.workspaceId}:${scope?.sessionId}`)}>
        <OriginalMessages.Provider value={original.showing ? original.messages : null}>
        {scope?.sessionId && groups.map((group, groupIndex) => <Fragment key={group.id}>
          {group.selectionChange && <ModelChangeNotice change={group.selectionChange} />}
          {group.activity ? <ThreadActivityGroup scope={scope} group={group} tail={groupIndex === groups.length - 1} index={index} animateFold={folding.has(group.id)} />
            : <Message scope={scope} id={group.id} initialTaskInputId={task?.initialInputId} hideThinking={group.hideThinking} activeRunId={activeStatus(index.runStatus) ? index.runId : undefined} />}
        </Fragment>)}
        </OriginalMessages.Provider>
        </DerivedContext.Provider>
        {scope && visiblePending.map((item) => <article key={item.id} className="log-row message-result" aria-label="用户消息">
          <div><div className="message-body user-text"><div className="markdown"><Markdown text={item.draft.text} attachments={[...(item.draft.attachments ?? []), ...(item.draft.images ?? []).map(image => ({ ...image, kind: "image" }))]} /></div>
            {(item.draft.attachments ?? []).filter((a) => a.kind !== "image").map((a) => <span className="meta" key={a.id}>{a.name} </span>)}
            <SkillCards skills={item.draft.skills} scope={scope} />
            <MessageImages images={item.message.images} scope={scope} messageId={item.id} />
          </div><small className="meta" role="status">
            {pendingMessageStatus(item)}
          </small>
          {item.state === "failed" && <RestoreSubmission scope={scope} id={item.id} nested={nested} />}</div>
        </article>)}
        {scope?.sessionId && requestingModel(index) && !groups.at(-1)?.activity && <ModelRequestStatus />}
        {historyReceived && !task && !groups.length && !pending.length && !index.error && !original.loading && !original.error && <div className="empty-state">
          <h2>从一个想法，一行代码开始。</h2><p>描述目标、粘贴代码，或附上需要检查的文件。支持 Markdown。</p>
          <div className="quick-prompts">{[["审查代码", "帮我分析这段代码的潜在问题："], ["规划功能", "请帮我规划以下功能的实现步骤："], ["排查错误", "请解释以下错误，并给出排查建议："]].map(([label, text]) =>
            <button className="btn" key={label} disabled={!scope?.sessionId} onClick={() => {
              updateDraft(scope!, { text }); document.getElementById(nested ? `prompt-${scope!.sessionId}` : "prompt")?.focus();
            }}>{label}</button>)}</div>
        </div>}
        {scope?.sessionId && historyReceived && <RetryAction scope={scope} nested={nested} />}
      </div></div>
    </section>
    <nav className="thread-navigation" aria-label="会话滚动">
      {([ ["top", "回到最上", "M7 5h10M7 14l5-5 5 5M12 9v11"], ["up", "向上滚动一屏", "m6 15 6-6 6 6"],
        ["down", "向下滚动一屏", "m6 9 6 6 6-6"], ["bottom", "回到最下", "M7 19h10M7 10l5 5 5-5M12 4v11"] ] as const).map(([direction, label, path]) =>
        <button type="button" className="action-icon" key={direction} data-tooltip={label} aria-label={label} disabled={direction === "top" || direction === "up" ? edges.top : edges.bottom} onClick={() => scroll(direction)}>
          <svg className="ui-glyph" viewBox={direction === "top" ? "6 4 12 17" : direction === "bottom" ? "6 3 12 17" : "5 8 14 8"} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>
        </button>)}
    </nav>
    <FilePreviewOutlet />
  </div>;
}

// Remount local viewing state on every workspace/session change, including child views.
export const AgentThread = memo(function AgentThread(props: ThreadProps) {
  return <ThreadView key={`${props.scope?.workspaceId}:${props.scope?.sessionId}`} {...props} />;
});
