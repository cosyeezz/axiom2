import { activeStatus } from "./agent.js";
import type { Session } from "./protocol.js";

export const sessionPinCooldownMs = 5 * 60 * 1000;

/** Main runs and queued/running children keep their parent session active. */
export function isActiveSession(session: Session): boolean {
  return !!session.activeTasks || !!session.activeTaskCount || activeStatus(session.runStatus);
}

export function isPrioritySession(session: Session): boolean {
  return session.unread || isActiveSession(session);
}

export function isAutoTopSession(session: Session): boolean {
  // Activity overrides persisted cooldowns, including deadlines from older versions.
  // The server expires idle deadlines only after the last foreground viewer leaves.
  return isPrioritySession(session) || (session.autoPinUntil != null && session.autoPinUntil > 0);
}

export function isTopSession(session: Session): boolean {
  return session.pinned || isAutoTopSession(session);
}
