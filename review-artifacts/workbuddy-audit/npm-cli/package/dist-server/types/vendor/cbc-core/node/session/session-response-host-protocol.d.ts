import type { Session } from './session-protocol';
export declare const SessionResponseTelemetry: unique symbol;
export interface SessionResponseTelemetry {
    recordCreditRefundConversationRequestEnd(session: Session, finishReason: string | undefined): void;
    suppressCreditRefundConversationRequest(session: Session): void;
    reportUserTaskFailedCreditRefund(session: Session, reason: 'abnormal_finish_reason'): Promise<void>;
    reportChatMaxTokenReached(session: Session, responseModelId?: string): Promise<void>;
}
//# sourceMappingURL=session-response-host-protocol.d.ts.map