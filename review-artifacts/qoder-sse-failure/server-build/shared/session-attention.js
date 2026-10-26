import { activeStatus } from "./agent.js";
export const sessionPinCooldownMs = 5 * 60 * 1000;
/** Main runs and queued/running children keep their parent session active. */
export function isActiveSession(session) {
    return !!session.activeTasks || !!session.activeTaskCount || activeStatus(session.runStatus);
}
export function isPrioritySession(session) {
    return session.unread || isActiveSession(session);
}
export function isAutoTopSession(session) {
    // Activity overrides persisted cooldowns, including deadlines from older versions.
    // The server expires idle deadlines only after the last foreground viewer leaves.
    return isPrioritySession(session) || (session.autoPinUntil != null && session.autoPinUntil > 0);
}
export function isTopSession(session) {
    return session.pinned || isAutoTopSession(session);
}
//# sourceMappingURL=session-attention.js.map