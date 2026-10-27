import { getComposerEdit, useComposerEditRevision } from "./composer-edit.js";
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
import { ModelRequestStatus, pendingModelActivity } from "./ProcessStatus.js";
import { RetryAction } from "./RetryAction.js";
import { Environment } from "./SessionState.js";
import { optimisticState, useOptimistic } from "./optimistic.js";
import { SkillCards } from "./SkillCards.js";
import { Markdown } from "./Markdown.js";
import { MessageImages } from "./MessageImages.js";
import { useReadReceipt } from "./useReadReceipt.js";
import { reconcileInputs } from "./reconcile-inputs.js";
import { useStickyDisclosures } from "./useStickyDisclosures.js";
import { useDisclosureReveal } from "./useDisclosureReveal.js";
import { useThreadScrollIntent } from "./useThreadScrollIntent.js";
import { OriginalMessages, useHistoryConversation, useThreadMessage } from "./OriginalConversation.js";
import { useHistoryRows } from "./HistoryTimeline.js";
import { VirtualTimeline, timelineKeyEdge, type TimelineNavigation } from "./VirtualTimeline.js";
import type { ScrollDirection } from "./delivery-navigation.js";
import { DerivedContext, sessionDerivedCache } from "./derived-cache.js";
import "../styles/thread-navigation.css";
function ThreadActivityGroup({ scope, group, tail, index, animateFold }: {
  scope: Scope; group: NonNullable<ThreadIndex["groups"]>[number]; tail: boolean; index: ThreadIndex; animateFold: boolean;
}) {
  const last = useThreadMessage(scope, group.ids.at(-1)!);
  const activeRunId = tail && activeStatus(index.runStatus) ? index.runId : undefined;
  const awaitingMore = tail && activeStatus(index.runStatus) && (!last?.runId || last.runId === index.runId);
  const requesting = tail && pendingModelActivity(index);
  return <ProcessFlow scope={scope} group={group} awaitingMore={awaitingMore} activeRunId={activeRunId} settled={!tail} animateFold={animateFold} requesting={requesting} />;
}

type ThreadProps = { scope: Scope | null; nested?: boolean; readingRevision?: number; task?: Task; briefRevision?: number };
function ThreadView({ scope, nested = false, readingRevision = 0, task, briefRevision = 0 }: ThreadProps) {
  const index = useScope(scope?.sessionId ? threadScope(scope) : null, emptyThread);
  // Keep the collection subscribed even for an empty or entirely compressed thread.
  const messagesReceived = useScopeOrder(scope?.sessionId ? `messages:${scope.workspaceId}:${scope.sessionId}` : null);
  const threadReceived = useScopeOrder(scope?.sessionId ? threadScope(scope) : null);
  useScopeOrder(scope?.sessionId ? agentScope(scope) : null);
  const historyReceived = !scope?.sessionId || !!messagesReceived && !!threadReceived;
  const history = useHistoryConversation(scope, index);
  const pending = useOptimistic(scope);
  const editRevision = useComposerEditRevision(scope);
  const editing = scope && editRevision ? getComposerEdit(scope) : null;
  useEffect(() => {
    if (!scope?.sessionId) return;
    const check = () => { void reconcileInputs(scope).catch(() => {}); };
    check(); const timer = setInterval(check, 5000);
    return () => clearInterval(timer);
  }, [scope?.workspaceId, scope?.sessionId]);
  const info = useScope(scope ? agentScope(scope) : null, emptyAgent);
  const scroller = useRef<HTMLElement>(null), content = useRef<HTMLDivElement>(null), bottom = useRef(true);
  const smoothBottomTarget = useRef<number | null>(null), scrollPosition = useRef(0);
  const timelineNavigation = useRef<TimelineNavigation>(null);
  useThreadScrollIntent(scroller, bottom, scrollPosition);
  const cancelReveal = useDisclosureReveal(scroller, bottom, scrollPosition);
  const selectingMessages = () => {
    const el = scroller.current, selection = getSelection();
    return !!el && !!selection?.toString() &&
      (el.contains(selection.anchorNode) || el.contains(selection.focusNode));
  };
  const scrollToBottom = () => {
    // An explicit edge jump owns its animation and settles new row measurements.
    // ResizeObserver must not turn that smooth movement into an instant tail snap.
    if (timelineNavigation.current?.edgeActive()) return;
    cancelReveal();
    const el = scroller.current;
    if (!el) return;
    smoothBottomTarget.current = null;
    if (Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) > 1)
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
  useLayoutEffect(() => {
    if (!editing || !historyReceived || !history.ready) return;
    pauseFollowing();
    // VirtualTimeline mounts and precisely positions targets outside the current window.
  }, [editing?.revision, historyReceived, history.ready]);
  // Sibling disclosures can resize the thread without a click inside its scroller.
  useLayoutEffect(() => {
    if (readingRevision) pauseFollowing();
  }, [readingRevision]);
  useLayoutEffect(() => {
    if (!briefRevision || !historyReceived || !history.ready) return;
    pauseFollowing();
    const frame = requestAnimationFrame(() => {
      const brief = content.current?.querySelector<HTMLElement>("[data-task-brief]");
      brief?.scrollIntoView({ block: "start", behavior: "instant" });
      brief?.focus({ preventScroll: true });
      if (scroller.current) scrollPosition.current = scroller.current.scrollTop;
    });
    return () => cancelAnimationFrame(frame);
  }, [briefRevision, historyReceived, history.ready]);
  useStickyDisclosures(content, bottom);
  const [edges, setEdges] = useState({ top: true, bottom: true });
  const [scrollDirection, setScrollDirection] = useState<ScrollDirection>("up");
  const [navigationVisible, setNavigationVisible] = useState(false);
  const manualScroll = useRef(-Infinity), navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideNavigation = () => {
    if (navigationTimer.current) clearTimeout(navigationTimer.current);
    navigationTimer.current = null;
    setNavigationVisible(false);
  };
  const showNavigation = (direction: ScrollDirection) => {
    setScrollDirection(direction);
    setNavigationVisible(true);
    if (navigationTimer.current) clearTimeout(navigationTimer.current);
    navigationTimer.current = setTimeout(() => { navigationTimer.current = null; setNavigationVisible(false); }, 2000);
  };
  useEffect(() => () => { if (navigationTimer.current) clearTimeout(navigationTimer.current); }, []);
  const [stepping, setStepping] = useState<ScrollDirection | null>(null);
  useReadReceipt(scope, index, info, edges.bottom && history.ready, scroller);
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
    const thread = scroller.current;
    const composer = thread?.closest(".workspace")?.querySelector<HTMLElement>(":scope > .composer-area");
    let viewportHeight = thread?.clientHeight ?? 0;
    let composerHeight = composer?.getBoundingClientRect().height ?? 0;
    const observer = new ResizeObserver(() => {
      const height = thread?.clientHeight ?? 0;
      const draftHeight = composer?.getBoundingClientRect().height ?? 0;
      const displaced = Math.min(viewportHeight - height, draftHeight - composerHeight);
      viewportHeight = height;
      composerHeight = draftHeight;
      if (!selectingMessages()) {
        if (bottom.current) scrollToBottom();
        else if (thread && displaced > 0 && composer?.contains(document.activeElement)) {
          // While drafting during history reading, lift the visible dialogue with
          // the growing input. Preserve its lower edge, not a forced jump to tail.
          thread.scrollTop += displaced;
          scrollPosition.current = thread.scrollTop;
        }
      }
      measure();
    });
    if (content.current) observer.observe(content.current);
    if (thread) observer.observe(thread);
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
      // An unfinished/lazy delivery reveal must not steal the viewport back after
      // this new submission explicitly restores tail following.
      timelineNavigation.current?.cancel(); setStepping(null);
      manualScroll.current = -Infinity; hideNavigation();
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
  const liveGroups: NonNullable<ThreadIndex["groups"]> = index.groups ?? index.ids.map((id) => ({ id, ids: [id], activity: false }));
  const previousGroups = useRef(liveGroups);
  const folding = new Set(liveGroups.filter(group => group.folded && !previousGroups.current.some(previous => previous.id === group.id) &&
    previousGroups.current.some(previous => !previous.folded && previous.ids.some(id => group.ids.includes(id)))).map(group => group.id));
  useLayoutEffect(() => { previousGroups.current = liveGroups; }, [liveGroups]);
  const editReveal = editing && historyReceived && history.ready ? { messageId: editing.target.messageId, revision: editing.revision } : undefined;
  const { rows, groups, segments, tailBoundary } = useHistoryRows({ scope, index, history, initialTaskInputId: task?.initialInputId, reveal: editReveal,
    renderLive: (group, groupIndex, currentGroups, boundary) => <Fragment>
      {group.selectionChange && <ModelChangeNotice change={group.selectionChange} />}
      {group.activity ? <ThreadActivityGroup scope={scope!} group={group} tail={!boundary && groupIndex === currentGroups.length - 1} index={index} animateFold={folding.has(group.id)} />
        : <Message scope={scope!} id={group.id} initialTaskInputId={task?.initialInputId} hideThinking={group.hideThinking} activeRunId={activeStatus(index.runStatus) ? index.runId : undefined} />}
    </Fragment> });
  const revealKey = editReveal && rows.find(row => row.messageIds?.includes(editReveal.messageId))?.key;
  const cancelNavigation = () => { timelineNavigation.current?.cancel(); setStepping(null); };
  const scroll = (target: "top" | "bottom" | ScrollDirection) => {
    const el = scroller.current;
    if (!el) return;
    const direction = target === "top" ? "up" : target === "bottom" ? "down" : target;
    manualScroll.current = -Infinity;
    showNavigation(direction);
    pauseFollowing();
    if ((target === "up" || target === "down") && timelineNavigation.current?.step(direction)) { setStepping(direction); return; }
    // No more delivery starts in this direction: the same arrow reaches the edge.
    cancelNavigation();
    bottom.current = direction === "down";
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // A long jump crosses rows whose heights are still estimates: every frame
    // mounts and measures them, the tail keeps moving, and the animation
    // repaints shifting content — that reads as constant flicker. Reserve the
    // animation for distances whose heights are known and stable.
    const distance = Math.abs((direction === "up" ? 0 : el.scrollHeight - el.clientHeight) - el.scrollTop);
    const behavior = reduced || distance > el.clientHeight * 1.5 ? "instant" : "smooth";
    // Only the native fallback needs a fixed destination. A virtual edge owns
    // and remeasures its target; retaining an estimated old height can leave
    // following stuck in "still navigating" after the real height shrinks.
    smoothBottomTarget.current = !timelineNavigation.current && direction === "down" && behavior === "smooth" ? el.scrollHeight - el.clientHeight : null;
    // The virtual window commits the smooth position and newly mounted bodies
    // together; a native compositor animation can otherwise paint only spacer.
    if (timelineNavigation.current) timelineNavigation.current.edge(direction === "up" ? "top" : "bottom", behavior);
    else el.scrollTo({ top: direction === "up" ? 0 : el.scrollHeight, behavior });
  };
  return <div className="thread-shell">
    <section ref={scroller} className="thread" id={nested ? undefined : "thread"} tabIndex={-1} aria-label="消息记录"
      onWheel={(event) => {
        // Pinch-zoom (ctrl+wheel) and horizontal scrolling in code blocks do not move the thread.
        if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        manualScroll.current = performance.now(); cancelNavigation();
      }}
      onTouchMove={() => { manualScroll.current = performance.now(); cancelNavigation(); }}
      onPointerDown={(event) => {
        // A plain tap is not scrolling. Only a mouse grab in the scrollbar
        // gutter can start a drag without wheel/touchmove events.
        if (event.pointerType !== "mouse" || event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const gutter = Math.max(14, event.currentTarget.offsetWidth - event.currentTarget.clientWidth);
        if (event.clientX >= rect.right - gutter || event.clientX <= rect.left + gutter) {
          manualScroll.current = performance.now();
          cancelNavigation();
        }
      }}
      onKeyDown={(event) => {
        const target = event.target instanceof Element ? event.target : null;
        // Keys handled by inputs or buttons do not scroll the thread.
        if (event.defaultPrevented
          || target?.closest("input, textarea, select, [contenteditable=true]")) return;
        if (event.key === " " && target?.closest("button, summary, [role=button]")) return;
        const edge = timelineKeyEdge(event);
        if (edge && timelineNavigation.current) { event.preventDefault(); scroll(edge); return; }
        if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) { manualScroll.current = performance.now(); cancelNavigation(); }
      }}
      onClickCapture={(event) => {
        // Plain text/background clicks do not express an intent to stop following.
        // Pause before controls expand or asynchronously load content for reading.
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("summary, button, a, input, textarea, select, [role=button]")) pauseFollowing();
      }}
      onScroll={(e) => {
        const n = e.currentTarget;
        const delta = n.scrollTop - scrollPosition.current;
        const movedDown = delta > 0;
        if (Math.abs(delta) > 1) {
          // Scroll is also emitted by row measurement, layout clamps and a
          // lazy delivery reveal. It is not evidence of user takeover. The
          // wheel/touch/key/scrollbar handlers above cancel navigation directly;
          // cancelling here can discard a target before its body has arrived.
          if (performance.now() - manualScroll.current < 1500) {
            manualScroll.current = performance.now();
            showNavigation(delta > 0 ? "down" : "up");
          }
        }
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
        {history.error && <p className="execution-alert" role="alert">历史索引读取失败，已保留当前对话。{history.error} <button type="button" className="btn" onClick={history.retry}>重新加载</button></p>}
        <DerivedContext.Provider value={sessionDerivedCache(`${scope?.workspaceId}:${scope?.sessionId}`)}>
        <OriginalMessages.Provider value={history.store}>
        {/* A catalogue can arrive before its message collection. Do not measure
            those missing bodies as zero-height rows and fill the entire history. */}
        {scope?.sessionId && historyReceived && <VirtualTimeline rows={rows} scroller={scroller} following={bottom} scrollPosition={scrollPosition} navigation={timelineNavigation}
          reveal={editReveal && revealKey ? { key: revealKey, selector: `[data-edit-message-id="${CSS.escape(editReveal.messageId)}"]`, revision: editReveal.revision } : undefined} />}
        </OriginalMessages.Provider>
        </DerivedContext.Provider>
        {scope && visiblePending.map((item) => <article key={item.id} className="log-row message-result" aria-label="用户消息">
          <div><div className="message-body user-text"><div className="markdown"><Markdown text={item.draft.text} attachments={[...(item.draft.attachments ?? []), ...(item.draft.images ?? []).map(image => ({ ...image, kind: "image" }))]} /></div>
            {(item.draft.attachments ?? []).filter((a) => a.kind !== "image").map((a) => <span className="meta" key={a.id}>{a.name} </span>)}
            <SkillCards skills={item.draft.skills} scope={scope} />
            <MessageImages images={item.message.images} scope={scope} messageId={item.id} />
          </div></div>
        </article>)}
        {scope?.sessionId && (pendingModelActivity(index) && (tailBoundary || !groups.at(-1)?.activity && (!groups.at(-1)?.delivery || index.runPhase !== "generating")) ||
          !activeStatus(index.runStatus) && visiblePending.some(item => item.state === "sending" || item.state === "accepted")) && <ModelRequestStatus tool={tailBoundary && index.runPhase === "executing_tools"} />}
        {historyReceived && !task && !groups.length && !segments.length && !pending.length && !index.error && !history.loading && !history.error && <div className="empty-state">
          <h2>从一个想法，一行代码开始。</h2><p>描述目标、粘贴代码，或附上需要检查的文件。支持 Markdown。</p>
          <div className="quick-prompts">{[["审查代码", "帮我分析这段代码的潜在问题："], ["规划功能", "请帮我规划以下功能的实现步骤："], ["排查错误", "请解释以下错误，并给出排查建议："]].map(([label, text]) =>
            <button className="btn" key={label} disabled={!scope?.sessionId} onClick={() => {
              updateDraft(scope!, { text }); document.getElementById(nested ? `prompt-${scope!.sessionId}` : "prompt")?.focus();
            }}>{label}</button>)}</div>
        </div>}
        {scope?.sessionId && historyReceived && <RetryAction scope={scope} nested={nested} />}
      </div></div>
    </section>
    <nav className="thread-navigation" aria-label="会话滚动" data-direction={scrollDirection} data-visible={navigationVisible || undefined} data-empty={edges.top && edges.bottom || undefined}>
      {([ ["top", "回到最上", "回到最上", "M7 5h10M7 14l5-5 5 5M12 9v11"],
        ["up", "向上跳转", "上一处交付，无更多时到最上", "m6 15 6-6 6 6"],
        ["down", "向下跳转", "下一处交付，无更多时到最下", "m6 9 6 6 6-6"],
        ["bottom", "回到最下", "回到最下", "M7 19h10M7 10l5 5 5-5M12 4v11"] ] as const).map(([direction, label, hint, path]) =>
        <button type="button" className="action-icon" key={direction} data-scroll={direction} data-tooltip={hint} aria-label={label}
          disabled={stepping !== direction && (direction === "top" || direction === "up" ? edges.top : edges.bottom)} onClick={() => scroll(direction)}>
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
