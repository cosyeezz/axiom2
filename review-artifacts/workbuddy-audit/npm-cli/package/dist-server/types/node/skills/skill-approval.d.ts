import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { ProductManager, Skill, SkillApprovalRule } from '@genie/product';
export interface SkillLookupResult {
    skill?: Skill;
    error?: string;
}
type SkillModelInvocationPredicate = (skill: Skill) => boolean | Promise<boolean>;
export interface ResolvedSkillApprovalDecision {
    policyId: string;
    mandatory: boolean;
    presentation: SkillApprovalRule['presentation'];
    authorization: SkillApprovalRule['authorization'];
}
export declare function findSkillByName(skills: Skill[] | undefined, skillName: string): SkillLookupResult;
export declare function unwrapSkillInput(input: unknown): Record<string, unknown>;
export declare function getRequestedSkillName(input: unknown): string;
export declare function getResolvedSkillApprovalDecision(session: Session, callId: string | undefined): ResolvedSkillApprovalDecision | undefined;
export declare function clearResolvedSkillApprovalDecision(session: Session, callId: string | undefined): void;
export declare function bindResolvedSkillApprovalDecision(session: Session, rawItem: {
    callId?: string;
    providerData?: Record<string, unknown>;
}): ResolvedSkillApprovalDecision | undefined;
export declare function getBoundSkillApprovalDecision(rawItem: {
    providerData?: Record<string, unknown>;
}): ResolvedSkillApprovalDecision | undefined;
export declare function resolveSkillApprovalRejectionContent(rawItem: {
    providerData?: Record<string, unknown>;
}): string | undefined;
export type SkillApprovalFailureReporter = (stage: 'configuration' | 'model', requiresApproval: boolean) => void;
export declare function needsSkillApproval(productManager: ProductManager, session: Session, input: unknown, reportFailure?: SkillApprovalFailureReporter, callId?: string, isModelInvocable?: SkillModelInvocationPredicate): Promise<boolean>;
export {};
