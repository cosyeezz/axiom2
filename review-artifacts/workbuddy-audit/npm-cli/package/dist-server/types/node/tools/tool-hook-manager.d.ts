import { type InternalHookContext, Session } from '../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { GalileoSessionBridge } from '../galileo/galileo-session-bridge-protocol';
import { HookManager } from '../hooks/hook-protocol';
import { ToolHookManager } from './tool-protocol';
/**
 * PreToolUse hook 拦截时给模型的文本（issue #157167）：只标明拦截来源，hook 原文照传。
 *
 * 只透传原文时模型分不清是 hook 拦截还是工具故障；但应对方式（按反馈调整、做不到就请用户
 * 检查 hooks 配置）已在系统提示词的 hooks 段落里，这里不再追加指令 —— 与 Claude Code
 * （`PreToolUse:<Tool> hook error: …`）、Codex（`Tool call blocked by PreToolUse hook: …`）一致，
 * 二者都不替用户 hook 补充指引。
 */
export declare function formatPreToolUseBlockMessage(toolName: string, reason: string | undefined): string;
/**
 * Implementation of ToolHookManager
 * Handles PreToolUse and PostToolUse hooks with Claude Code compatibility
 */
export declare class ToolHookManagerImpl implements ToolHookManager {
    protected readonly hookManager: HookManager;
    protected readonly logger: Logger;
    protected readonly galileoSessionBridge: GalileoSessionBridge;
    protected readonly toolErrorResolvers: Map<string, (error: unknown) => string | undefined>;
    /**
     * Execute PreToolUse hooks
     */
    executePreToolUseHooks(toolName: string, toolInput: Record<string, any>, session: Session, transcriptPath: string, cwd?: string, callId?: string): Promise<{
        allowed: boolean;
        modifiedInput?: Record<string, any>;
        message?: string;
        permissionDecision?: 'allow' | 'deny' | 'ask';
        permissionDecisionReason?: string;
        runtimeSecurity?: Record<string, unknown>;
        /** hook 声明的审批元数据（已过形状校验），见 readApprovalMeta。 */
        approvalMeta?: Record<string, string>;
        callId?: string;
        preventContinuation?: boolean;
    }>;
    /**
     * Execute PostToolUse hooks
     *
     * NOTE: toolResponse should be the RAW response from the tool,
     * not the ToolResult wrapper. This ensures Claude Code compatibility.
     */
    executePostToolUseHooks(toolName: string, toolInput: Record<string, any>, toolResponse: unknown, session: Session, transcriptPath: string, cwd?: string, callId?: string, internalContext?: InternalHookContext): Promise<{
        message?: string;
        additionalContext?: string;
        updatedToolOutput?: unknown;
        callId?: string;
    }>;
    /**
     * Execute PostToolUseFailure hooks (Claude Code parity).
     * Observe-only: can inject additionalContext, cannot block.
     */
    executePostToolUseFailureHooks(toolName: string, toolInput: Record<string, any>, error: unknown, session: Session, transcriptPath: string, cwd?: string, callId?: string, isInterrupt?: boolean): Promise<{
        message?: string;
        additionalContext?: string;
        updatedToolOutput?: unknown;
    }>;
    /**
     * Register a tool-level thrown error classifier.
     */
    registerToolErrorResolver(toolName: string, resolver: (error: unknown) => string | undefined): void;
    /**
     * thrown 路径上非 ToolExecutionError（如 framework 在 execute 前抛的 zod 校验 Error、
     * 普通运行时异常）的兜底分类：优先调用工具自己注册的 resolver，再按通用特征推断，
     * 避免这类 thrown 全部落 99999。已 typed 的工具不走这里（优先用 toolErrorCode）。
     */
    private resolveThrownErrorCode;
}
