import { type AgentService, type Session } from '../../vendor/cbc-core/node/index.js';
import type { SandboxReviewAttempt, SandboxReviewDecision, SandboxReviewOperation } from './sandbox-approval-review';
export declare const SANDBOX_REVIEW_SYSTEM_PROMPT: string;
export declare function parseSandboxReviewOutput(output: string): SandboxReviewDecision | undefined;
export declare const SANDBOX_REVIEW_MAX_USER_PROMPT_CODE_POINTS = 32000;
export declare function reviewSandboxOperation(agentService: AgentService, operation: Readonly<SandboxReviewOperation>, signal: AbortSignal, onFinished?: (attempt: SandboxReviewAttempt) => void, callerSession?: Session, reasonLanguage?: 'zh-CN' | 'en'): Promise<SandboxReviewDecision | undefined>;
