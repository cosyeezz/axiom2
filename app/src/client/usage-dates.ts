export type UsageDateRange = { from: string; to: string };
export type UsageDatePreset = "today" | "week" | "month30" | "month" | "all";

/** Local calendar days, never UTC-string slices or fixed 24-hour arithmetic. */
export function parseUsageDay(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return;
  const date = new Date(0);
  date.setFullYear(year, month - 1, day); date.setHours(12, 0, 0, 0);
  if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) return date;
}
export function usageDay(date: Date): string {
  const year = date.getFullYear();
  if (!Number.isFinite(date.getTime()) || year < 1 || year > 9999) return "";
  return `${String(year).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function moveUsageDay(value: string, days: number): string {
  const date = parseUsageDay(value);
  if (!date || !Number.isInteger(days) || Math.abs(days) > 366) return value;
  date.setDate(date.getDate() + days);
  return usageDay(date) || value;
}
export function moveUsageMonth(value: string, months: number): string {
  const date = parseUsageDay(value);
  if (!date || !Number.isInteger(months) || Math.abs(months) > 120) return value;
  const day = date.getDate(); date.setDate(1); date.setMonth(date.getMonth() + months);
  const last = new Date(date); last.setMonth(last.getMonth() + 1, 0);
  date.setDate(Math.min(day, last.getDate()));
  return usageDay(date) || value;
}
export function usageMonth(value: string): string { return `${value.slice(0, 7)}-01`; }
export function usageCalendar(month: string): string[] {
  const first = parseUsageDay(usageMonth(month));
  if (!first) return [];
  first.setDate(first.getDate() - (first.getDay() + 6) % 7);
  return Array.from({ length: 42 }, (_, i) => { const day = new Date(first); day.setDate(day.getDate() + i); return usageDay(day); });
}
export function usageRangeError({ from, to }: UsageDateRange): string {
  if (from && !parseUsageDay(from) || to && !parseUsageDay(to)) return "请输入有效日期，格式为 YYYY-MM-DD。";
  return from && to && from > to ? "开始日期不能晚于结束日期。" : "";
}
export function usageDateBoundary(value: string, end: boolean): number | undefined {
  const date = parseUsageDay(value);
  if (!date) return;
  date.setHours(0, 0, 0, 0);
  if (end) date.setDate(date.getDate() + 1);
  return date.getTime() - (end ? 1 : 0);
}
export function usageDatePreset(preset: UsageDatePreset, now = new Date()): UsageDateRange {
  const to = usageDay(now);
  if (preset === "all") return { from: "", to: "" };
  return { from: preset === "month" ? usageMonth(to) : moveUsageDay(to, preset === "week" ? -6 : preset === "month30" ? -29 : 0), to };
}
export function usageRangeLabel({ from, to }: UsageDateRange): string {
  if (!from && !to) return "全部日期";
  return `${from || "不限开始"} — ${to || "不限结束"}`;
}
