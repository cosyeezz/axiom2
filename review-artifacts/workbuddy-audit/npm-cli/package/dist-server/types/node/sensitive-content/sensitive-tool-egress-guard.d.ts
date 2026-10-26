import { type SensitiveContentMediation as SensitiveContentMediationInterface, type SensitiveEgressReusePolicy as SensitiveEgressReusePolicyInterface, type SensitiveProtectionPolicy as SensitiveProtectionPolicyInterface, type SensitiveToolEgressGuard as SensitiveToolEgressGuardInterface, type ToolEgressDecision, type ToolEgressReviewRequest } from './sensitive-content-protocol';
export declare class SensitiveToolEgressGuardImpl implements SensitiveToolEgressGuardInterface {
    protected readonly protectionPolicy?: SensitiveProtectionPolicyInterface;
    protected readonly mediation?: SensitiveContentMediationInterface;
    protected readonly egressReusePolicy?: SensitiveEgressReusePolicyInterface;
    authorize(request: ToolEgressReviewRequest): Promise<ToolEgressDecision>;
}
