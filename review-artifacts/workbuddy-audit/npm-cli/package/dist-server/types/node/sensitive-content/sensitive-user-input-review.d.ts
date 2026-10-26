import { type SensitiveDecisionMediation as SensitiveDecisionMediationInterface, type SensitiveProtectionPolicy as SensitiveProtectionPolicyInterface, type SensitiveUserInputReview as SensitiveUserInputReviewInterface, type SensitiveUserInputReviewDecision, type SensitiveUserInputReviewRequest } from './sensitive-content-protocol';
export declare class SensitiveUserInputReviewImpl implements SensitiveUserInputReviewInterface {
    protected readonly protectionPolicy?: SensitiveProtectionPolicyInterface;
    protected readonly decisionMediation?: SensitiveDecisionMediationInterface;
    review(request: SensitiveUserInputReviewRequest): Promise<SensitiveUserInputReviewDecision>;
    private deny;
}
