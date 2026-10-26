import { type ResolvedToolEgressReviewRequest, type SensitiveContentMediation as SensitiveContentMediationInterface, type SensitiveDecisionMediation as SensitiveDecisionMediationInterface, type ToolEgressDecision } from './sensitive-content-protocol';
export declare class SensitiveContentMediationImpl implements SensitiveContentMediationInterface {
    protected readonly decisionMediation?: SensitiveDecisionMediationInterface;
    authorizeToolEgress(request: ResolvedToolEgressReviewRequest): Promise<ToolEgressDecision>;
}
