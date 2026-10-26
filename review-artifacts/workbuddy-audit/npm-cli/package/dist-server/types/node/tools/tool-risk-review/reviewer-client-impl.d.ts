import { type AgentService } from '../../../vendor/cbc-core/node/index.js';
import { type ToolRiskReviewClientInput, type ToolRiskReviewClientResult } from './reviewer-client';
export declare function runToolRiskReviewer(agentService: AgentService, input: ToolRiskReviewClientInput): Promise<ToolRiskReviewClientResult>;
