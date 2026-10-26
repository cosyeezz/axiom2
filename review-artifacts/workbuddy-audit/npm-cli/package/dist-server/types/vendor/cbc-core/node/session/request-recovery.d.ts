import type { AcpTerminalStateItem, AgentInputItem, RequestRecoveryItem } from '../../../cbc-shared/node/index.js';
import type { Session } from './session-protocol';
export declare class RequestRecoveryError extends Error {
    readonly code: 'busy' | 'not_found' | 'stale' | 'not_retryable' | 'incomplete_history';
    readonly name = "RequestRecoveryError";
    constructor(code: 'busy' | 'not_found' | 'stale' | 'not_retryable' | 'incomplete_history', message: string);
}
export interface RequestRecoveryTarget {
    requestId: string;
    userMessageId: string;
    parentId: string;
    /** The next attempt, allocated only when recovery admission is persisted. */
    attempt: number;
}
export declare function isRequestRecoveryItem(item: AgentInputItem): item is RequestRecoveryItem;
export declare function requestAttempt(item: AcpTerminalStateItem | RequestRecoveryItem): number;
/** Facts are selected with their active parent chain, never from abandoned branches. */
export declare function resolveRequestRecoveryHistory(session: Pick<Session, 'history' | 'lastMessageId' | 'hasCompactedHistory' | 'conversationReverted'>): AgentInputItem[];
/** Only the latest attempt may supply a terminal; an unfinished recovery hides older failures. */
export declare function latestRequestTerminals(history: readonly AgentInputItem[]): Set<AcpTerminalStateItem>;
/** Validate a settled, durable current turn. This never mutates history or starts execution. */
export declare function resolveRequestRecovery(history: readonly AgentInputItem[], expectedRequestId: string): RequestRecoveryTarget;
//# sourceMappingURL=request-recovery.d.ts.map