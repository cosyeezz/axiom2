import type { TurnSecurityReviewPolicy } from '@genie/product';
import type { Session } from '../session';
export declare const DEFAULT_TURN_SECURITY_REVIEW_POLICY: TurnSecurityReviewPolicy;
/** 工具结果类审批受风险内容保护开关约束，其余工具风险审批受模型行为审查开关约束。 */
export declare function isToolRiskApprovalEnabled(policy: TurnSecurityReviewPolicy | undefined, reviewType: unknown): boolean;
export declare const SecurityReviewGate: unique symbol;
export interface SecurityReviewGate {
    setSessionConfig(session: Session, rawConfig: unknown): TurnSecurityReviewPolicy;
    /** Clear only the next-turn policy; the running turn keeps its frozen snapshot. */
    clearSessionConfig(session: Session): void;
    beginTurn(session: Session): TurnSecurityReviewPolicy;
    getTurnPolicy(session: Session): TurnSecurityReviewPolicy;
    isModelBehaviorReviewEnabled(session: Session): boolean;
    isRiskContentProtectionEnabled(session: Session): boolean;
    getAssistedApprovalMode(session: Session, scope?: 'tool' | 'sandbox'): TurnSecurityReviewPolicy['assistedApprovalMode'];
}
