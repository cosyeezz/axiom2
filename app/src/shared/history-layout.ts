import type { HistoryGroup, HistorySegment, ThreadGroup } from "./history.js";
import { mergeProcessGroups } from "./thread-layout.js";

export type HistorySource = { kind: "archive"; segment: HistorySegment; group: HistoryGroup }
  | { kind: "live"; group: ThreadGroup; position: number };
export type HistoryFlow = { kind: "card"; key: string; segment: HistorySegment }
  | { kind: "messages"; key: string; group: ThreadGroup; sources: HistorySource[] };
export const sourceKey = (source: HistorySource) => source.kind === "archive"
  ? `archive:${source.segment.id}:${source.group.id}` : `live:${source.group.id}`;

/** Storage checkpoints are transparent while expanded. Apply exactly the same
 * adjacent-activity rule as live grouping, without reading any archived bodies.
 * Source references remain separate for lazy hydration and per-range controls.
 */
export function historyFlow(segments: HistorySegment[], open: ReadonlyMap<string, boolean>, live: ThreadGroup[]): HistoryFlow[] {
  const result: HistoryFlow[] = [];
  let pending: HistorySource[] = [];
  const flush = () => {
    if (!pending.length) return;
    result.push({ kind: "messages", key: sourceKey(pending[0]), sources: pending,
      group: pending.length === 1 ? pending[0].group : mergeProcessGroups(pending.map(source => source.group)) });
    pending = [];
  };
  const append = (source: HistorySource) => {
    if (!source.group.activity || source.group.selectionChange) flush();
    if (source.group.activity) pending.push(source);
    else result.push({ kind: "messages", key: sourceKey(source), group: source.group, sources: [source] });
  };
  for (const segment of segments) {
    if (!open.get(segment.id)) {
      flush(); result.push({ kind: "card", key: `compression:${segment.id}`, segment });
    } else for (const group of segment.groups) append({ kind: "archive", segment, group });
  }
  live.forEach((group, position) => append({ kind: "live", group, position }));
  flush();
  return result;
}

/** Archive outcome follows its last source, not an earlier failed attempt. */
export function historyProcessSummary(sources: HistorySource[]): HistoryGroup["process"] {
  const summaries = sources.flatMap(source => source.kind === "archive" && source.group.process ? [source.group.process] : []);
  const last = summaries.at(-1);
  if (!last) return undefined;
  return { ...last, inline: false, calls: summaries.reduce((n, part) => n + part.calls, 0),
    failed: summaries.reduce((n, part) => n + part.failed, 0),
    succeeded: summaries.reduce((n, part) => n + (part.succeeded ?? 0), 0),
    latest: summaries.findLast(part => part.latest)?.latest };
}
