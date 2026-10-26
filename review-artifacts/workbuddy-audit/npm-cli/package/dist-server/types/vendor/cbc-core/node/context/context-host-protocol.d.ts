import type { Session } from '../session/session-protocol';
export declare const CompactBroadcast: unique symbol;
export declare const CompactHost: unique symbol;
export interface CompactHost {
    findMainSession(session: Session): Session | undefined;
}
export interface CompactBroadcast {
    broadcastCompactStarted(sessionId: string, compactType?: string, session?: Session): Promise<string>;
    broadcastCompactCompleted(sessionId: string, summaryText: string, messageId: string, compactType?: string, session?: Session): Promise<void>;
    broadcastCompactCancelled(sessionId: string): Promise<void>;
    broadcastCompactLimitReached(sessionId: string): Promise<void>;
}
//# sourceMappingURL=context-host-protocol.d.ts.map