import type { HistoryGroup, HistorySegment, ThreadGroup } from "./history.js";
import { mergeProcessGroups } from "./thread-layout.js";

export type HistorySource = { kind: "archive"; segment: HistorySegment; group: HistoryGroup; readGroupId?: string }
  | { kind: "live"; group: ThreadGroup; position: number };
export type HistoryFlow = { kind: "card"; key: string; segment: HistorySegment }
  | { kind: "messages"; key: string; group: ThreadGroup; sources: HistorySource[]; boundary?: boolean };
export const sourceKey = (source: HistorySource) => source.kind === "archive"
  ? `archive:${source.segment.id}:${source.group.id}` : `live:${source.group.id}`;

/** Storage checkpoints are transparent while expanded. Apply exactly the same
 * adjacent-activity rule as live grouping, without reading any archived bodies.
 * Source references remain separate for lazy hydration and per-range controls.
 */
export function historyFlow(segments: HistorySegment[], open: ReadonlyMap<string, boolean>, live: ThreadGroup[], breakAfter: ReadonlySet<string> = new Set(), runIdFor?: (id: string) => string | undefined): HistoryFlow[] {
  const result: HistoryFlow[] = [];
  // A message can contribute thinking, body and calls to separate groups. A
  // metadata card belongs after its last visible contribution, never between them.
  const lastGroup = new Map<string, ThreadGroup>();
  for (const group of [...segments.flatMap(segment => open.get(segment.id) ? segment.groups : []), ...live])
    for (const id of group.ids) lastGroup.set(id, group);
  let pending: HistorySource[] = [];
  const flush = (boundary = false) => {
    if (!pending.length) return;
    result.push({ kind: "messages", key: sourceKey(pending[0]), sources: pending,
      group: pending.length === 1 ? pending[0].group : mergeProcessGroups(pending.map(source => source.group)),
      ...(boundary ? { boundary: true } : {}) });
    pending = [];
  };
  const append = (source: HistorySource) => {
    const group = source.group;
    if (!group.activity) {
      flush(); result.push({ kind: "messages", key: sourceKey(source), group, sources: [source] }); return;
    }
    if (group.selectionChange) flush();
    const cuts = group.ids.flatMap((id, index) => breakAfter.has(id) && lastGroup.get(id) === group ? [index + 1] : []);
    const split = cuts.some(end => end < group.ids.length);
    let start = 0;
    for (const end of [...new Set([...cuts, group.ids.length])]) {
      const ids = group.ids.slice(start, end), retained = new Set(ids);
      const ownership = (id: string) => (source.kind === "archive" ? source.group.messageRunIds?.[id] : runIdFor?.(id)) ??
        (group.runIds?.length === 1 ? group.runIds[0] : undefined);
      const part = split ? { ...group, ids, id: start ? `${group.id}:after:${group.ids[start - 1]}` : group.id,
        // Never advertise every run of a mixed group on each partial range.
        runIds: [...new Set(ids.flatMap(id => ownership(id) ? [ownership(id)!] : []))],
        ...(source.kind === "archive" && source.group.messageRunIds ? { messageRunIds: Object.fromEntries(ids.flatMap(id => ownership(id) ? [[id, ownership(id)!]] : [])) } : {}),
        thinkingOnlyIds: group.thinkingOnlyIds?.filter(id => retained.has(id)),
        callsOnlyIds: group.callsOnlyIds?.filter(id => retained.has(id)),
        bodyHiddenIds: group.bodyHiddenIds?.filter(id => retained.has(id)),
        ...(start ? { selectionChange: undefined } : {}),
        // Aggregate archive counts/preview cannot describe either partial range.
        ...(source.kind === "archive" ? { process: undefined } : {}),
      } : group;
      pending.push(source.kind === "archive"
        ? { ...source, group: { ...source.group, ...part }, ...(split ? { readGroupId: source.readGroupId ?? group.id } : {}) }
        : { ...source, group: part });
      if (cuts.includes(end)) flush(true);
      start = end;
    }
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
