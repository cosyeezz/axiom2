import { AgentInputItemProcessor, AgentInputItemProcessorPriority, type Session } from '../../../vendor/cbc-core/node/index.js';
import type { AgentInputItem } from '../../../vendor/cbc-shared/node/index.js';
import { type SecurityReviewGate as ISecurityReviewGate } from '../../security-review/protocol';
import { type ToolRiskReviewService as IToolRiskReviewService } from './protocol';
export declare class ToolContentHistoryAdmissionProcessor implements AgentInputItemProcessor {
    priority: AgentInputItemProcessorPriority;
    protected readonly service: IToolRiskReviewService;
    protected readonly securityReviewGate: ISecurityReviewGate;
    process(item: AgentInputItem, session: Session): Promise<void>;
}
