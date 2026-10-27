import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Scope } from "../../shared/protocol.js";
import { messageScope, type ChatMessage, type ThreadIndex } from "../../shared/agent.js";
import { threadDelivery } from "../../shared/thread-layout.js";
import { scopeSnapshot } from "../transport.js";
import { unarchivedGroups, type HistoryGroup, type HistorySegment, type ThreadGroup } from "../../shared/history.js";
import { historyFlow, type HistoryFlow } from "../../shared/history-layout.js";
import { HistoryProcess } from "./HistoryProcess.js";
import { FoldIcon } from "../StatusIcons.js";
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
function ArchiveBody({ scope, segmentId, group, store, initialTaskInputId, enabled = true, readGroupId }: {
  scope: Scope; segmentId: string; group: HistoryGroup; store: HistoryStore; initialTaskInputId?: string | null; enabled?: boolean; readGroupId?: string;
}) {
  const range = useHistoryRange(store, segmentId, readGroupId ?? group.id, enabled);
  // Preserve an already displayed live body during live → archive hand-off.
  // This does not mark the range ready or skip its validating lazy read.
  const subscribe = useCallback((notify: () => void) => {
    const off = group.ids.map(id => store.subscribeMessage(id, notify));
    return () => off.forEach(fn => fn());
  }, [store, group.ids]);
  const remembered = useSyncExternalStore(subscribe, () => group.ids.every(id => !!store.get(id)));
  const displayed = range.ready || remembered;
  return <>{!displayed && <ReadStatus loading={!range.error} error={range.error} retry={range.retry} />}
    {displayed && (group.activity ? <ProcessFlow scope={scope} group={group} settled
      archiveExpanded={!!group.process && !group.folded && !group.process.hasTasks} contentsOnly={!!group.process} />
      : <Message scope={scope} id={group.id} hideThinking={group.hideThinking} initialTaskInputId={initialTaskInputId} />)}</>;
}
function ArchivedProcess({ scope, segmentId, group, store, initialTaskInputId, animateFold = false }: {
  scope: Scope; segmentId: string; group: HistoryGroup; store: HistoryStore; initialTaskInputId?: string | null; animateFold?: boolean;
}) {
  const process = group.process!;
  const inline = !group.folded;
  if (inline && process.hasTasks) return <ArchiveBody scope={scope} segmentId={segmentId} group={group} store={store} initialTaskInputId={initialTaskInputId} />;
  return <ActivityGroup scope={scope} summary={process} settled inline={inline} animateFold={animateFold && !inline}
    disclosureKey={`archive:${segmentId}:${group.id}`} className="archived-process">
    {open => open ? <ArchiveBody scope={scope} segmentId={segmentId} group={group} store={store} initialTaskInputId={initialTaskInputId} /> : null}
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
function HistoryCard({ scope, segment, toggle, store }: { scope: Scope; segment: HistorySegment; toggle: () => void; store: HistoryStore }) {
  const [summary, setSummary] = useRememberedDisclosure(`summary:${segment.id}`);
  const compression = segment.compression;
  return <article className="compaction-card history-card" data-compaction-id={segment.id} aria-label={`压缩 #${compression.number}`}>
    <div className="history-card-controls">
      <button type="button" className="history-disclosure history-card-heading" data-history-expand aria-label="展开会话原文" aria-expanded={false} onClick={toggle}>
        <span className="compaction-icon" aria-hidden="true"><FoldIcon /></span>
        <span className="compaction-heading"><span className="history-card-number">压缩 <span>#{String(compression.number).padStart(2, "0")}</span></span>
          <span className="history-card-range">{segment.messageIds.length} 条消息 · Token 估算</span></span>
        <span className="compaction-tokens" data-tooltip="pi 内容估算，不是计费用量"><span className="compaction-token-values"><span>≈{compression.before.toLocaleString()}</span><span className="compaction-arrow" aria-label="压缩至">→</span><span className="compaction-token-after">{compression.after == null ? "—" : `≈${compression.after.toLocaleString()}`}</span></span></span>
      </button>
      <button type="button" className="history-summary-disclosure" aria-expanded={summary} onClick={() => setSummary(value => !value)}>{summary ? "收起压缩信息" : "查看压缩信息"}</button>
    </div>
    {summary && <CompactionInfo scope={scope} segment={segment} store={store} />}
  </article>;
}
export function useHistoryRows({ scope, index, history, renderLive, initialTaskInputId, reveal, processBreaks }: {
  scope: Scope | null; index: ThreadIndex; history: ReturnType<typeof useHistoryConversation>;
  renderLive: (group: ThreadGroup, position: number, groups: ThreadGroup[], boundary: boolean) => React.ReactNode; initialTaskInputId?: string | null;
  reveal?: { messageId: string; revision: number }; processBreaks?: ReadonlySet<string>;
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
  const previousGroups = useRef(sourceGroups);
  // The live collection and archive catalogue arrive on separate turns. Keep
  // the outgoing prefix in place until this context's catalogue can own it;
  // otherwise a one-frame disappearance can clamp and overwrite its anchor.
  const currentIds = new Set(sourceGroups.flatMap(group => group.ids));
  const retained = history.updating ? unarchivedGroups(previousGroups.current, currentIds) : [];
  const groups = unarchivedGroups([...retained, ...sourceGroups], archived);
  useLayoutEffect(() => { if (!history.updating) previousGroups.current = sourceGroups; }, [sourceGroups, history.updating]);
  const rows: TimelineRow[] = [];
  // The live collection already holds bounded message snapshots, including rows
  // outside the virtual window. Do not depend on a freshly restarted backend to
  // add group.delivery, and never hydrate an entire archive just to navigate it.
  const cachedDelivery = (group: ThreadGroup) => () => {
    if (!scope || group.activity) return false;
    const message = scopeSnapshot<ChatMessage>(messageScope(scope, group.id)) ?? history.store.get(group.id);
    return !!message && threadDelivery(message);
  };
  const flow = historyFlow(segments, expansions.current.open, groups, processBreaks,
    id => scope ? (scopeSnapshot<ChatMessage>(messageScope(scope, id)) ?? history.store.get(id))?.runId : undefined);
  const previousFlow = useRef<HistoryFlow[] | null>(null);
  const completed = useRef(new Set<string>());
  // Match contributions, not storage IDs: a live delivery can turn several
  // visible archive rows into a new aggregate. Never animate history mounts,
  // manual range expansion, or virtual recycling of an existing delivery.
  const folding = new Set(flow.filter(entry => entry.kind === "messages" && entry.group.folded && !completed.current.has(entry.key) &&
    previousFlow.current?.some(previous => previous.kind === "messages" && !previous.group.folded &&
      previous.group.ids.some(id => entry.group.ids.includes(id)))).map(entry => entry.key));
  useLayoutEffect(() => {
    previousFlow.current = flow;
    for (const entry of flow) if (entry.kind === "messages" && entry.group.folded) completed.current.add(entry.key);
  });
  if (scope) for (const entry of flow) {
    if (entry.kind === "card") {
      rows.push({ key: entry.key, estimate: 100, expandTo: entry.segment.messageIds[0],
        render: () => <HistoryCard scope={scope} segment={entry.segment} toggle={() => toggle(entry.segment.id, true)} store={history.store} /> });
      continue;
    }
    const { group, sources } = entry;
    const archiveSources = sources.filter(source => source.kind === "archive");
    const segment = archiveSources[0]?.segment;
    rows.push({ key: group.activity ? entry.key : `message:${group.id}`, messageIds: group.ids, delivery: !group.activity && group.delivery, isDelivery: cachedDelivery(group),
      isPending: !archiveSources.length || group.activity && group.folded ? undefined : () => archiveSources.some(source => {
        const range = history.store.range(history.store.key(source.segment.id, source.readGroupId ?? source.group.id));
        return !range.ready && !range.error;
      }),
      estimate: group.activity ? 84 : archiveSources[0]?.group.estimatedHeight ?? 180,
      segmentId: segment?.id,
      revision: sources.map(source => source.kind === "archive" ? source.group.revision ?? source.segment.revision ?? "" : source.group.ids.join(",")).join("/"),
      render: () => {
        const source = sources[0];
        if (sources.length === 1 && source.kind === "live") return <Fragment>{renderLive(group, source.position, groups, !!entry.boundary)}</Fragment>;
        return <>{group.selectionChange && <ModelChangeNotice change={group.selectionChange} />}
          {sources.length > 1 || source.kind === "archive" && source.readGroupId ? <HistoryProcess scope={scope} group={group} sources={sources} store={history.store} index={index}
            tail={!entry.boundary && sources.some(source => source.kind === "live" && source.position === groups.length - 1)} animateFold={folding.has(entry.key)} />
            : source.kind === "archive" ? source.group.process
              ? <ArchivedProcess scope={scope} segmentId={source.segment.id} group={source.group} store={history.store} initialTaskInputId={initialTaskInputId} animateFold={folding.has(entry.key)} />
              : <ArchiveBody scope={scope} segmentId={source.segment.id} group={source.group} readGroupId={source.readGroupId} store={history.store} initialTaskInputId={initialTaskInputId} /> : null}</>;
      },
    });
  }
  // Original ranges stay open across new compactions and while reading.
  useEffect(() => { if (!scope) expansions.current = null; }, [scope?.sessionId]);
  const titlePositions = flow.map(entry => {
    const sourceGroups = entry.kind === "card" ? entry.segment.groups : entry.sources.map(source => source.group);
    return { ids: entry.kind === "card" ? entry.segment.messageIds : entry.group.ids,
      runIds: [...new Set(sourceGroups.flatMap(group => group.runIds ?? group.ids.flatMap(id => {
        const message = scope ? scopeSnapshot<ChatMessage>(messageScope(scope, id)) ?? history.store.get(id) : undefined;
        return message?.runId ? [message.runId] : [];
      })))],
    };
  });
  const tail = flow.at(-1);
  return { rows, groups, segments, titlePositions, tailBoundary: tail?.kind === "messages" && !!tail.boundary };
}
