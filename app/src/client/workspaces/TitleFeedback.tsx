import { useEffect, useRef, useState } from "react";
import type { Scope } from "../../shared/protocol.js";
import type { ProcessingList, ProcessingRecord, ProcessingSummary } from "../../shared/processing.js";
import { titleCardCandidate, titleCardResult } from "../../shared/title-card.js";
import { useProcessingList, useProcessingRecord } from "../processing/records.js";
import { ProcessingDetails, processingDuration } from "../processing/ProcessDetail.js";
import { MetricDetail } from "../chat/MetricDetail.js";
import { Icon } from "../components.js";
import { useModelDisplay } from "../useModelDisplay.js";
import "../styles/title-result.css";

/** Session metadata, not a delegated task, message or new accounting source. */
export function useTitleResult(scope: Scope | null) {
  const list = useProcessingList(scope?.workspaceId ?? null, { kind: "session.title", sessionId: scope?.sessionId, state: "completed" });
  const eligible = (item: ProcessingSummary) => item.workspaceId === scope?.workspaceId && item.sessionId === scope?.sessionId && titleCardCandidate(item);
  const first = list.data?.items.find(eligible);
  // Empty-memory checks can fill a whole page. Scan only summaries until the
  // newest generation is found; never hydrate all historical request bodies.
  const [scan, setScan] = useState<{ root: ProcessingList; before: number }>();
  const cursor = !first && scan?.root === list.data ? scan?.before : undefined;
  const tail = useProcessingList(cursor === undefined ? null : scope?.workspaceId ?? null,
    { kind: "session.title", sessionId: scope?.sessionId, state: "completed", before: cursor });
  const nextItem = cursor !== undefined && !tail.stale && !tail.error ? tail.data?.items.find(eligible) : undefined;
  useEffect(() => {
    if (!list.data || list.stale || list.error || first) return;
    if (scan?.root !== list.data) {
      if (list.data.next !== null) setScan({ root: list.data, before: list.data.next });
    } else if (cursor !== undefined && !tail.stale && !tail.loading && !tail.error && tail.data && !nextItem &&
      tail.data.next !== null && tail.data.next < cursor) setScan({ root: list.data, before: tail.data.next });
  }, [list.data, list.stale, list.error, first, scan, cursor, tail.data, tail.stale, tail.loading, tail.error, nextItem]);
  const item = first ?? nextItem;
  const read = useProcessingRecord(scope?.workspaceId ?? null, item?.id ?? null);
  const record = read.data;
  return !list.error && !read.error && record && record.id === item?.id && record.workspaceId === scope?.workspaceId &&
    record.sessionId === scope?.sessionId && titleCardResult(record) ? record : undefined;
}

/** Compact subagent-style result row; no pending, failed or empty-check placeholders. */
export function TitleResultCard({ record }: { record: ProcessingRecord }) {
  const result = titleCardResult(record), display = useModelDisplay();
  const trigger = useRef<HTMLButtonElement>(null), [opened, setOpened] = useState(false);
  if (!result) return null;
  const status = result.applied ? "会话标题已生成" : "会话标题已生成 · 未采用";
  const model = display(record.selection ?? record.calls.find(call => call.sentAt != null && call.state === "completed")?.selection ?? {});
  return <article className="title-result-card" data-processing-id={record.id} aria-label={status}>
    <button ref={trigger} type="button" className="title-result-trigger" aria-haspopup="dialog" aria-expanded={opened}
      aria-label={`查看标题生成详情：${result.title}${result.applied ? "" : " · 未采用"}`} onClick={() => setOpened(true)}>
      <Icon name="check" className="title-result-state" />
      <span className="title-result-copy"><strong>{result.title}</strong><small>{status} · {model.label} · {processingDuration(record.startedAt, record.endedAt)}</small></span>
      <Icon name="subagent-open" className="title-result-open" />
    </button>
    {opened && trigger.current && <MetricDetail trigger={trigger.current} title="标题生成详情" placement="auto" className="title-result-panel" onClose={() => setOpened(false)}>
      {!result.applied && <p className="meta">标题已生成，但未替换会话名称；手动命名优先。</p>}
      <div className="processing-detail"><ProcessingDetails record={record} /></div>
    </MetricDetail>}
  </article>;
}
