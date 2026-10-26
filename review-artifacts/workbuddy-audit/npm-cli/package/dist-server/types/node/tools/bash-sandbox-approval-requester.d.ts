import { Logger } from '@celljs/core';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { FunctionCallItem } from '../../vendor/cbc-shared/node/index.js';
import type { RunContext } from '@openai/agents';
import { type SandboxApprovalRequest, type SandboxApprovalRequester } from '../permission';
/**
 * 涉及内置专家、内置市场插件或内置 Skill 文件的命令触发的沙箱规则审批，按 AI 安全防护关闭处理：
 * 不交给沙箱 Reviewer，沙箱的 ask 仍由用户在原审批卡中决定。
 * 文件与命令规则审批需异步核验来源，包含不带路径的插件 bin 调用；判定期间取消则不再入队。
 */
export declare function enqueueWithSandboxReviewSkip<T>(request: SandboxApprovalRequest, toolName: string, abortSignal: AbortSignal | undefined, enqueue: (skipSecurityReview: boolean) => Promise<T>, session: Session, toolCallId?: string): Promise<T>;
/**
 * Session-related context required to surface a sandbox approval request.
 *
 * This mirrors `BashToolSessionInfo` in `bash-tool.ts`; we accept the minimal
 * subset (`runContext` + `details.toolCall`) that the requester actually needs,
 * so the tool side keeps the wider type for its other call paths.
 */
export interface SandboxApprovalRequesterContext {
    runContext: RunContext<Session>;
    details?: {
        toolCall: FunctionCallItem;
    };
    /** Tool name shown by the shared sandbox approval UI. Defaults to Bash. */
    toolName?: string;
}
/**
 * Build a SandboxApprovalRequester that surfaces SandboxOrchestrator approval
 * prompts through the standard InterruptionService flow.
 *
 * Behavior (unchanged from the original inline implementation in BashTool):
 *
 * 1. Unrestricted sessions (`fullAccess`, or bypass + `CODEBUDDY_IS_SANDBOX`)
 *    auto-allow every sandbox approval, including HIGH/CRITICAL and
 *    sandbox policy-classified / 安全中心 ask-list requests. `disableBypassPermissionsMode`
 *    still blocks the CLI bypass path.
 * 2. sandbox policy-classified requests skip the legacy `CommandUtils.checkCommandSafety`
 *    auto-approval and always surface the UI — sandbox policy is more precise.
 * 3. In Bypass permission mode, non-HIGH/CRITICAL commands are auto-approved
 *    without surfacing the UI (mirrors tool-permission-service Phase 5).
 * 4. Server-bound sessions use their `canUseTool` callback. Without that binding,
 *    the CLI synthesises a `RunToolApprovalItem` carrying `_sandboxResolve` and
 *    delivers it through InterruptionService or `interruptionSubject`.
 *
 * The InterruptionService is resolved **once** at the top of each request: it's
 * a singleton DI service whose identity does not change during a sandbox
 * approval, so per-branch lookups would just be noise. If DI is unavailable we
 * degrade to direct-push fallback for every branch in this request.
 */
export declare function createSandboxApprovalRequester(logger: Logger, sessionInfo?: SandboxApprovalRequesterContext, abortSignal?: AbortSignal): SandboxApprovalRequester;
export declare function buildSandboxApprovalItem(request: SandboxApprovalRequest, toolCall: FunctionCallItem, settle: (choice: 'allow_once' | 'allow_session' | 'deny', source?: 'auto') => void, toolName: string, options?: {
    displayCommand?: string;
    describeSensitiveCommand?: boolean;
    skipSecurityReview?: boolean;
}): any;
