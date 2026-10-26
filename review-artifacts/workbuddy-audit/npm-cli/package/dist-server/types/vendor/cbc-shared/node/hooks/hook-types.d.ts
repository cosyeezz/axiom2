import type { AgentInputItem } from '../agent/openai-agents-types';
/** Structured detail of a single hook that blocked the operation. */
export interface HookBlockingDetail {
    command?: string;
    /** 2 = blocking; -1 = exec failure/timeout. */
    exitCode?: number;
    reason: string;
    /** exit2 includes the command in the message; json renders only the reason. */
    source?: 'exit2' | 'json';
    truncated?: boolean;
    /** Enterprise runtime-security presentation metadata for dedicated clients. */
    runtimeSecurity?: Record<string, unknown>;
}
export declare class HookBlockedError extends Error {
    readonly hookEvent: string;
    readonly reason: string;
    readonly blockingDetails?: HookBlockingDetail[] | undefined;
    /** continue:false uses the stopped message rather than the blocked message. */
    readonly stopped?: boolean | undefined;
    constructor(hookEvent: string, reason: string, blockingDetails?: HookBlockingDetail[] | undefined, 
    /** continue:false uses the stopped message rather than the blocked message. */
    stopped?: boolean | undefined);
    private static buildMessage;
}
export type SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact';
export type SessionEndReason = 'clear' | 'logout' | 'prompt_input_exit' | 'resume' | 'bypass_permissions_disabled' | 'other';
export type FinalStopReason = 'completed' | 'cancelled' | 'failed' | 'interrupted';
export type HookPermissionMode = 'default' | 'plan' | 'acceptEdits' | 'auto' | 'dontAsk' | 'bypassPermissions';
/** JSON-serializable hook projection; excludes output buffers and task capabilities. */
export interface BackgroundTaskInfo {
    id: string;
    tool_name: string;
    title: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'killed';
    start_time: number;
    end_time?: number;
    description?: string;
}
export interface CronTaskInfo {
    id: string;
    cron: string;
    prompt: string;
    recurring?: boolean;
    durable?: boolean;
    permanent?: boolean;
    created_at: number;
    last_fired_at?: number;
}
export declare enum NotificationType {
    PERMISSION_PROMPT = "permission_prompt",
    IDLE_PROMPT = "idle_prompt",
    AUTH_SUCCESS = "auth_success",
    ELICITATION_DIALOG = "elicitation_dialog",
    AGENT_NEEDS_INPUT = "agent_needs_input",
    AGENT_COMPLETED = "agent_completed"
}
export declare enum HookEvent {
    PRE_TOOL_USE = "PreToolUse",
    POST_TOOL_USE = "PostToolUse",
    NOTIFICATION = "Notification",
    USER_PROMPT_SUBMIT = "UserPromptSubmit",
    STOP = "Stop",
    SUBAGENT_STOP = "SubagentStop",
    PRE_COMPACT = "PreCompact",
    SESSION_START = "SessionStart",
    SESSION_END = "SessionEnd",
    WORKTREE_CREATE = "WorktreeCreate",
    WORKTREE_REMOVE = "WorktreeRemove",
    POST_TOOL_USE_FAILURE = "PostToolUseFailure",
    SUBAGENT_START = "SubagentStart",
    STOP_FAILURE = "StopFailure",
    POST_COMPACT = "PostCompact",
    CONFIG_CHANGE = "ConfigChange",
    INSTRUCTIONS_LOADED = "InstructionsLoaded",
    PERMISSION_REQUEST = "PermissionRequest",
    PERMISSION_DENIED = "PermissionDenied",
    ELICITATION = "Elicitation",
    ELICITATION_RESULT = "ElicitationResult",
    TASK_CREATED = "TaskCreated",
    TASK_COMPLETED = "TaskCompleted",
    TEAMMATE_IDLE = "TeammateIdle",
    SETUP = "Setup",
    FILE_CHANGED = "FileChanged",
    CWD_CHANGED = "CwdChanged",
    /** Terminal event; does not support continueRequest. */
    FINAL_STOP = "FinalStop",
    /**
     * Triggered when a user-typed command/skill expands into a prompt, before
     * it reaches the model. Can block the expansion.
     * Claude Code parity: matcher filters on `command_name`.
     */
    USER_PROMPT_EXPANSION = "UserPromptExpansion"
}
/** Hook script stdout payload. */
export interface HookOutput {
    continue?: boolean;
    stopReason?: string;
    suppressOutput?: boolean;
    systemMessage?: string;
    decision?: 'block' | string;
    reason?: string;
    async?: boolean;
    /** Async timeout override in milliseconds. */
    asyncTimeout?: number;
    hookSpecificOutput?: {
        hookEventName?: string;
        [key: string]: any;
    };
    [key: string]: any;
}
export interface HookExecutionResult {
    allowed: boolean;
    modifiedInput?: Record<string, any>;
    hookSpecificOutput?: Record<string, any>;
    message?: string;
    suppressOutput?: boolean;
    systemMessage?: string;
    permissionDecisionReason?: string;
    exitCode?: number;
    command?: string;
    stdout?: string;
    stderr?: string;
    error?: Error;
    blockingDetails?: HookBlockingDetail[];
    blockSource?: 'exit2' | 'json';
    /**
     * Only genuine exit-2 / JSON blocking decisions may continue Stop/SubagentStop.
     * Timeouts, spawn failures and continue:false must leave this unset.
     */
    blocking?: boolean;
    continueRequest?: {
        message: AgentInputItem;
        completionPromise?: Promise<void>;
    };
    /** Overrides continuation even if allowed=false. */
    preventContinuation?: boolean;
}
export interface HookExecutionOptions {
    /** Timeout in milliseconds (default 60000). */
    timeout?: number;
    env?: Record<string, string>;
    hookEvent?: HookEvent;
    callId?: string;
    shell?: 'bash' | 'powershell';
    asyncRewake?: boolean;
}
export interface PromptHookResult {
    ok: boolean;
    reason?: string;
    /** When ok=false, identifies an impossible stop condition. */
    impossible?: boolean;
    /** Infrastructure fallback, not evidence that a Goal is complete. */
    inconclusive?: 'configuration_error' | 'execution_error' | 'empty_response' | 'parse_error' | 'invalid_response';
}
//# sourceMappingURL=hook-types.d.ts.map