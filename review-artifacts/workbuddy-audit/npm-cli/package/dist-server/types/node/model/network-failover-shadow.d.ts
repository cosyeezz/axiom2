export interface ChatShadowOperation {
    operationId: string;
    nextAttempt: number;
    commitReached: boolean;
}
export interface ChatShadowAuditEvent {
    sequence: number;
    timestamp: number;
    routeId: 'core-api';
    operation: 'chat.stream';
    operationId: string;
    attempt: number;
    outcome: 'success' | 'terminal_error';
    httpStatus?: number;
    transportCode?: string;
    durationMs: number;
    commitReached: boolean;
}
export declare class ChatNetworkFailoverShadowRecorder {
    private readonly events;
    private currentBytes;
    private nextSequence;
    begin(enabled: boolean): ChatShadowOperation | undefined;
    observeAttempt<T extends {
        status?: number;
    }>(operation: ChatShadowOperation | undefined, request: () => Promise<T>): Promise<T>;
    markCommitReached(operation: ChatShadowOperation | undefined): void;
    recent(limit?: number): ChatShadowAuditEvent[];
    clearForTests(): void;
    private append;
}
export declare const chatNetworkFailoverShadowRecorder: ChatNetworkFailoverShadowRecorder;
