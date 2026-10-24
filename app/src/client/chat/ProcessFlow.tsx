import { Fragment, useContext, useMemo, useSyncExternalStore } from "react";
import { messageScope, type ChatMessage, type ThreadIndex } from "../../shared/agent.js";
import { processSlices, type ProcessEntry, type ProcessSlice } from "../../shared/process-layout.js";
import type { Scope } from "../../shared/protocol.js";
import { taskToolName } from "../../shared/tasks.js";
import { scopeSnapshot, subscribeScope } from "../transport.js";
import { TaskCards } from "../tasks/TaskCards.js";
import { TaskOperation } from "../tasks/TaskOperation.js";
import { Message } from "./Message.js";
import { OriginalMessages, useThreadMessage } from "./OriginalConversation.js";
import { ModelRequestStatus } from "./ProcessStatus.js";
import { ActivityGroup, ActivitySettled, ToolReference } from "./ToolActivity.js";

type Group = NonNullable<ThreadIndex["groups"]>[number];
function useProcessSlices(scope: Scope, group: Group) {
  const original = useContext(OriginalMessages);
  const key = JSON.stringify([group.ids, group.thinkingOnlyIds, group.callsOnlyIds]);
  const store = useMemo(() => {
    const read = () => processSlices(group.ids.map(id => scopeSnapshot<ChatMessage>(messageScope(scope, id)) ?? original?.get(id))
      .filter((m): m is ChatMessage => !!m), group.thinkingOnlyIds, group.callsOnlyIds);
    let value = read();
    return {
      get: () => value,
      subscribe: (notify: () => void) => {
        let active = true, queued = false;
        const change = () => {
          if (queued) return;
          queued = true;
          queueMicrotask(() => {
            queued = false;
            if (!active) return;
            const next = read();
            // Text deltas stay within their message subscription, not the whole flow.
            if (JSON.stringify(next) !== JSON.stringify(value)) { value = next; notify(); }
          });
        };
        const off = group.ids.flatMap(id => [subscribeScope(messageScope(scope, id), change), original?.subscribeMessage(id, change)]);
        change();
        return () => { active = false; off.forEach(fn => fn?.()); };
      },
    };
  }, [scope.workspaceId, scope.sessionId, original, key]);
  return useSyncExternalStore(store.subscribe, store.get);
}
function TaskCall({ scope, messageId, callId }: { scope: Scope; messageId: string; callId: string }) {
  const message = useThreadMessage(scope, messageId);
  const call = message?.calls?.find(c => c.id === callId);
  const name = call && taskToolName(call.name);
  if (!message || !call || !name) return null;
  return name === "delegate" ? <TaskCards scope={scope} call={call} message={message} /> : <TaskOperation scope={scope} call={call} message={message} name={name} />;
}
function ProcessItem({ scope, entry, latestRun }: { scope: Scope; entry: ProcessEntry; latestRun?: string }) {
  const message = useThreadMessage(scope, entry.kind === "tool" ? entry.call.messageId : entry.id);
  const settled = useContext(ActivitySettled);
  const earlierRun = !!latestRun && !!message?.runId && message.runId !== latestRun;
  return <ActivitySettled.Provider value={settled || earlierRun}>
    {entry.kind === "tool" ? <ToolReference scope={scope} reference={entry.call} />
      : <Message scope={scope} id={entry.id} inActivity thinkingOnly={entry.kind === "thinking"} hideThinking={entry.kind === "outcome"} />}
  </ActivitySettled.Provider>;
}
function ProcessSegment({ scope, slice, settled, awaitingMore, activeRunId, requesting, latestRun }: {
  scope: Scope; slice: Extract<ProcessSlice, { kind: "process" }>; settled: boolean; awaitingMore?: boolean; activeRunId?: string; requesting?: boolean; latestRun?: string;
}) {
  const thinkingIds = slice.entries.flatMap(entry => entry.kind === "thinking" ? [entry.id] : []);
  const callMessageIds = [...new Set(slice.calls.map(call => call.messageId))];
  const outcomeIds = new Set(slice.entries.flatMap(entry => entry.kind === "outcome" ? [entry.id] : []));
  const thinkingOnlyIds = thinkingIds.filter(id => !callMessageIds.includes(id) && !outcomeIds.has(id));
  const callsOnlyIds = callMessageIds.filter(id => !thinkingIds.includes(id) && !outcomeIds.has(id));
  const messageIds = [...new Set(slice.entries.map(entry => entry.kind === "tool" ? entry.call.messageId : entry.id))];
  const last = useThreadMessage(scope, messageIds.at(-1)!);
  const closed = settled || !!latestRun && !!last?.runId && last.runId !== latestRun;
  return <ActivityGroup scope={scope} messageIds={messageIds} thinkingOnlyIds={thinkingOnlyIds} callsOnlyIds={callsOnlyIds}
    callIds={slice.calls.map(call => call.callId)} inline settled={closed} awaitingMore={!closed && awaitingMore}
    activeRunId={closed ? undefined : activeRunId} requesting={!closed && requesting}>
    {open => open ? slice.entries.map(entry => <ProcessItem key={`${entry.kind}:${entry.id}`} scope={scope} entry={entry} latestRun={latestRun ?? last?.runId} />) : null}
  </ActivityGroup>;
}

export function ProcessFlow({ scope, group, settled, awaitingMore, activeRunId, animateFold, requesting = false, archiveExpanded = false, contentsOnly = false }: {
  scope: Scope; group: Group; settled: boolean; awaitingMore?: boolean; activeRunId?: string; animateFold?: boolean; requesting?: boolean; archiveExpanded?: boolean; contentsOnly?: boolean;
}) {
  const slices = useProcessSlices(scope, group);
  const last = useThreadMessage(scope, group.ids.at(-1)!);
  const outerSettled = settled || !awaitingMore && !requesting;
  const lastBody = slices.findLastIndex(slice => slice.kind === "body" || slice.kind === "notice");
  const renderSlice = (slice: ProcessSlice, index: number) => {
    const key = `${slice.kind}:${slice.id}`;
    if (slice.kind === "task") return <TaskCall key={key} scope={scope} {...slice.call} />;
    if (slice.kind === "process") {
      // The archive row already owns this disclosure; do not add a second closed process.
      if (archiveExpanded) return <Fragment key={key}>{slice.entries.map(entry => <ProcessItem key={`${entry.kind}:${entry.id}`} scope={scope} entry={entry} />)}</Fragment>;
      const tail = index === slices.length - 1;
      // Prose settles the process above it, including stale stream deltas. A
      // task operation alone does not prove a sibling tool has finished.
      const closed = settled || !!group.folded && outerSettled || index < lastBody;
      return <ProcessSegment key={key} scope={scope} slice={slice} settled={closed} latestRun={last?.runId}
        awaitingMore={tail && !closed && awaitingMore} activeRunId={tail && !closed ? activeRunId : undefined} requesting={tail && !closed && requesting} />;
    }
    const body = <Message scope={scope} id={slice.id} inActivity hideThinking={slice.kind === "body"} />;
    // Live activity groups contain only error/cancellation bodies: ordinary prose
    // already has its own thread group. Keep these terminal outcomes visible.
    return !group.folded && !archiveExpanded && slice.kind === "body"
      ? <ActivityGroup key={key} scope={scope} messageIds={[slice.id]} inline settled={settled}>{body}</ActivityGroup>
      : <Message key={key} scope={scope} id={slice.id} inActivity hideThinking={slice.kind === "body"} />;
  };
  // Archived headers already own the outer status card, but final archives keep
  // the original inner process disclosures, commentary and task cards intact.
  if (!group.folded || contentsOnly) return <>{slices.map(renderSlice)}{requesting && !settled && slices.at(-1)?.kind !== "process" && <ModelRequestStatus />}</>;
  return <ActivityGroup scope={scope} messageIds={group.ids} thinkingOnlyIds={group.thinkingOnlyIds}
    callsOnlyIds={group.callsOnlyIds} callIds={slices.flatMap(slice => slice.kind === "process" ? slice.calls.map(call => call.callId) : [])}
    settled={outerSettled} awaitingMore={awaitingMore} activeRunId={outerSettled ? undefined : activeRunId}
    requesting={requesting} animateFold={animateFold && outerSettled}>
    {open => open ? slices.map(renderSlice) : slices.flatMap(slice =>
      slice.kind === "notice" ? [renderSlice(slice, 0)] : [])}
  </ActivityGroup>;
}
