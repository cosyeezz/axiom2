import { type AgentInputItem, FinalStopReason, NotificationType, RunResult, SessionEndReason, SessionStartSource, StreamedRunResult } from '../../../cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { AgentPluginRefresh } from '../agent/agent-runtime-protocol';
import { CoreHookExecutor as HookManager, type InternalHookContext } from '../hooks/hook-protocol';
import { SessionHookHost } from './session-hook-host-protocol';
import { Session, SessionHookManager, SessionStore } from './session-protocol';
/**
 * Mark a user item whose UserPromptSubmit policy hooks already passed before
 * queue admission. ACP steer uses this so policy stays before ACK while the
 * durable history write remains at the later, correctly ordered consumption
 * point. The marker is process-local and never serialized into providerData.
 */
export declare function markUserPromptSubmitHooksReviewed(items: readonly AgentInputItem[]): void;
/** Consume the one-shot pre-admission review marker at history admission. */
export declare function consumeUserPromptSubmitHooksReviewed(item: AgentInputItem): boolean;
/**
 * Extract the most recent non-empty assistant message text from a history array.
 *
 * Walks backwards and skips assistant messages whose content is empty or
 * tool-only (e.g. pure function_calls). Returns `undefined` when no such
 * message exists.
 *
 * Exported (rather than kept private) so it can be covered by unit tests and
 * reused elsewhere (e.g. PostCompact summary extraction).
 */
export declare function extractLastAssistantMessageText(history: AgentInputItem[] | undefined | null): string | undefined;
export declare class SessionHookManagerImpl implements SessionHookManager {
    protected readonly hookManager: HookManager;
    protected readonly sessionStore: SessionStore;
    protected readonly logger: Logger;
    protected readonly hookHost: SessionHookHost;
    /**
     * Host bridge to the plugin-runtime projection, joined in
     * executeUserPromptSubmitHooks before plugin-sourced hooks are resolved.
     */
    protected readonly pluginRefresh?: AgentPluginRefresh;
    /**
     * Extract last assistant message as plain text (for Stop/SubagentStop hooks).
     * Prefer the current run result because session.history may still be behind
     * when stop hooks fire; keep history as the fallback for non-final paths.
     */
    private extractLastAssistantMessage;
    /**
     * Resolve transcript path for the session that fires the hook — i.e. the
     * **current** session's jsonl. Inside a sub-agent this is the sub-agent's
     * own transcript (under `<parent>/subagents/<storeId>.jsonl`); on the main
     * thread it's the regular session jsonl.
     *
     * Claude Code parity: `transcript_path` points at the active session's
     * log while `session_id` is rewired to the main agent (see
     * `resolveHookSessionId`). The two are intentionally decoupled so users
     * can both follow the active log and correlate it back to the main
     * conversation. SubagentStop additionally surfaces the same path via
     * `agent_transcript_path` for clarity.
     */
    private getHookTranscriptPath;
    /**
     * Execute UserPromptSubmit hook when user adds input to session
     */
    executeUserPromptSubmitHooks(session: Session, items: AgentInputItem[]): Promise<void>;
    /**
     * Execute SessionStart hooks when a session starts
     */
    executeSessionStartHooks(session: Session, source: SessionStartSource): Promise<void>;
    /**
     * Register fs.watch monitors declared by a SessionStart/Setup hook and
     * dispatch FileChanged events on each change. Replaces any pre-existing
     * disposer on the session so repeated SessionStart hooks (e.g. after
     * /compact) don't leak watchers.
     */
    private setupWatchPaths;
    /**
     * Execute SessionEnd hook when a session is terminated
     */
    executeSessionEndHooks(session: Session, reason: SessionEndReason): Promise<void>;
    /**
     * Execute Stop hook when agent completes responding
     * Per Claude Code spec: exit code 2 shows stderr to model and continues conversation
     *
     * Unified execution: both external shell hooks and internal Hook providers
     * are executed through HookManager.executeHooks()
     */
    executeStopHooks(session: Session, result: RunResult<any, any> | StreamedRunResult<any, any>, options?: {
        stopHookActive?: boolean;
        stopReason?: FinalStopReason;
    }): Promise<void>;
    /**
     * Execute SubagentStop hook when subagent completes responding
     * Per Claude Code spec: exit code 2 shows stderr to subagent and continues execution
     */
    executeSubagentStopHooks(session: Session, result: RunResult<any, any> | StreamedRunResult<any, any>): Promise<void>;
    /**
     * Execute PreCompact hook before context compaction
     * Claude Code compatible: supports manual (/compact) and auto triggers
     *
     * @returns Additional compact instructions from hook stdout (if exit code 0)
     */
    executePreCompactHooks(session: Session, trigger: 'manual' | 'auto', customInstructions?: string): Promise<string | undefined>;
    private executeClassicPreCompactHooks;
    executeNotificationHooks(session: Session | undefined, message: string, notificationType?: NotificationType): Promise<void>;
    /**
     * Execute SubagentStart hook right before a subagent starts running.
     * Claude Code parity: payload carries agent_id / agent_type. Observe-only.
     */
    executeSubagentStartHooks(session: Session): Promise<void>;
    /**
     * Execute StopFailure hook when the Stop hook pipeline itself fails.
     * Claude Code parity: observe-only.
     */
    executeStopFailureHooks(session: Session, error: unknown): Promise<void>;
    /**
     * Execute PostCompact hook after context compaction completes.
     * Claude Code parity: payload carries trigger + compact_summary. Observe-only.
     */
    executePostCompactHooks(session: Session, trigger: 'manual' | 'auto', compactSummary?: string): Promise<void>;
    /**
     * PermissionRequest — fired before the tool approval UI is shown.
     * The hook may override the decision via hookSpecificOutput.decision
     * ({ behavior: 'allow'|'deny', updatedInput, updatedPermissions, message, interrupt }).
     */
    executePermissionRequestHooks(session: Session, toolName: string, toolInput: Record<string, any>, permissionSuggestions?: unknown, callId?: string): Promise<{
        decision?: {
            behavior: 'allow' | 'deny';
            updatedInput?: Record<string, any>;
            updatedPermissions?: unknown;
            message?: string;
            interrupt?: boolean;
        };
    }>;
    /**
     * PermissionDenied — fired after a tool invocation was refused (by the user,
     * or by the auto mode classifier / dontAsk mode).
     * Hook can request a retry via hookSpecificOutput.retry=true.
     */
    executePermissionDeniedHooks(session: Session, toolName: string, toolInput: Record<string, any>, reason: string, callId?: string): Promise<{
        retry?: boolean;
    }>;
    /**
     * Elicitation — fired before cbc asks the user for input on behalf of an MCP server.
     * Hook may auto-respond via hookSpecificOutput.action + content.
     */
    executeElicitationHooks(session: Session, payload: {
        mcpServerName: string;
        message: string;
        mode?: 'form' | 'url';
        url?: string;
        elicitationId?: string;
        requestedSchema?: unknown;
    }): Promise<{
        action?: 'accept' | 'decline' | 'cancel';
        content?: unknown;
    }>;
    /**
     * ElicitationResult — observe-only, fired after an MCP elicitation resolves.
     */
    executeElicitationResultHooks(session: Session, payload: {
        mcpServerName: string;
        elicitationId?: string;
        mode?: 'form' | 'url';
        action: 'accept' | 'decline' | 'cancel';
        content?: unknown;
    }): Promise<void>;
    /**
     * TaskCreated — observe-only, fired when a task enters the task store.
     */
    executeTaskCreatedHooks(session: Session, payload: {
        taskId: string;
        subject: string;
        description?: string;
        teammateName?: string;
        teamName?: string;
    }): Promise<void>;
    /**
     * TaskCompleted — observe-only, fired when a task transitions to completed.
     */
    executeTaskCompletedHooks(session: Session, payload: {
        taskId: string;
        subject: string;
        description?: string;
        teammateName?: string;
        teamName?: string;
    }): Promise<void>;
    /**
     * TeammateIdle — observe-only, fired when a teammate transitions busy→idle.
     * Callers are responsible for debouncing so this only fires on transitions.
     */
    executeTeammateIdleHooks(session: Session, payload: {
        teammateName: string;
        teamName: string;
    }): Promise<void>;
    /**
     * Setup — fired once at startup (trigger='init') or during maintenance.
     * hookSpecificOutput.additionalContext is stored in session.hookContexts
     * for the first user prompt to pick up (alongside sessionStartContext).
     */
    executeSetupHooks(session: Session, trigger: 'init' | 'maintenance'): Promise<void>;
    /**
     * FileChanged — observe-only. Fired when a watched file mutates.
     */
    executeFileChangedHooks(session: Session, payload: {
        filePath: string;
        event: 'change' | 'add' | 'unlink';
    }): Promise<void>;
    /**
     * CwdChanged — observe-only. Fired after a Bash/PowerShell tool changes
     * the working directory.
     */
    executeCwdChangedHooks(session: Session, payload: {
        oldCwd: string;
        newCwd: string;
    }): Promise<void>;
    /**
     * FinalStop — internal-only. Fired when the current run/turn reaches a
     * final terminal state and will not continue via the current Stop hook.
     * Does NOT support continueRequest.
     */
    executeFinalStopHooks(session: Session, reason?: FinalStopReason, internalContext?: Pick<InternalHookContext, 'interceptorGate'>): Promise<void>;
    /**
     * UserPromptExpansion — Claude Code 官方事件：任何用户输入的命令/skill 展开成
     * prompt、送进模型之前统一从这里触发，可阻断展开。`command_args` / `prompt` 按
     * 官方 schema 是必填字段（无参数时发空串，而不是整个省略 key）。
     */
    executeUserPromptExpansionHooks(session: Session, payload: {
        expansionType: 'slash_command' | 'mcp_prompt' | string;
        commandName: string;
        commandArgs: string;
        commandSource?: string;
        prompt: string;
    }): Promise<{
        allowed: boolean;
        message?: string;
    }>;
}
//# sourceMappingURL=session-hook-manager.d.ts.map