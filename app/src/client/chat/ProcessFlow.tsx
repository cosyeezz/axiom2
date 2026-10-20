import { useContext, useMemo, useSyncExternalStore } from "react";
import { messageScope, type ChatMessage, type ThreadIndex } from "../../shared/agent.js";
import { processSlices, type ProcessEntry, type ProcessSlice } from "../../shared/process-layout.js";
import type { Scope } from "../../shared/protocol.js";
import { taskToolName } from "../../shared/tasks.js";
import { scopeSnapshot, subscribeScope } from "../transport.js";
import { TaskCards } from "../tasks/TaskCards.js";
import { TaskOperation } from "../tasks/TaskOperation.js";
import { Message } from "./Message.js";
import { OriginalMessages, useThreadMessage } from "./OriginalConversation.js";
import { ActivityGroup, ToolReference } from "./ToolActivity.js";

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
function ProcessItem({ scope, entry }: { scope: Scope; entry: ProcessEntry }) {
  if (entry.kind === "tool") return <ToolReference scope={scope} reference={entry.call} />;
  return <Message scope={scope} id={entry.id} inActivity thinkingOnly={entry.kind === "thinking"} />;
}
function ProcessSegment({ scope, slice, settled, awaitingMore, activeRunId }: {
  scope: Scope; slice: Extract<ProcessSlice, { kind: "process" }>; settled: boolean; awaitingMore?: boolean; activeRunId?: string;
}) {
  const thinkingIds = slice.entries.flatMap(entry => entry.kind === "thinking" ? [entry.id] : []);
  const callMessageIds = [...new Set(slice.calls.map(call => call.messageId))];
  const thinkingOnlyIds = thinkingIds.filter(id => !callMessageIds.includes(id));
  const callsOnlyIds = callMessageIds.filter(id => !thinkingIds.includes(id));
  const messageIds = [...new Set(slice.entries.map(entry => entry.kind === "tool" ? entry.call.messageId : entry.id))];
  return <ActivityGroup scope={scope} messageIds={messageIds} thinkingOnlyIds={thinkingOnlyIds} callsOnlyIds={callsOnlyIds}
    callIds={slice.calls.map(call => call.callId)} inline settled={settled} awaitingMore={awaitingMore} activeRunId={activeRunId}>
    {/* Keep actual result notices mounted as read evidence while details stay lazy. */}
    {open => slice.entries.filter(entry => open || entry.kind === "notice")
      .map(entry => <ProcessItem key={`${entry.kind}:${entry.id}`} scope={scope} entry={entry} />)}
  </ActivityGroup>;
}

export function ProcessFlow({ scope, group, settled, awaitingMore, activeRunId, animateFold }: {
  scope: Scope; group: Group; settled: boolean; awaitingMore?: boolean; activeRunId?: string; animateFold?: boolean;
}) {
  const slices = useProcessSlices(scope, group);
  const renderSlice = (slice: ProcessSlice, index: number) => {
    const key = `${slice.kind}:${slice.id}`;
    if (slice.kind === "task") return <TaskCall key={key} scope={scope} {...slice.call} />;
    if (slice.kind === "process") {
      const closed = settled || !!group.folded || index < slices.length - 1;
      return <ProcessSegment key={key} scope={scope} slice={slice} settled={closed}
        awaitingMore={!closed && awaitingMore} activeRunId={closed ? undefined : activeRunId} />;
    }
    const body = <Message scope={scope} id={slice.id} inActivity hideThinking={slice.kind === "body"} />;
    // Live activity groups contain only error/cancellation bodies: ordinary prose
    // already has its own thread group. Keep these terminal outcomes visible.
    return !group.folded && slice.kind === "body"
      ? <ActivityGroup key={key} scope={scope} messageIds={[slice.id]} inline settled={settled}>{body}</ActivityGroup>
      : <Message key={key} scope={scope} id={slice.id} inActivity hideThinking={slice.kind === "body"} />;
  };
  if (!group.folded) return <>{slices.map(renderSlice)}</>;
  return <ActivityGroup scope={scope} messageIds={group.ids} thinkingOnlyIds={group.thinkingOnlyIds}
    callsOnlyIds={group.callsOnlyIds} callIds={slices.flatMap(slice => slice.kind === "process" ? slice.calls.map(call => call.callId) : [])}
    settled animateFold={animateFold}>
    {open => open ? slices.map(renderSlice) : slices.flatMap(slice => slice.kind === "process"
      ? slice.entries.filter(entry => entry.kind === "notice")
        .map(entry => <ProcessItem key={`${entry.kind}:${entry.id}`} scope={scope} entry={entry} />)
      : slice.kind === "notice" ? [renderSlice(slice, 0)] : [])}
  </ActivityGroup>;
}
