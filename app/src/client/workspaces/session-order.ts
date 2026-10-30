import type { Session } from "../../shared/protocol.js";

import { isTopSession } from "../../shared/session-attention.js";
export { isPrioritySession, isTopSession } from "../../shared/session-attention.js";

const orderAt = (session: Session, top: boolean) => top ? session.listOrderAt ?? session.updatedAt : session.updatedAt;
const compare = (a: Session, b: Session, aTop: boolean, bTop: boolean) =>
  Number(bTop) - Number(aTop) || orderAt(b, bTop) - orderAt(a, aTop) || a.id.localeCompare(b.id);

/** Top rows have a fixed order; activity, unread and recency only update their display. */
export function compareSessions(a: Session, b: Session): number {
  return compare(a, b, isTopSession(a), isTopSession(b));
}

/** Keep each visible fork family contiguous. A top family's ENTIRE tree uses
 * stable anchors, so a child's status cannot move siblings or the whole family. */
export function sessionFamilies(rows: Session[]): Session[][] {
  const byId = new Map(rows.map(row => [row.id, row]));
  const parent = (row: Session) => {
    const candidate = row.forkParentSessionId ? byId.get(row.forkParentSessionId) : undefined;
    return candidate?.workspaceId === row.workspaceId && candidate.id !== row.id ? candidate : undefined;
  };
  const children = new Map<string, Session[]>();
  for (const row of rows) {
    const owner = parent(row);
    if (owner) children.set(owner.id, [...children.get(owner.id) ?? [], row]);
  }
  const visited = new Set<string>(), families: Session[][] = [];
  for (const root of rows.filter(row => !parent(row))) {
    const family: Session[] = [], stack = [root];
    while (stack.length) {
      const row = stack.pop()!;
      if (visited.has(row.id)) continue;
      visited.add(row.id); family.push(row);
      stack.push(...children.get(row.id) ?? []);
    }
    families.push(family);
  }
  // Match the server's isolated fallback for malformed unrooted components.
  for (const row of rows) if (!visited.has(row.id)) families.push([row]);
  const topById = new Map(families.flatMap(family => {
    const top = family.some(isTopSession);
    return family.map(row => [row.id, top] as const);
  }));
  const sorted = [...rows].sort((a, b) => compare(a, b, topById.get(a.id)!, topById.get(b.id)!));
  const rank = new Map(sorted.map((row, index) => [row.id, index]));
  const firstRank = (family: Session[]) => family.reduce((best, row) => Math.min(best, rank.get(row.id)!), Infinity);
  return families.sort((a, b) => firstRank(a) - firstRank(b)).map(family => {
    if (family.length === 1) return family;
    const ordered: Session[] = [], stack = [family[0]];
    while (stack.length) {
      const row = stack.pop()!;
      ordered.push(row);
      stack.push(...[...children.get(row.id) ?? []].sort((a, b) => rank.get(b.id)! - rank.get(a.id)!));
    }
    return ordered;
  });
}
