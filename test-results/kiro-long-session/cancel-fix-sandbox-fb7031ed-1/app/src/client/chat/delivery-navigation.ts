export type ScrollDirection = "up" | "down";

/** Step through ordered starts, never back to the same aligned delivery.
 * A remembered target also handles rapid clicks and starts clamped at an edge.
 * Manual scrolling clears that target and resumes from the actual reading line. */
export function nextDelivery<T extends { key: string; start: number }>(
  candidates: T[], readingTop: number, direction: ScrollDirection, currentKey?: string | null,
): T | undefined {
  const current = currentKey ? candidates.findIndex(candidate => candidate.key === currentKey) : -1;
  if (current >= 0) return candidates[current + (direction === "up" ? -1 : 1)];
  return direction === "up" ? candidates.findLast(candidate => candidate.start < readingTop - 2)
    : candidates.find(candidate => candidate.start > readingTop + 2);
}
