import { Session } from '../../vendor/cbc-core/node/index.js';
import { type EventService, type Logger } from '@genie/telemetry';
import type { UserTaskFailedCreditRefundReason } from './telemetry-protocol';
/**
 * 维护单个 rootRequestId 下出现过的 conversationRequestId，并在失败时逐条上报退费检测事件。
 */
export declare class CreditRefundTelemetryAccumulator {
    private readonly requestsByRoot;
    private readonly rootUpdatedAt;
    private static readonly ACCUMULATOR_TTL_MS;
    private static readonly MAX_ROOTS;
    recordConversationRequest(session: Session): void;
    recordConversationRequestEnd(session: Session, finishReason: string | undefined): void;
    suppressConversationRequest(session: Session): void;
    reportAndConsume(session: Session, reason: UserTaskFailedCreditRefundReason, eventService: EventService | undefined, logger: Logger): Promise<void>;
    clearForRoot(session: Session): void;
    private getOrCreateRequests;
    private resolveRootRequestId;
    private resolveUserId;
    private shouldSkipReport;
    private shouldReportRequestEntry;
    private isModelPhase;
    private clearRoot;
    private prune;
}
