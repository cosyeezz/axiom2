import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { RemoteRuntimeSecurity, RuntimeSecurityScene } from '@genie/product';
import type { HookExecutionResult, HookInput } from '../hooks/hook-protocol';
export declare const RuntimeSecurityPolicyProvider: unique symbol;
export interface RuntimeSecurityPolicyProvider {
    getPolicy(): Promise<RemoteRuntimeSecurity | undefined>;
}
export declare const RuntimeSecurityAuditService: unique symbol;
export interface RuntimeSecurityAuditService {
    audit(scene: RuntimeSecurityScene, input: HookInput, policy: RemoteRuntimeSecurity): Promise<HookExecutionResult | undefined>;
}
export interface RuntimeSecurityApprovalRequest {
    scene: RuntimeSecurityScene;
    session: Session;
    ruleName: string;
    hitContent: string;
    auditId: string;
    defaultDecision: 'deny';
    signal?: AbortSignal;
}
export type RuntimeSecurityApprovalOutcome = 'allow' | 'deny' | 'default';
export declare const RuntimeSecurityApprovalService: unique symbol;
export interface RuntimeSecurityApprovalService {
    requestApproval(request: RuntimeSecurityApprovalRequest): Promise<RuntimeSecurityApprovalOutcome>;
}
