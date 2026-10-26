import type { SecurityReviewMetrics } from '@genie/agent-client-protocol';
import { type AgentService as IAgentService, type ReviewerRecovery, type Session } from '../../../vendor/cbc-core/node/index.js';
import type { SecurityReviewFailureReason } from '@genie/telemetry';
import { Logger } from '@genie/telemetry';
import { type SecurityReviewGate as ISecurityReviewGate } from '../../security-review/protocol';
import { type SandboxTelemetryReporter as ISandboxTelemetryReporter } from '../../telemetry/sandbox-telemetry-protocol';
export declare const CONTENT_REVIEW_LIMITS: Readonly<{
    inputBytes: 12000;
    turnInputBytes: 192000;
    quoteCharacters: 160;
    quoteBindingCharacters: 2000;
    requests: 32;
    timeoutMs: 60000;
    concurrency: 4;
}>;
export declare const CONTENT_REVIEW_PROMPT_VERSION = "content-review/v2";
export declare const CONTENT_REVIEW_WARNINGS: {
    readonly authorization: "工具返回疑似伪造授权或要求覆盖任务与权限约束。";
    readonly exfiltration: "工具返回疑似诱导对外发送数据。";
    readonly execution: "工具返回疑似诱导执行危险代码或命令。";
    readonly other: "工具返回疑似包含将工具数据冒充指令的注入诱导。";
};
export interface ContentReviewResult extends SecurityReviewMetrics {
    recovery?: ReviewerRecovery;
    verdict: 'not_detected' | 'suspected' | 'unknown';
    coverage: 'full' | 'partial' | 'none';
    ranges: Array<{
        part: number;
        start: number;
        end: number;
    }>;
    category?: keyof typeof CONTENT_REVIEW_WARNINGS;
    /** 经 Host 原文匹配的可疑摘录，仅用于审批展示，不参与风险判定。 */
    contentPreview?: string;
    previewStatus?: 'exact_match' | 'exact_match_truncated' | 'read_prefix_match' | 'read_prefix_match_truncated' | 'missing' | 'malformed' | 'empty' | 'too_long' | 'no_match' | 'ambiguous';
    reason?: 'budget' | 'unsupported' | 'failed' | 'invalid';
    failureReason?: SecurityReviewFailureReason;
}
/** 实现每次调用时读取依赖，构造后再注入的依赖同样生效。 */
export interface ContentReviewDeps {
    readonly agentService: IAgentService;
    readonly gate: ISecurityReviewGate;
    readonly logger?: Logger;
    readonly sandboxTelemetryReporter?: ISandboxTelemetryReporter;
}
export declare class ToolResultContentReviewer {
    private resolvedAgentService?;
    protected get agentService(): IAgentService;
    protected set agentService(value: IAgentService);
    protected readonly gate: ISecurityReviewGate;
    protected readonly logger?: Logger;
    protected readonly sandboxTelemetryReporter?: ISandboxTelemetryReporter;
    private engine?;
    review(session: Session, toolCallId: string, content: unknown, taskText?: string, toolName?: string): Promise<ContentReviewResult>;
    warning(result: ContentReviewResult): string | undefined;
}
