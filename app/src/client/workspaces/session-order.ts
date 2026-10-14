import type { Session } from "../../shared/protocol.js";

import { isAutoTopSession, isTopSession } from "../../shared/session-attention.js";
export { isPrioritySession, isTopSession } from "../../shared/session-attention.js";

/** Active/unread sessions lead the top group without changing the saved pin flag. */
export function compareSessions(a: Session, b: Session): number {
  return Number(isTopSession(b)) - Number(isTopSession(a)) ||
    Number(isAutoTopSession(b)) - Number(isAutoTopSession(a)) ||
    b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
}
