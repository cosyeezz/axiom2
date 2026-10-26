import { type Session, SessionResponseTelemetry } from '../../vendor/cbc-core/node/index.js';
import { TelemetryService } from '../telemetry/telemetry-protocol';
export declare class SessionResponseTelemetryAdapter implements SessionResponseTelemetry {
    protected readonly telemetry: TelemetryService;
    recordCreditRefundConversationRequestEnd(session: Session, finishReason: string | undefined): void;
    suppressCreditRefundConversationRequest(session: Session): void;
    reportUserTaskFailedCreditRefund(session: Session, reason: 'abnormal_finish_reason'): Promise<void>;
    reportChatMaxTokenReached(session: Session, responseModelId?: string): Promise<void>;
}
