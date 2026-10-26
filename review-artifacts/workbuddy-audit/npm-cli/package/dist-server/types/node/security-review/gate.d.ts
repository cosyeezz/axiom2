import { type TurnSecurityReviewPolicy } from '@genie/product';
import type { Session } from '../session';
import { type SecurityReviewGate as SecurityReviewGateContract } from './protocol';
export declare function normalizeSecurityReviewConfig(rawConfig: unknown): TurnSecurityReviewPolicy;
export declare class SecurityReviewGateImpl implements SecurityReviewGateContract {
    private readonly pendingPolicies;
    private readonly policies;
    setSessionConfig(session: Session, rawConfig: unknown): TurnSecurityReviewPolicy;
    clearSessionConfig(session: Session): void;
    beginTurn(session: Session): TurnSecurityReviewPolicy;
    getTurnPolicy(session: Session): TurnSecurityReviewPolicy;
    isModelBehaviorReviewEnabled(session: Session): boolean;
    isRiskContentProtectionEnabled(session: Session): boolean;
    getAssistedApprovalMode(session: Session, scope?: 'tool' | 'sandbox'): TurnSecurityReviewPolicy['assistedApprovalMode'];
}
