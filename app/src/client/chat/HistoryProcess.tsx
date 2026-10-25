import type { ThreadIndex } from "../../shared/agent.js";
import { activeStatus } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
import { historyProcessSummary, sourceKey, type HistorySource } from "../../shared/history-layout.js";
import { mergeProcessGroups } from "../../shared/thread-layout.js";
import type { ThreadGroup } from "../../shared/history.js";
import { ActivityGroup } from "./ToolActivity.js";
import { ProcessFlow } from "./ProcessFlow.js";
import { pendingModelActivity } from "./ProcessStatus.js";
import { useHistoryRanges, useThreadMessage } from "./OriginalConversation.js";
import type { HistoryStore } from "./history-store.js";

function HistoryProcessBody({ scope, group, sources, store, settled, awaitingMore, activeRunId, requesting, inline }: {
  scope: Scope; group: ThreadGroup; sources: HistorySource[]; store: HistoryStore;
  settled: boolean; awaitingMore: boolean; activeRunId?: string; requesting: boolean; inline: boolean;
}) {
  const archives = sources.filter(source => source.kind === "archive");
  const range = useHistoryRanges(store, archives.map(source => ({ segmentId: source.segment.id, groupId: source.group.id })));
  return <>{!range.ready && (range.error
    ? <p className="execution-alert" role="alert">{range.error} <button type="button" className="btn" onClick={range.retry}>重新加载</button></p>
    : <p className="history-loading" role="status">正在读取会话原文…</p>)}
    <ProcessFlow scope={scope} group={group} contentsOnly archiveExpanded={inline}
    settled={settled} settledIds={archives.flatMap(source => source.group.ids)} awaitingMore={awaitingMore} activeRunId={activeRunId} requesting={requesting} /></>;
}

/** One disclosure for adjacent sources, one unified slice stream inside it.
 * The header reads only the archive catalogue; source bodies are acquired only
 * while open. An archived prefix never settles a currently running live tail.
 */
export function HistoryProcess({ scope, group, sources, store, index, tail, animateFold = false }: {
  scope: Scope; group: ThreadGroup; sources: HistorySource[]; store: HistoryStore; index: ThreadIndex; tail: boolean; animateFold?: boolean;
}) {
  const live = sources.filter(source => source.kind === "live");
  const liveGroup = live.length ? mergeProcessGroups(live.map(source => source.group)) : undefined;
  const last = useThreadMessage(scope, liveGroup?.ids.at(-1) ?? group.ids.at(-1)!);
  const summary = historyProcessSummary(sources);
  const active = !!live.length && tail && activeStatus(index.runStatus);
  const awaitingMore = active && (!last?.runId || last.runId === index.runId);
  const requesting = active && pendingModelActivity(index);
  const settled = !live.length || !tail;
  const inline = !group.folded;
  // Only pure tools/thinking may use a local lazy disclosure. A task-bearing
  // undelivered flow must hydrate its visible range and expose its task cards.
  if (inline && sources.some(source => source.kind === "live" ? source.group.hasTasks : source.group.process?.hasTasks)) {
    return <HistoryProcessBody scope={scope} group={group} sources={sources} store={store} settled={settled}
      awaitingMore={awaitingMore} activeRunId={active ? index.runId : undefined} requesting={requesting} inline={false} />;
  }
  return <ActivityGroup scope={scope} inline={inline} animateFold={animateFold && !inline} settled={settled || !awaitingMore && !requesting}
    messageIds={liveGroup?.ids} thinkingOnlyIds={liveGroup?.thinkingOnlyIds} callsOnlyIds={liveGroup?.callsOnlyIds}
    summary={!live.length ? summary : undefined} prefixSummary={live.length ? summary : undefined}
    awaitingMore={awaitingMore} activeRunId={active ? index.runId : undefined} requesting={requesting}
    disclosureKey={sourceKey(sources[0])} className="archived-process joined-process">
    {open => open ? <HistoryProcessBody scope={scope} group={group} sources={sources} store={store} settled={settled}
      awaitingMore={awaitingMore} activeRunId={active ? index.runId : undefined} requesting={requesting} inline={inline} /> : null}
  </ActivityGroup>;
}
