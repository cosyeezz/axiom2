import { activeStatus } from "./agent.js";
import type { Session } from "./protocol.js";

export const sessionPinCooldownMs = 5 * 60 * 1000;

/** Activity indicators stay independent of whether a viewed session has returned to its workspace. */
export function isPrioritySession(session: Session): boolean {
  return session.unread || !!session.activeTasks || !!session.activeTaskCount || activeStatus(session.runStatus);
}

export function isAutoTopSession(session: Session): boolean {
  // The server expires deadlines only after the last foreground viewer leaves.
  return session.unread || (session.autoPinUntil != null
    ? session.autoPinUntil > 0
    : isPrioritySession(session));
}

export function isTopSession(session: Session): boolean {
  return session.pinned || isAutoTopSession(session);
}
