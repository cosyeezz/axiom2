import type { AgentInputItem, BackgroundTaskInfo, CronTaskInfo, FinalStopReason, HookEvent, HookExecutionOptions, HookExecutionResult, HookPermissionMode, NotificationType, SessionEndReason, SessionStartSource } from '../../../cbc-shared/node/index.js';
import type { InterceptorGate, Session } from '../session/session-protocol';
/**
 * Internal Hook Provider interface
 *
 * Use @Component(Hook) to register internal hooks that execute
 * alongside external shell hooks in HookManager.executeHooks().
 *
 * @example
 * ```typescript
 * @Component(Hook)
 * export class MyStopHook implements Hook {
 *     readonly event = HookEvent.STOP;
 *     readonly priority = HookPriority.Normal;
 *
 *     async execute(input: HookInput): Promise<HookExecutionResult | undefined> {
 *         // Return undefined to skip, or HookExecutionResult to participate
 *         return undefined;
 *     }
 * }
 * ```
 */
export declare const Hook: unique symbol;
/**
 * Data available only to in-process hooks.
 *
 * This context is never forwarded to command, HTTP, prompt, agent, or SDK hooks.
 * It can therefore carry process-local data that must not become part of the
 * serializable hook input contract.
 */
export interface InternalHookContext {
    /** Structured input items for the current user prompt. */
    inputItems?: readonly AgentInputItem[];
    /** Files declared by the tool invocation of a PostToolUse hook (`ToolResult.producedArtifacts`). */
    producedArtifacts?: ReadonlyArray<{
        /** Artifact URI or process-local path. */
        uri: string;
    }>;
    /**
     * Set by the hook executor: resolves with the aggregated `allowed` verdict of
     * every hook in this dispatch, internal ones included. A hook must not await
     * it inside `execute` (that would wait on itself); chain work onto it instead.
     */
    decision?: Promise<boolean>;
    /**
     * FinalStop only: the interceptor gate stamped on the run result that reached
     * FinalStop. Unlike `session.interceptorGate`, a later result cannot replace it.
     */
    interceptorGate?: InterceptorGate;
}
/** Associate local attachment paths with an input item without mutating serializable message data. */
export declare function setInternalInputAttachmentPaths(item: AgentInputItem, paths: readonly string[]): void;
/** Read process-local attachment paths associated with an input item. */
export declare function getInternalInputAttachmentPaths(item: unknown): readonly string[];
/** Carry attachment paths onto a clone or merge of input items; WeakMap entries do not survive copying. */
export declare function copyInternalInputAttachmentPaths(from: readonly unknown[], to: AgentInputItem): void;
/**
 * Optional in-process service that keeps a private copy of a local input
 * attachment the host deletes right after submission (TUI paste cleanup).
 * `data` is the file content the host already read, so the copy needs no second read.
 * Returns the copy's path, or undefined to keep the original path.
 */
export declare const InputAttachmentRetainer: unique symbol;
export interface InputAttachmentRetainer {
    retain(filePath: string, data?: Uint8Array): Promise<string | undefined>;
}
export interface InputAttachmentSource {
    path: string;
    /** Content the host already read from `path`, if any. */
    data?: Uint8Array;
}
/** Like {@link setInternalInputAttachmentPaths}, but lets a registered retainer copy the files first. */
export declare function retainInternalInputAttachmentPaths(item: AgentInputItem, attachments: readonly InputAttachmentSource[]): Promise<void>;
export interface Hook {
    /**
     * Hook event type this hook responds to
     */
    readonly event: HookEvent;
    /**
     * Priority for execution order (lower = earlier)
     */
    readonly priority: number;
    /**
     * Optional matcher pattern (regex) for filtering
     * - PreToolUse/PostToolUse: matches tool_name
     * - SessionStart: matches source
     * - SessionEnd: matches reason
     * - Other events: not used
     */
    readonly matcher?: string;
    /**
     * Execute the hook logic
     *
     * @param input - Serializable hook input data
     * @param context - Optional process-local data available only to internal hooks
     * @returns HookExecutionResult or undefined to skip
     */
    execute(input: HookInput, context?: InternalHookContext): Promise<HookExecutionResult | undefined>;
}
/**
 * Priority levels for internal hooks
 * Lower values execute first
 */
export declare enum HookPriority {
    /** Highest priority - runs first */
    Highest = 0,
    /** High priority */
    High = 100,
    /** Structured output processing */
    StructuredOutput = 200,
    /** Normal priority - default */
    Normal = 500,
    /** Low priority */
    Low = 800,
    /** Lowest priority - runs last */
    Lowest = 1000
}
export interface HookInput {
    /**
     * Session identifier
     */
    session_id?: string;
    /**
     * Session
     */
    session?: Session;
    /**
     * Path to the conversation transcript file
     */
    transcript_path: string;
    /**
     * Current working directory (optional for SessionStart)
     */
    cwd?: string;
    /**
     * The hook event name (e.g., "UserPromptSubmit", "PreToolUse")
     */
    hook_event_name: string;
    /**
     * Session start source (SessionStart only) OR settings file origin (ConfigChange only).
     * Claude Code compatible.
     */
    source?: SessionStartSource | 'user_settings' | 'project_settings' | 'local_settings' | 'policy_settings' | 'skills';
    /**
     * Session end reason (SessionEnd only)
     */
    reason?: SessionEndReason;
    /**
     * User prompt content.
     * - UserPromptSubmit: the submitted prompt text.
     * - UserPromptExpansion: Claude Code spec required field, always sent — the
     *   raw, pre-expansion text as typed by the user (e.g. "/deploy prod").
     */
    prompt?: string;
    /**
     * Name of the tool being executed (for tool-related events)
     */
    tool_name?: string;
    /**
     * Input arguments passed to the tool (for tool-related events)
     */
    tool_input?: Record<string, any>;
    /**
     * Tool execution response (for PostToolUse event)
     */
    tool_response?: any;
    /**
     * Whether stop hook is already active (Stop/SubagentStop only)
     * Prevents infinite loops when hook continues execution
     */
    stop_hook_active?: boolean;
    /**
     * 这一次回合结束是否落在「输出被截断后的续写恢复链」中途（Stop / FinalStop only，#119765）。
     *
     * 撞到输出上限后，产品会保留已写内容、追加一条续写提示重新请求模型，最多 3 次。每次
     * 恢复都是一个独立的 run，因此 Stop / FinalStop 会按恢复次数各打一次——但中间轮次
     * **不是回合结束**：回答还没写完。预算用尽那一轮同样标记为 true（计数不清零），也就是
     * 说它也被算作「链的一部分」，这是有意的：那一轮交付给用户的仍是残缺回答。
     *
     * 用途是让**外部 hook 脚本**识别并跳过中间轮次——尤其是非幂等的 hook（自动提交、发
     * 通知、触发流水线），在一条恢复链上被执行多次的后果不可控。内部消费方不依赖它（各自
     * 从 session 判定，避免漏填时静默失效）。
     */
    is_truncation_recovery?: boolean;
    /**
     * 这批输入是否为运行时注入的内部续跑，而非用户发来的提问（UserPromptSubmit only）。
     *
     * 判据见 {@link InputItemUtils.isInternalContinuationItem}：`isMeta` 与
     * `startsNewUserRequest === false` 同时成立，当前命中截断续写 / 网络重试 / 流超时 /
     * 模型降级的恢复消息，以及 runner-factory 的 `'Please continue.'`。
     *
     * 刻意按**本批 items** 判定而不是看会话状态：恢复链进行中用户完全可能自己发一条消息
     * （走队列中途注入），那条是真实提问，不该被当成机制注入而跳过。只有本批全部是内部
     * 续跑时才为 true。
     */
    is_internal_continuation?: boolean;
    /**
     * Final terminal reason (FinalStop only).
     */
    final_stop_reason?: FinalStopReason;
    /**
     * Trigger type, shared by compaction + setup events.
     * - PreCompact / PostCompact: 'manual' | 'auto'
     * - Setup: 'init' | 'maintenance'
     */
    trigger?: 'manual' | 'auto' | 'init' | 'maintenance';
    /**
     * Custom instructions for compaction (PreCompact only)
     * User-provided guidance passed to /compact command.
     * Null when no instructions are provided (Claude Code compatible).
     */
    custom_instructions?: string | null;
    /**
     * Notification message (Notification only)
     */
    message?: string;
    /**
     * Notification title (Notification only, Claude Code compatible)
     */
    title?: string;
    /**
     * Notification type (Notification only)
     * Used for matcher filtering in hook configuration
     */
    notification_type?: NotificationType;
    /**
     * Current generation ID (changes with each user turn).
     * Maps to session.conversationRequestId (session Request ID), aligned with IDE
     * hooks which use agent.requestId. It is omitted when the Request ID is unavailable;
     * messageId and traceId are not substitutes.
     */
    generation_id?: string;
    /**
     * Current model ID being used by the agent
     */
    model?: string;
    /**
     * Client type identifier (e.g., "CLI", IDE platform name)
     */
    client?: string;
    /**
     * Product version number (e.g., "2.52.4")
     */
    version?: string;
    /**
     * Worktree name (WorktreeCreate event)
     */
    name?: string;
    /**
     * Worktree path to remove (WorktreeRemove event)
     */
    worktree_path?: string;
    /**
     * Tool call ID (cbc internal, for PreToolUse/PostToolUse events)
     * Kept alongside `tool_use_id` for backward compatibility with existing
     * hook scripts and UI wiring.
     */
    call_id?: string;
    /**
     * Tool use ID (Claude Code official field for PreToolUse/PostToolUse events)
     * Same value as `call_id`, emitted for Claude Code compatibility.
     */
    tool_use_id?: string;
    /**
     * Current permission mode (Claude Code compatible)
     * Values: 'default' | 'acceptEdits' | 'dontAsk'
     * Injected by PermissionModeHookInputProcessor.
     */
    permission_mode?: HookPermissionMode;
    /**
     * Last assistant message text (Stop / SubagentStop events)
     * Optional plain-text summary of the last assistant turn.
     */
    last_assistant_message?: string;
    /**
     * Snapshot of background shell / agent tasks running in this session
     * (Stop / SubagentStop events; Claude Code parity).
     *
     * Injected by `StopHookSessionContextProcessor` from `ToolManager.getBackgroundTasks()`.
     * Filtered/projected to only fields that are useful for LLM evaluation —
     * raw `BackgroundTask` carries TruncateBuffer / kill function / abort
     * controllers that must NOT be serialized into ARGUMENTS JSON.
     */
    background_tasks?: BackgroundTaskInfo[];
    /**
     * Snapshot of cron jobs scheduled within this session
     * (Stop / SubagentStop events; Claude Code parity).
     *
     * Injected by `StopHookSessionContextProcessor` from
     * `CronStateManagerService.getSessionTasks(sessionId)`. cc parity field name.
     */
    session_crons?: CronTaskInfo[];
    /**
     * Current agent type / name (SessionStart / SubagentStop events)
     * Reflects session.agentName.
     */
    agent_type?: string;
    /**
     * Agent ID (SubagentStop event)
     * Identifies the subagent instance; sourced from session.storeId/id.
     */
    agent_id?: string;
    /**
     * Agent transcript path (SubagentStop event)
     * Path to the subagent's transcript file.
     */
    agent_transcript_path?: string;
    /**
     * Error message (PostToolUseFailure / StopFailure events)
     */
    error?: string;
    /**
     * 结构化工具错误码（PostToolUseFailure 事件）。纯数字字符串，值来自 ToolErrorCode 枚举。
     * 由 tool-hook-manager 在仍持有原始 ToolExecutionError 对象时提取并透传，
     * 因为 `error` 字段只承载消息字符串，下游 hook 无法还原 toolErrorCode。
     */
    tool_error_code?: string;
    /**
     * 结构化工具错误名（PostToolUseFailure 事件），如 'WriteFileError'。
     */
    tool_error_name?: string;
    /**
     * Extra error detail (StopFailure event)
     */
    error_details?: string;
    /**
     * Whether the tool failure was caused by a user interrupt (PostToolUseFailure)
     */
    is_interrupt?: boolean;
    /**
     * Compaction summary text (PostCompact event)
     */
    compact_summary?: string;
    /**
     * Instruction file path (InstructionsLoaded event) or settings file path (ConfigChange event)
     */
    file_path?: string;
    /**
     * Instruction memory type (InstructionsLoaded event)
     */
    memory_type?: 'User' | 'Project' | 'Local' | 'Managed';
    /**
     * Why the instructions were loaded (InstructionsLoaded event)
     */
    load_reason?: 'session_start' | 'nested_traversal' | 'path_glob_match' | 'include' | 'compact';
    /**
     * Glob patterns that matched to trigger the load (InstructionsLoaded event)
     */
    globs?: string[];
    /**
     * File that triggered the load (InstructionsLoaded event)
     */
    trigger_file_path?: string;
    /**
     * Parent instruction file that included this one (InstructionsLoaded event)
     */
    parent_file_path?: string;
    /**
     * Permission suggestions offered by cbc (PermissionRequest event).
     * Shape is provider-specific; typically an array of rule strings.
     */
    permission_suggestions?: unknown;
    /**
     * Task identifier (TaskCreated / TaskCompleted events)
     */
    task_id?: string;
    /**
     * Task subject/title (TaskCreated / TaskCompleted events)
     */
    task_subject?: string;
    /**
     * Task description (TaskCreated / TaskCompleted events)
     */
    task_description?: string;
    /**
     * Teammate name (TeammateIdle / TaskCreated / TaskCompleted events)
     */
    teammate_name?: string;
    /**
     * Team name (TeammateIdle / TaskCreated / TaskCompleted events)
     */
    team_name?: string;
    /**
     * MCP server name (Elicitation / ElicitationResult events)
     */
    mcp_server_name?: string;
    /**
     * Elicitation mode (Elicitation / ElicitationResult events)
     */
    mode?: 'form' | 'url';
    /**
     * Elicitation URL (Elicitation event, mode='url')
     */
    url?: string;
    /**
     * Elicitation identifier (Elicitation / ElicitationResult events)
     */
    elicitation_id?: string;
    /**
     * Schema describing the elicitation form (Elicitation event, mode='form')
     */
    requested_schema?: unknown;
    /**
     * Elicitation user action (ElicitationResult event)
     */
    action?: 'accept' | 'decline' | 'cancel';
    /**
     * Elicitation response content (ElicitationResult event)
     */
    content?: unknown;
    /**
     * Filesystem change kind (FileChanged event)
     */
    event?: 'change' | 'add' | 'unlink';
    /**
     * Previous working directory (CwdChanged event)
     */
    old_cwd?: string;
    /**
     * New working directory (CwdChanged event)
     */
    new_cwd?: string;
    /**
     * Additional context data (extensible for future events)
     */
    [key: string]: any;
}
export declare const CoreHookExecutor: unique symbol;
export interface CoreHookExecutor {
    executeHooks(event: HookEvent, input: HookInput, options?: HookExecutionOptions, internalContext?: InternalHookContext): Promise<HookExecutionResult>;
    hasHooks(event: HookEvent, toolName?: string): Promise<boolean>;
}
//# sourceMappingURL=hook-protocol.d.ts.map