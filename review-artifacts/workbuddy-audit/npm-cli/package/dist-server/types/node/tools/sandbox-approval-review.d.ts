import type { SecurityReviewMetrics } from '@genie/agent-client-protocol';
import type { ReviewerRecovery } from '../../vendor/cbc-core/node/index.js';
import type { RunToolApprovalItem } from '../../vendor/cbc-shared/node/index.js';
import type { SecurityReviewFailureReason, SecurityReviewSandboxInterceptType } from '@genie/telemetry';
export { SANDBOX_REVIEW_PROVIDER_KEY } from '@genie/agent-client-protocol';
export interface SandboxReviewOperation {
    interceptType: SecurityReviewSandboxInterceptType;
    operation: string;
    toolName: string;
    path?: string;
    /** Shell 运行中沙箱观察到并要求审批的文件路径，区别于 command 文本里出现的路径。 */
    askPaths?: string[];
    /** Shell 运行中沙箱观察到并要求审批的子进程命令，区别于顶层 command。 */
    askCommands?: string[];
    /** Shell 运行中沙箱观察到并要求审批的网络目标。 */
    askNetworkTargets?: string[];
    host?: string;
    port?: number;
    scheme?: string;
    command?: string;
    cwd?: string;
    mutation?: Record<string, unknown>;
    scope: 'operation' | 'unsandboxed-command';
    incomplete?: boolean;
}
export interface SandboxReviewDecision extends SecurityReviewMetrics {
    recovery?: ReviewerRecovery;
    decision: 'allow' | 'deny';
    reason: string;
}
export interface SandboxReviewAttempt {
    outcome: 'allow' | 'block' | 'unavailable' | 'not_run';
    requestAttempted: boolean;
    failureReason?: SecurityReviewFailureReason;
    recovery?: ReviewerRecovery;
    notRunReason?: 'cancelled_before_request' | 'action_incomplete' | 'context_too_large';
    durationMs: number;
}
export declare function registerSandboxReviewOperation(item: RunToolApprovalItem, operation: SandboxReviewOperation): void;
export declare function getSandboxReviewOperation(item: RunToolApprovalItem): Readonly<SandboxReviewOperation> | undefined;
