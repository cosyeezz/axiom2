export declare const QueueBroadcastHost: unique symbol;
export interface QueueBroadcastHost {
    broadcastFollowupQueue(sessionId: string, payload: Record<string, unknown>): Promise<void>;
}
//# sourceMappingURL=queue-host-protocol.d.ts.map