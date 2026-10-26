import type { ProcessingRecord, ProcessingSummary } from "./processing.js";

/** Empty-memory checks are not title generations; genuine attempts include errors. */
export function titleProcessCandidate(item: ProcessingSummary) {
  return item.kind === "session.title" && item.outcome !== "no_evidence" &&
    (item.state !== "completed" || item.outcome === "applied" || item.outcome === "not_applied");
}

export interface TitlePosition { ids: string[]; runIds?: string[] }
/** No unknown-record fallback to the current tail. Older records identify only a run. */
export function titleCardPosition(item: ProcessingSummary, positions: TitlePosition[]) {
  if (item.anchorMessageId) return positions.findLastIndex(position => position.ids.includes(item.anchorMessageId!));
  return item.runId ? positions.findIndex(position => position.runIds?.includes(item.runId!)) : -1;
}

/** A finished check is not necessarily a model-generated title. */
export function titleCardCandidate(item: ProcessingSummary) {
  return item.kind === "session.title" && item.state === "completed" &&
    (item.outcome === "applied" || item.outcome === "not_applied");
}

/** Only validated, actually sent model results may create a conversation card. */
export function titleCardResult(record: ProcessingRecord) {
  if (!titleCardCandidate(record) || !record.result || record.result.truncated ||
    !record.calls.some(call => call.sentAt != null && call.state === "completed" && !call.error)) return;
  try {
    const result: unknown = JSON.parse(record.result.text);
    if (!result || typeof result !== "object" || !("title" in result) || !("applied" in result)) return;
    const { title, applied } = result;
    if (typeof title !== "string" || typeof applied !== "boolean" || applied !== (record.outcome === "applied")) return;
    if (!title.trim() || title !== title.trim() || [...title].length > 13 || /[<>\p{Cc}\p{Cs}]/u.test(title)) return;
    return { title, applied };
  } catch { return; }
}
