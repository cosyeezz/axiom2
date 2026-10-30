import { costParts, emptyCostTotals, type CostTotals } from "../shared/costs.js";
import type { UsageAggregate, UsageAnalytics, UsageBreakdown, UsageRecord, UsageRecordFilter } from "../shared/model-usage.js";

/** Calendar coordinates only: not elapsed 24-hour intervals (which break at DST). */
function calendarDay(format: Intl.DateTimeFormat, timestamp: number): number {
  const parts = format.formatToParts(timestamp), get = (type: string) => Number(parts.find(part => part.type === type)?.value);
  const date = new Date(0); date.setUTCFullYear(get("year"), get("month") - 1, get("day")); date.setUTCHours(0, 0, 0, 0);
  return date.getTime() / 86400000;
}
const dayLabel = (day: number) => new Date(day * 86400000).toISOString().split("T")[0];
function add(total: CostTotals, row: CostTotals) {
  total.records += row.records; total.knownCost += row.knownCost; total.unknownCost += row.unknownCost;
  total.unknownTokens += row.unknownTokens; total.unknownParts += row.unknownParts;
  for (const part of costParts) { total.tokens[part] += row.tokens[part]; total.parts[part] += row.parts[part]; }
  if (row.estimatedRecords) {
    total.estimatedRecords = (total.estimatedRecords ?? 0) + row.estimatedRecords;
    total.estimatedCost = (total.estimatedCost ?? 0) + (row.estimatedCost ?? 0);
    total.estimateSources = [...new Set([...(total.estimateSources ?? []), ...(row.estimateSources ?? [])])].slice(0, 64);
  }
}
const tokenValue = (row: UsageAggregate) => costParts.reduce((sum, part) => sum + row.total.tokens[part], 0);
function breakdown(groups: Map<string, UsageAggregate>): UsageBreakdown {
  const rank = (metric: "tokens" | "cost") => {
    const value = metric === "tokens" ? tokenValue : (row: UsageAggregate) => row.total.knownCost;
    const rows = [...groups.values()].sort((a, b) => (value(b) - value(a) || a.key.localeCompare(b.key)));
    const first = rows.slice(0, 5), rest = rows.slice(5);
    if (rest.length) {
      const other: UsageAggregate = { key: "", label: `其他（${rest.length}项）`, count: 0, total: emptyCostTotals(), other: true };
      for (const row of rest) { other.count += row.count; add(other.total, row.total); }
      first.push(other);
    }
    return first;
  };
  return { tokens: rank("tokens"), cost: rank("cost") };
}

/** One bounded pass over verified ledger rows. No transcript access or pagination-dependent totals. */
export function usageAnalytics(rows: Iterable<UsageRecord>, filter: Pick<UsageRecordFilter, "from" | "to" | "timeZone">): UsageAnalytics {
  const timeZone = filter.timeZone ?? "UTC";
  const format = new Intl.DateTimeFormat("en-US", { timeZone, calendar: "gregory", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit" });
  const days = new Map<number, { count: number; total: CostTotals }>();
  const models = new Map<string, UsageAggregate>(), workspaces = new Map<string, UsageAggregate>(), providers = new Map<string, UsageAggregate>();
  const undated = { count: 0, total: emptyCostTotals() };
  const group = (map: Map<string, UsageAggregate>, key: string, label: string, row: UsageRecord) => {
    let item = map.get(key);
    if (!item) { item = { key, label, count: 0, total: emptyCostTotals() }; map.set(key, item); }
    item.count++; add(item.total, row);
  };
  let first = Infinity, last = -Infinity;
  for (const row of rows) {
    group(models, JSON.stringify([row.provider, row.model]), row.name ?? row.model ?? "未知模型", row);
    group(workspaces, row.workspaceId, row.workspaceName, row);
    group(providers, JSON.stringify(row.provider), row.provider ?? "未识别供应商", row);
    if (row.timestamp === undefined) { undated.count++; add(undated.total, row); continue; }
    const day = calendarDay(format, row.timestamp); first = Math.min(first, day); last = Math.max(last, day);
    let bucket = days.get(day);
    if (!bucket) { bucket = { count: 0, total: emptyCostTotals() }; days.set(day, bucket); }
    bucket.count++; add(bucket.total, row);
  }
  // Explicit bounds include empty days. Open bounds follow observed timestamps, not today's date.
  if (filter.from !== undefined) first = calendarDay(format, filter.from);
  if (filter.to !== undefined) last = calendarDay(format, filter.to);
  const hasRange = Number.isFinite(first) && Number.isFinite(last) && first <= last;
  const bucketDays = hasRange ? Math.max(1, Math.ceil((last - first + 1) / 60)) : 1;
  const trend: UsageAnalytics["trend"] = hasRange ? Array.from({ length: Math.ceil((last - first + 1) / bucketDays) }, (_, i) => ({
    from: dayLabel(first + i * bucketDays), to: dayLabel(Math.min(last, first + (i + 1) * bucketDays - 1)), count: 0, total: emptyCostTotals(),
  })) : [];
  for (const [day, value] of days) {
    const bucket = trend[Math.floor((day - first) / bucketDays)];
    if (bucket) { bucket.count += value.count; add(bucket.total, value.total); }
  }
  return { timeZone, bucketDays, trend, undated, models: breakdown(models), workspaces: breakdown(workspaces), providers: breakdown(providers) };
}
