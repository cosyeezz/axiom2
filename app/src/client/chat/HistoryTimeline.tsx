import { Fragment, useEffect, useRef, useState } from "react";
import type { Scope } from "../../shared/protocol.js";
import { messageScope, type ChatMessage, type ThreadIndex } from "../../shared/agent.js";
import { threadDelivery } from "../../shared/thread-layout.js";
import { scopeSnapshot } from "../transport.js";
import { unarchivedGroups, type HistoryGroup, type HistorySegment, type ThreadGroup } from "../../shared/history.js";
import { FoldIcon } from "../StatusIcons.js";
import { Icon } from "../Icon.js";
import { Message } from "./Message.js";
import { ModelChangeNotice } from "./ModelChangeNotice.js";
import { ProcessFlow } from "./ProcessFlow.js";
import { ActivityGroup } from "./ToolActivity.js";
import { CompressionSummary } from "./CompressionSummary.js";
import { useFullMessage } from "./useFullMessage.js";
import { useHistoryRange, useRememberedDisclosure, useThreadMessage, type useHistoryConversation } from "./OriginalConversation.js";
import type { HistoryStore } from "./history-store.js";
import { SegmentExpansion } from "./history-expansion.js";
import type { TimelineRow } from "./VirtualTimeline.js";

function ReadStatus({ loading, error, retry }: { loading: boolean; error: string; retry: () => void }) {
  return error ? <p className="execution-alert" role="alert">{error} <button type="button" className="btn" onClick={retry}>重新加载</button></p>
    : loading ? <p className="history-loading" role="status">正在读取会话原文…</p> : null;
}
function ArchiveBody({ scope, segmentId, group, store, initialTaskInputId, enabled = true }: {
  scope: Scope; segmentId: string; group: HistoryGroup; store: HistoryStore; initialTaskInputId?: string | null; enabled?: boolean;
}) {
  const range = useHistoryRange(store, segmentId, group.id, enabled);
  return <>{!range.ready && <ReadStatus loading={!range.error} error={range.error} retry={range.retry} />}
    {range.ready && (group.activity ? <ProcessFlow scope={scope} group={group} settled
      archiveExpanded={!!group.process && !group.folded} contentsOnly={!!group.process} />
      : <Message scope={scope} id={group.id} hideThinking={group.hideThinking} initialTaskInputId={initialTaskInputId} />)}</>;
}
function ArchivedProcess({ scope, segmentId, group, store, initialTaskInputId }: {
  scope: Scope; segmentId: string; group: HistoryGroup; store: HistoryStore; initialTaskInputId?: string | null;
}) {
  const process = group.process!;
  const inline = process.inline ?? !group.id.startsWith("final-process:");
  return <ActivityGroup scope={scope} summary={process} settled inline={inline}
    disclosureKey={`archive:${segmentId}:${group.id}`} className="archived-process">
    {open => open ? <ArchiveBody scope={scope} segmentId={segmentId} group={{ ...group, folded: !inline }} store={store} initialTaskInputId={initialTaskInputId} /> : null}
  </ActivityGroup>;
}
function CompactionInfo({ scope, segment, store }: { scope: Scope; segment: HistorySegment; store: HistoryStore }) {
  const range = useHistoryRange(store, segment.id);
  const message = useThreadMessage(scope, segment.id);
  const full = useFullMessage(scope, message, !!message?.truncated);
  return <div className="compaction-body">
    {!range.ready && <ReadStatus loading={!range.error} error={range.error} retry={range.retry} />}
    {message && <CompressionSummary text={full.message?.text ?? message.text} />}
    {full.loading && <p className="history-loading" role="status">正在读取完整压缩信息…</p>}
    {full.error && <p className="execution-alert" role="alert">{full.error} <button className="btn" onClick={() => void full.load()}>重新加载</button></p>}
  </div>;
}
function HistoryCard({ scope, segment, open, toggle, store }: { scope: Scope; segment: HistorySegment; open: boolean; toggle: () => void; store: HistoryStore }) {
  const [summary, setSummary] = useRememberedDisclosure(`summary:${segment.id}`);
  const compression = segment.compression;
  return <article className="compaction-card history-card" data-compaction-id={segment.id} aria-label={`压缩 #${compression.number}`}>
    <div className="history-card-heading">
      <span className="compaction-icon" aria-hidden="true"><FoldIcon /></span>
      <div className="compaction-heading"><span className="history-card-number">压缩 <span>#{String(compression.number).padStart(2, "0")}</span></span>
        <span className="history-card-range">{segment.messageIds.length} 条消息 · 与模型上下文独立保留</span></div>
      <span className="compaction-tokens" data-tooltip="pi 内容估算，不是计费用量"><span className="compaction-token-values"><span>≈{compression.before.toLocaleString()}</span><span className="compaction-arrow" aria-label="压缩至">→</span><span className="compaction-token-after">{compression.after == null ? "—" : `≈${compression.after.toLocaleString()}`}</span></span><span className="compaction-token-label">Token · 估算</span></span>
    </div>
    <div className="history-card-actions">
      <button type="button" className="history-disclosure" aria-expanded={open} onClick={toggle}><Icon name="chevron" /><span>{open ? "收起会话原文" : "展开会话原文"}</span></button>
      <button type="button" className="history-disclosure" aria-expanded={summary} onClick={() => setSummary(value => !value)}><Icon name="chevron" /><span>{summary ? "收起压缩信息" : "展开压缩信息"}</span></button>
    </div>
    {summary && <CompactionInfo scope={scope} segment={segment} store={store} />}
  </article>;
}
export function useHistoryRows({ scope, index, history, renderLive, initialTaskInputId, reveal }: {
  scope: Scope | null; index: ThreadIndex; history: ReturnType<typeof useHistoryConversation>;
  renderLive: (group: ThreadGroup, position: number, groups: ThreadGroup[]) => React.ReactNode; initialTaskInputId?: string | null;
  reveal?: { messageId: string; revision: number };
}) {
  const storageKey = `axiom:history-ranges:${scope?.workspaceId}:${scope?.sessionId}`;
  const expansions = useRef<SegmentExpansion | null>(null);
  if (!expansions.current) {
    let saved: Record<string, boolean> = {};
    try { const value = JSON.parse(sessionStorage.getItem(storageKey) ?? "{}"); if (value && typeof value === "object") saved = Object.fromEntries(Object.entries(value).filter(([, value]) => typeof value === "boolean")) as Record<string, boolean>; } catch { /* Storage is optional. */ }
    expansions.current = new SegmentExpansion(saved);
  }
  const [, refresh] = useState(0);
  const segments = history.index?.segments ?? [];
  expansions.current.reconcile(segments.map(segment => segment.id));
  const savedExpansion = JSON.stringify(expansions.current.manual);
  useEffect(() => {
    try { sessionStorage.setItem(storageKey, savedExpansion); } catch { /* Storage is optional. */ }
  }, [storageKey, savedExpansion]);
  const toggle = (id: string, value?: boolean) => {
    const state = expansions.current!; state.set(id, value ?? !state.open.get(id));
    try { sessionStorage.setItem(storageKey, JSON.stringify(state.manual)); } catch { /* No loss of in-view state. */ }
    refresh(value => value + 1);
  };
  const revealSegment = segments.find(segment => segment.messageIds.includes(reveal?.messageId ?? ""))?.id;
  useEffect(() => {
    if (revealSegment && !expansions.current?.open.get(revealSegment)) toggle(revealSegment, true);
  }, [reveal?.revision, revealSegment]);
  const archived = new Set(segments.flatMap(segment => [segment.id, ...segment.messageIds]));
  const sourceGroups: ThreadGroup[] = index.groups ?? index.ids.map(id => ({ id, ids: [id], activity: false }));
  const groups = unarchivedGroups(sourceGroups, archived);
  const rows: TimelineRow[] = [];
  // The live collection already holds bounded message snapshots, including rows
  // outside the virtual window. Do not depend on a freshly restarted backend to
  // add group.delivery, and never hydrate an entire archive just to navigate it.
  const cachedDelivery = (group: ThreadGroup) => () => {
    if (!scope || group.activity) return false;
    const message = scopeSnapshot<ChatMessage>(messageScope(scope, group.id)) ?? history.store.get(group.id);
    return !!message && threadDelivery(message);
  };
  if (scope) {
    for (const segment of segments) {
      const open = expansions.current.open.get(segment.id)!;
      const cardKey = `compression:${segment.id}`;
      rows.push({ key: cardKey, estimate: 142, render: () => <HistoryCard scope={scope} segment={segment} open={open} toggle={() => toggle(segment.id)} store={history.store} /> });
      if (open) for (const group of segment.groups) rows.push({
        key: `archive:${segment.id}:${group.id}`, messageIds: group.ids, delivery: !group.activity && group.delivery, isDelivery: cachedDelivery(group), estimate: group.estimatedHeight, segmentId: segment.id, collapseKey: cardKey, collapse: () => toggle(segment.id, false),
        render: () => <>{group.selectionChange && <ModelChangeNotice change={group.selectionChange} />}
          {group.process ? <ArchivedProcess scope={scope} segmentId={segment.id} group={group} store={history.store} initialTaskInputId={initialTaskInputId} />
            : <ArchiveBody scope={scope} segmentId={segment.id} group={group} store={history.store} initialTaskInputId={initialTaskInputId} />}</>,
      });
    }
    groups.forEach((group, position) => rows.push({ key: `live:${group.id}`, messageIds: group.ids, delivery: !group.activity && group.delivery, isDelivery: cachedDelivery(group), estimate: group.folded ? 84 : group.activity ? 100 : 180,
      render: () => <Fragment>{renderLive(group, position, groups)}</Fragment> }));
  }
  // Original ranges stay open across a new compaction; only explicit user actions close them.
  useEffect(() => { if (!scope) expansions.current = null; }, [scope?.sessionId]);
  return { rows, groups, segments };
}
