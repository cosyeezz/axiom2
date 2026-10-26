import { Logger } from '@celljs/core';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { PermissionMode, RunContext, ToolArg, ToolExecuteArgument } from '../../vendor/cbc-shared/node/index.js';
import { SettingsManager } from '../settings';
import { BaseTool } from './base-tool';
import { ToolPermissionStrategy } from './tool-protocol';
export declare class ToolPermissionDefaultStrategy implements ToolPermissionStrategy {
    mode: PermissionMode;
    protected readonly settingsManager: SettingsManager;
    protected readonly logger: Logger;
    needApproval(tool: BaseTool, runContext: RunContext<Session>, input: ToolExecuteArgument<any>, checkArgs: ToolArg[], callId?: string): Promise<boolean>;
}
export declare class ToolPermissionAcceptEditsStrategy implements ToolPermissionStrategy {
    mode: PermissionMode;
    protected readonly settingsManager: SettingsManager;
    needApproval(tool: BaseTool, runContext: RunContext<Session>, input: ToolExecuteArgument<any>, checkArgs: ToolArg[], callId?: string): Promise<boolean>;
}
export declare class ToolPermissionPlanStrategy implements ToolPermissionStrategy {
    mode: PermissionMode;
    protected readonly settingsManager: SettingsManager;
    protected readonly logger: Logger;
    needApproval(tool: BaseTool, runContext: RunContext<Session>, input: ToolExecuteArgument<any>, checkArgs: ToolArg[], callId?: string): Promise<boolean>;
    /**
     * 委托给进入 plan 模式前的权限策略
     * 如果没有前置模式，则使用 Default 策略
     */
    private delegateToPrePlanStrategy;
    /**
     * 检查是否为计划文件的编辑操作
     * 在计划模式下，写入当前 session 的计划文件不需要授权
     */
    private isPlanFileEdit;
}
export declare class ToolPermissionBypassPermissionsStrategy implements ToolPermissionStrategy {
    mode: PermissionMode;
    protected readonly settingsManager: SettingsManager;
    needApproval(tool: BaseTool, runContext: RunContext<Session>, input: ToolExecuteArgument<any>, checkArgs: ToolArg[], callId?: string): Promise<boolean>;
}
/**
 * Work 权限策略
 * - Read: 不需要授权（不检查信任目录）
 * - Edit: 在信任目录中不需要授权，否则需要授权
 * - Bash: 安全命令不需要授权，否则需要授权
 */
export declare class ToolPermissionWorkStrategy implements ToolPermissionStrategy {
    mode: PermissionMode;
    protected readonly settingsManager: SettingsManager;
    needApproval(tool: BaseTool, runContext: RunContext<Session>, input: ToolExecuteArgument<any>, checkArgs: ToolArg[], callId?: string): Promise<boolean>;
}
/**
 * DontAsk 权限策略（安全基线）
 *
 * 对齐 Claude Code 的 dontAsk 语义："Don't prompt for permissions, deny if not
 * pre-approved" —— 只放行 baseline（default 模式）下本就不会弹权限提示的动作，
 * 其余一律走统一出口转 deny。
 *
 * - Read: 信任目录内不需要授权（与 default 一致）；否则需要授权 → deny
 * - Bash: 始终需要授权 → deny。即使命令名在 SAFE_COMMAND_WHITELIST 中（npm/node/
 *   git/python 等），它们能执行任意代码，不属于"预批准"的免提示动作；与 Claude
 *   对齐（如 `npm test` 在 dontAsk 下被拒）。用户可通过 allow 规则显式预批准，
 *   那会在更早的 allow 阶段命中、不会到达本策略。
 * - Edit / 其他: 需要授权 → deny
 *
 * 这里返回 true（需要授权）的情形，由 ToolPermissionService 的统一 ask 收口在
 * dontAsk 模式下转成 deny（不弹权限确认）。
 */
export declare class ToolPermissionDontAskStrategy implements ToolPermissionStrategy {
    mode: PermissionMode;
    protected readonly settingsManager: SettingsManager;
    needApproval(tool: BaseTool, runContext: RunContext<Session>, input: ToolExecuteArgument<any>, checkArgs: ToolArg[], callId?: string): Promise<boolean>;
}
