import type { RunContext, ToolExecuteArgument } from '../../vendor/cbc-shared/node/index.js';
import type { Session } from '../../vendor/cbc-core/node/index.js';
import { BaseTool } from './base-tool';
/**
 * File-writing tools whose permission decision is delegated to the sandbox
 * write-rule guard whenever the sandbox path is active.
 *
 * The legacy permission service remains the fallback when sandbox execution is
 * disabled or unavailable. ToolManager still executes PreToolUse hooks on the
 * cache-miss path before SandboxWriteRuleGuard runs.
 */
export declare abstract class SandboxPermissionFileTool extends BaseTool {
    needsApproval: (runContext: RunContext<Session>, input: ToolExecuteArgument<any>, callId?: string) => Promise<boolean>;
}
