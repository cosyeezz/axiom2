import { Session } from '../../vendor/cbc-core/node/index.js';
import { PermissionUpdate, RunContext, ToolArg, ToolExecuteArgument, ToolPermissionResult } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { McpTool } from '../mcp';
import type { BaseTool } from './base-tool';
import { type CommandGateBaseline, ToolPermissionService } from './tool-protocol';
/**
 * Tool Permission Service Implementation
 *
 * Implements a multi-phase permission checking flow:
 *
 * Phase 0: Always approval tools (AskUserQuestion)
 * Phase 1: DENY Rules - Check all DENY rules (HIGHEST PRIORITY)
 * Phase 2: TRUSTED ALLOW Rules - Check allow rules from user-controlled sources
 *          (userSettings, cliArg, flagSettings, session, policySettings)
 *          When directory is trusted, projectSettings/localSettings are also included.
 *          These can override HIGH/CRITICAL safety checks.
 * Phase 3: Safety Check - HIGH/CRITICAL commands require approval in interactive mode
 *          Only reached if no trusted ALLOW rule matched.
 * Phase 4: ASK Rules - Check all ASK rules
 * Phase 5: Bypass Modes - Check bypassPermissions/fullAccess
 *          HIGH/CRITICAL still require approval in bypass mode, unless
 *          CODEBUDDY_IS_SANDBOX is set (visible mode stays bypass).
 * Phase 6: UNTRUSTED ALLOW Rules - Check allow rules from project-level sources
 *          (projectSettings, localSettings when directory is NOT trusted)
 *          CANNOT override HIGH/CRITICAL safety checks
 * Phase 7: Strategy Check - Mode-specific strategy
 * Phase 8: Default ASK - No match = ask user (SECURE DEFAULT)
 *
 * Key principles:
 * - DENY rules have highest priority across ALL sources
 * - Only trusted (user-controlled) ALLOW rules can bypass HIGH/CRITICAL safety checks
 * - Project-level ALLOW rules are promoted to trusted when directory is trusted
 * - Project-level settings CANNOT bypass dangerous commands (prevents supply-chain attacks)
 * - Secure by default: if no rule matches, require approval
 */
export declare class ToolPermissionServiceImpl implements ToolPermissionService {
    private readonly securityReviewGate?;
    private readonly bashSandboxManager?;
    private readonly sandboxTurnConfig?;
    protected readonly logger: Logger;
    private readonly settingsManager;
    private readonly toolArgumentRewriteService;
    private readonly debugService;
    private readonly toolHookManager;
    private readonly sessionStore;
    private readonly directoryTrustService;
    private readonly autoModePermissionService;
    private readonly readTools;
    private readonly editTools;
    /** Tools that always need user interaction (like asking questions) */
    private readonly alwaysApprovalTools;
    /**
     * Check permission and return detailed result
     * This is the main permission checking method following the multi-phase flow
     */
    checkPermission(tool: BaseTool | McpTool, runContext: RunContext<Session>, input: ToolExecuteArgument<any>, callId?: string, resolveArgsCallback?: (runContext: RunContext, input: ToolExecuteArgument<any>, callId?: string) => ToolArg[]): Promise<ToolPermissionResult>;
    recomputeFinalPermission(tool: BaseTool | McpTool, runContext: RunContext<Session>, input: ToolExecuteArgument<any>, callId?: string, resolveArgsCallback?: (runContext: RunContext, input: ToolExecuteArgument<any>, callId?: string) => ToolArg[], hookDecision?: 'ask'): Promise<ToolPermissionResult>;
    /**
     * Check if the effective permission mode is Auto.
     * When in Plan mode with prePlanPermissionMode=Auto, the session is
     * effectively still Auto for classifier purposes (Plan is a read-only
     * overlay, not a full mode replacement).
     */
    private isEffectiveAutoMode;
    /**
     * Downgrade Auto mode for the session. In direct Auto mode, kicks the
     * session back to Default. In Plan+Auto, downgrades prePlanPermissionMode
     * to Default while keeping Plan mode active.
     */
    private kickOutOfAutoMode;
    /**
     * Finalize an `ask` result according to the current permission mode.
     *  - dontAsk: convert ask -> deny (no prompts).
     *  - auto (including Plan+Auto): route ask into the auto mode classifier (allow / deny / ask / fallback).
     * AskUserQuestion and ExitPlanMode are exempt — they are not tool-permission prompts.
     */
    private applyModeFinalization;
    /** Route an auto-mode ask into the classifier and map its verdict to a permission result. */
    private classifyAutoMode;
    /**
     * The engine's declarative verdict on a call (official Mods `$.tool.check`): the rules,
     * the mode and the tool's own check, before the mode settles an ask.
     *
     * An ask stays an ask: no dontAsk deny, no auto-mode classifier, no headless deny (those
     * settle it after `tool.check`, in `checkPermission`). It runs no hook and no tool, and
     * a tool's boolean `needsApproval` answers for the tool, as `recomputeFinalPermission` does.
     */
    checkDeclaredPermission(tool: BaseTool | McpTool, runContext: RunContext<Session>, input: ToolExecuteArgument<any>, resolveArgsCallback?: (runContext: RunContext, input: ToolExecuteArgument<any>, callId?: string) => ToolArg[]): Promise<ToolPermissionResult>;
    private doCheckPermission;
    /**
     * Simplified API for compatibility with openai/agents-core
     * Returns boolean: true = needs approval, false = auto-approved
     *
     * Executes PreToolUse hooks first (if session and callId available),
     * then applies hook's permissionDecision before falling through to checkPermission.
     * This mirrors Claude Code's glY flow where hooks run before canUseTool.
     */
    needsApproval(tool: BaseTool | McpTool, runContext: RunContext<Session>, input: ToolExecuteArgument<any>, callId?: string, resolveArgsCallback?: (runContext: RunContext, input: ToolExecuteArgument<any>, callId?: string) => ToolArg[]): Promise<boolean>;
    /**
     * Rule-only inherited-restriction check for final execution boundaries
     * (DeferExecuteTool / REPL). Returns only rule decisions — no strategy, no
     * mode finalization, no classifier — so callers that already handled
     * interactive approval can still fail closed on a deny. Returns undefined
     * when the tool declares no restrictions.
     */
    checkInheritedRestrictions(tool: BaseTool | McpTool, runContext: RunContext<Session>, input: ToolExecuteArgument<any>, callId?: string, resolveArgsCallback?: (runContext: RunContext, input: ToolExecuteArgument<any>, callId?: string) => ToolArg[]): ToolPermissionResult | undefined;
    /**
     * Apply a hook-provided rewrite while preserving the caller's input envelope.
     */
    private withRewrittenInput;
    /**
     * Deny/ask checks for a tool's inherited restrictions (e.g. ViewImage ← Read).
     * Returns undefined when the tool declares no restrictions, so unrelated tools
     * keep their existing hook-decision precedence.
     */
    private checkRestrictionInheritance;
    /**
     * Lazily resolve SessionHookManager and dispatch PermissionRequest hooks.
     * Kept as a helper so the main method stays readable.
     */
    private dispatchPermissionRequestHook;
    /**
     * Lazily resolve SessionHookManager and dispatch PermissionDenied hooks.
     * Observe-only: the return value is currently unused (retry is advisory).
     */
    private dispatchPermissionDeniedHook;
    /**
     * Execute PreToolUse hooks and cache the result on session for later consumption
     * by executeToolWithHooks (avoids double execution).
     */
    private executeAndCachePreToolUseHooks;
    /**
     * Bash 命令门禁（issue #139526）。`BashTool.needsApproval` 在沙箱与非沙箱两条路径上
     * 都先调用它；未命中或已放行时返回 undefined，调用方照常走原流程。
     *
     * 命中时计费确认叠加在原有检查之上，而不是替代它们：先跑调用方原有的检查，拒绝照常
     * 生效并返回 false；否则在其缓存结果上叠加 `ask` 决策与高积分审批元数据（供 ACP 层
     * 渲染浮层）并返回 true。执行阶段消费同一份缓存，hook 不会重复执行。
     * 沙箱路径的原有检查是 PreToolUse hook：它原本在执行阶段才跑，那时已过审批、无法
     * 再请求确认，所以命中时提前到这里跑。
     */
    applyCommandGate(tool: BaseTool | McpTool, runContext: RunContext<Session>, input: ToolExecuteArgument<any>, callId: string | undefined, baseline: CommandGateBaseline, resolveArgsCallback?: (runContext: RunContext, input: ToolExecuteArgument<any>, callId?: string) => ToolArg[]): Promise<boolean | undefined>;
    /**
     * Cache a PreToolUse result on session for later consumption by executeToolWithHooks.
     * Used by hook results and permission decisions that must survive the SDK approval phase.
     */
    private cachePreToolUseResult;
    private cacheExplicitAskResult;
    /**
     * Apply a permission update to the session context
     * For persistable sources (userSettings, projectSettings, localSettings),
     * also syncs to settings files
     */
    applyUpdate(session: Session, update: PermissionUpdate): Promise<void>;
    /**
     * Persist permission update to settings file if destination is persistable
     */
    private persistUpdateIfNeeded;
    /**
     * Initialize the permission context for a session
     * Loads rules from all settings sources
     */
    initializeContext(session: Session): Promise<void>;
    /**
     * Sync sandbox filesystem deny rules to tool permission deny rules.
     * Converts denyWrite paths to Write/Edit/MultiEdit/NotebookEdit deny rules,
     * and denyRead paths to Read/Glob/Grep/NotebookRead deny rules.
     * Only active when sandbox is enabled.
     */
    private syncSandboxDenyRules;
    private checkCommandSafety;
    private checkDenyRules;
    private checkAskRules;
    private checkAllowRules;
    private checkWithStrategy;
    private generateRuleSuggestions;
    private buildPermissionDeniedError;
    private isMcpTool;
    private isCriticalCommand;
    private isDangerousCommand;
    private getDefaultPermissionArgs;
}
