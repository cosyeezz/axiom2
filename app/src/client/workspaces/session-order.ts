import type { Session } from "../../shared/protocol.js";

import { isAutoTopSession, isTopSession } from "../../shared/session-attention.js";
export { isPrioritySession, isTopSession } from "../../shared/session-attention.js";

/** Active/unread sessions lead the top group without changing the saved pin flag. */
export function compareSessions(a: Session, b: Session): number {
  return Number(isTopSession(b)) - Number(isTopSession(a)) ||
    Number(isAutoTopSession(b)) - Number(isAutoTopSession(a)) ||
    b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
}

/** Keep each visible fork family contiguous. Missing parents remain independent rows. */
export function sessionFamilies(rows: Session[]): Session[][] {
  const sorted = [...rows].sort(compareSessions);
  const byId = new Map(sorted.map(row => [row.id, row]));
  const parent = (row: Session) => {
    const candidate = row.forkParentSessionId ? byId.get(row.forkParentSessionId) : undefined;
    return candidate?.workspaceId === row.workspaceId && candidate.id !== row.id ? candidate : undefined;
  };
  const children = new Map<string, Session[]>();
  for (const row of sorted) {
    const owner = parent(row);
    if (owner) children.set(owner.id, [...children.get(owner.id) ?? [], row]);
  }
  const visited = new Set<string>(), families: Session[][] = [];
  const visit = (root: Session) => {
    if (visited.has(root.id)) return;
    const family: Session[] = [], stack = [root];
    while (stack.length) {
      const row = stack.pop()!;
      if (visited.has(row.id)) continue;
      visited.add(row.id); family.push(row);
      stack.push(...[...children.get(row.id) ?? []].reverse());
    }
    families.push(family);
  };
  sorted.filter(row => !parent(row)).forEach(visit);
  sorted.forEach(visit); // Malformed cycles must neither hide rows nor loop forever.
  const rank = new Map(sorted.map((row, index) => [row.id, index]));
  const firstRank = (family: Session[]) => family.reduce((best, row) => Math.min(best, rank.get(row.id)!), Infinity);
  return families.sort((a, b) => firstRank(a) - firstRank(b));
}
