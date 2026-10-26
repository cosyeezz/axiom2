import { RunContext, ToolExecuteArgument } from '../../../vendor/cbc-shared/node/index.js';
import { Session } from '../../../vendor/cbc-core/node/index.js';
import { PermissionMode } from '../../../vendor/cbc-shared/node/index.js';
import { SettingsManager } from '../../settings';
import { BaseTool } from '../base-tool';
import { ToolArg } from '../../../vendor/cbc-shared/node/index.js';
import { ToolPermissionStrategy } from '../tool-protocol';
/**
 * Auto permission strategy — deterministic fast paths only.
 *
 * 1. acceptEdits fast path: anything acceptEdits would auto-allow, auto allows too.
 * 2. safe tool allowlist: read-only / metadata built-ins auto-allow.
 * 3. everything else returns `ask` → the service's unified outlet routes it into
 *    the classifier (AutoModePermissionService). The classifier call deliberately
 *    lives outside the strategy so the permission chain stays synchronous/testable.
 */
export declare class ToolPermissionAutoStrategy implements ToolPermissionStrategy {
    mode: PermissionMode;
    protected readonly settingsManager: SettingsManager;
    needApproval(tool: BaseTool, runContext: RunContext<Session>, input: ToolExecuteArgument<any>, checkArgs: ToolArg[], callId?: string): Promise<boolean>;
}
