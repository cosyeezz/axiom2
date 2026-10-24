export type CostLevel = 0 | 1 | 2 | 3 | 4;
export const costLevelLabels = ["绿色常亮", "橙色预警（10–20）", "橙色常亮（20–30）", "红色预警（30–40）", "红色常亮（40 及以上）"] as const;

/** Dollars and running minutes share thresholds; either metric can advance a tier. */
export function costLevel(dollars: number | null | undefined, elapsedSeconds: number | null | undefined): CostLevel | null {
  const values = [dollars, elapsedSeconds == null ? null : elapsedSeconds / 60]
    .filter((value): value is number => value != null && Number.isFinite(value) && value >= 0);
  if (!values.length) return null;
  const value = Math.max(...values);
  return value < 10 ? 0 : value < 20 ? 1 : value < 30 ? 2 : value < 40 ? 3 : 4;
}
