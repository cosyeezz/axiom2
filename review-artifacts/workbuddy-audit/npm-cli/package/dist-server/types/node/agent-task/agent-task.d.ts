import { AgentManager, Session, SessionManager, SessionRunStateMachine } from '../../vendor/cbc-core/node/index.js';
import { ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import { Subscription } from 'rxjs';
import { CustomCommandRenderer } from '../command';
import { ConsoleManager } from '../console';
import { ScopedHookRegistry } from '../hooks/hook-protocol';
import { AgentScopedMcpManager } from '../mcp/mcp-protocol';
import { SettingsManager } from '../settings';
import { AgentTask, AgentTaskExecutionConfig, AgentTaskExecutionResult, type AgentTaskInvocationIdentity, AgentTaskOutputFileManager, ToolCallRecord } from './agent-task-protocol';
export declare function restoreResumedSubAgentMeta(session: Session, options: {
    mainSession: Session;
    taskId: string;
    taskName: string;
    agentName?: string;
    teamContext?: AgentTaskExecutionConfig['teamContext'];
}): void;
export declare function bindSubagentInvocationIdentity(session: Session, mainSession: Session, identity?: AgentTaskInvocationIdentity): AgentTaskInvocationIdentity;
/**
 * Claude calls this provenance `flagSettings`: only definitions supplied explicitly
 * by --agents / SDK initialize / the served query's `agents` may contribute inline
 * MCP while --strict-mcp-config is active.
 */
export declare function isFlagSettingsAgentDefinition(tags: readonly string[] | undefined): boolean;
/**
 * AgentTask class - unified agent task execution engine
 * Encapsulates all agent task execution logic (both sync and async)
 * Implements AgentTask interface for lifecycle management
 */
export declare class AgentTaskImpl implements AgentTask {
    /**
     * How long to wait for an interceptor-announced retry run to actually start
     * before giving up and delivering the output we already have (#85908).
     *
     * This bounds STARTUP only — once the run is observed, we wait for it without
     * any time limit, so long-running sub-agent turns are never cut short. The
     * window exists purely so that an announced-but-never-started retry degrades
     * to the pre-fix behaviour instead of hanging the parent's Agent tool.
     */
    private static readonly RETRY_START_GRACE_MS;
    readonly id: string;
    readonly startTime: number;
    endTime?: number;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'killed';
    abortController: AbortController;
    title: string;
    description?: string;
    prompt?: string;
    agentType?: string;
    agentIsolation?: 'worktree';
    memberName?: string;
    isTeamMember?: boolean;
    isBackground?: boolean;
    isWorkflowTask?: boolean;
    retainInAgentTree?: boolean;
    teamContext?: {
        teamName: string;
        memberName: string;
        teamMembers: string[];
        color?: string;
    };
    response?: string;
    result?: string;
    error?: string;
    sessionResultSubscription?: Subscription;
    toolCallHistory: ToolCallRecord[];
    tokenUsage?: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        lastContextWindow?: number;
    };
    sessionId?: string;
    mainSessionId?: string;
    kill(): Promise<void>;
    cancel(): Promise<void>;
    /**
     * Stop this task's own session. A member ending must not abort the lead
     * session, even if the two controllers were ever aliased.
     */
    private abortOwnedSubSession;
    private config;
    private mainSession;
    private subAgentSession;
    private agent;
    /** setupPhase 解析出的 run 名（含 fork 语义）；setupSubAgentSession 复用，避免二次解析漂移。 */
    private resolvedRunAgentName?;
    private executionResult?;
    private invocationIdentity?;
    private subagentStatusPublication?;
    private subagentStartPublication?;
    private subagentStartedPublished;
    private pendingSubagentTerminalStatus?;
    private subagentInvocationAfterId?;
    private isDetached;
    private subagentStopHookFired;
    private cleanupFinished;
    private executionPromise?;
    private subAgentSessionReleaseRequested;
    private subAgentRuntimeReleased;
    private executionSlot?;
    protected readonly productManager: ProductManager;
    protected readonly consoleManager: ConsoleManager;
    protected readonly taskOutputManager?: AgentTaskOutputFileManager;
    protected readonly logger: Logger;
    protected readonly settingsManager: SettingsManager;
    protected readonly scopedHookRegistry: ScopedHookRegistry;
    protected readonly agentScopedMcpManager: AgentScopedMcpManager;
    protected readonly customCommandRenderer: CustomCommandRenderer;
    protected readonly stateMachine: SessionRunStateMachine;
    private subscriptions;
    private mainAbortListener?;
    private mainAbortSignal?;
    private agentEndListener?;
    private hasFixedPermissionMode;
    private eventEmitter;
    /** Resolved while the spawn tool call is still executing; bound only to a session created here. */
    private harnessSpawnedBy?;
    constructor();
    /**
     * Initialize agent task with configuration
     */
    init(config: AgentTaskExecutionConfig): void;
    reserveExecutionSlot(): void;
    getExecutionConfig(): AgentTaskExecutionConfig | undefined;
    releaseExecutionSlot(): void;
    /**
     * Main execute method - unified agent task execution flow with network retry support
     */
    execute(): Promise<AgentTaskExecutionResult>;
    whenSettled(): Promise<void>;
    private executeTask;
    /**
     * Fork child composition: session mainKey → settings default → product default.
     * Does not follow `session.agentName` / `@agent` telemetry, so a temporary
     * mention switch cannot leak into the child's standing tools.
     * 也不吃 lastUsed：空白父会话未盖章时 fork 必须跟父身份 / 设为默认，不能变成 chip 记忆。
     */
    private resolveForkParentAgent;
    /**
     * 跟随 leader 站立模式时，给模式 agent 视图叠加子代理自身的角色指令。
     *
     * 模式 agent（ptc / minimal / create 等）的 instructions 是主会话 system prompt，只负责
     * 工具面与 Code Mode 契约；子代理预设（`--agents` 自定义、内置 Explore 等）的 instructions
     * 才定义「你是谁、做什么、返回什么」。两者都要：模式在前，角色在后。
     *
     * 预设以主会话模板（`cli-agent-prompt`，如 general-purpose）为 instructions 时，它渲染出来的是
     * 一整份 Standard 主提示，模式提示已覆盖这部分；再拼一份会让每次请求重复约 6k token，且
     * 与 Code Mode 契约互相矛盾。此时只追加该预设的 appendInstructions 作为角色。
     *
     * 子代理就是模式自身（如 subagent_type === 'ptc'）或预设不可解析时，原样返回。
     * 用 `Object.create(base)` 只覆盖 instructions，tools / model 等沿原型链共享，
     * 与 sandboxScopedAgentView 的视图语义一致（不登记 managed、不写回 agentMap）。
     */
    private withSubagentRoleInstructions;
    /**
     * Phase 1: One-time setup - session, subscriptions, etc.
     * This only runs once, not repeated during retries
     */
    private setupPhase;
    /**
     * 应用 agent 级 reasoning 覆盖：
     *   - `thinkingEnabled: false` → 该 sub agent 运行时强制关闭 thinking（对齐 Claude thinkingEnabled）；
     *   - `effort: <level>`        → 该 sub agent 使用指定 reasoning 强度（对齐 Claude subagent effort）。
     *
     * 复用 `SessionManager.setOverrideThinking`（session 级、内存、不持久化），
     * 由 `ModelConfigAgentRunInterceptor` 在真实请求时消费，优先级最高。
     * 不改 interceptor / model-provider，不影响主 agent。
     *
     * 作用域：
     *   - `effort`：对所有 sub agent（含 custom / plugin）生效，对齐 Claude subagent effort；
     *   - `thinkingEnabled: false`：仅对内置 sub agent 生效——custom / plugin agent（带
     *     CUSTOM_AGENT_TAG）被排除，避免外部来源绕过模型 `onlyReasoning` 的产品语义
     *     （与 admin-trusted 判定同思路）。
     *
     * 关闭与 effort 互斥，关闭优先。非法 effort 值静默忽略（继承默认，不报错）。
     */
    private applyAgentReasoningOverride;
    /**
     * 将 agent frontmatter `skills:` 列出的 skill 完整内容作为 isMeta user message
     * 预加载到 subAgentSession.history，让 subagent 启动前模型就能看到这些 skill 的内容。
     *
     * 对齐 Claude Code `runAgent.ts:577-646` 的 initialMessages preload 语义。
     * 和 tool description 里"给模型看的 skill 列表过滤"是两个独立维度——preload 提供内容，
     * 过滤列表只影响模型能感知到哪些 skill 可用，二者共存。
     *
     * Name 解析策略（三档 fallback，对齐 CC resolveSkillName）：
     *   1. exact match on skill.name
     *   2. 如果 agent 来自插件且 frontmatter 写裸名，尝试 `${pluginName}:${name}`
     *   3. 后缀匹配 skill.name.endsWith(`:${name}`)（多个命中取第一个并 warn）
     *
     * 失败处理：warn + skip。非 prompt-based skill 也 skip（当前 cbc 所有 skill 都是
     * prompt-based，这里留预留判断与 CC 对齐）。
     */
    private preloadFrontmatterSkills;
    /**
     * Build an isMeta + skipRun user-message history item for preloaded
     * subagent context. isMeta hides it from SDK resume replay / user view;
     * skipRun keeps it as pass-through context that never triggers a model
     * run. See preloadFrontmatterSkills for the 内存 == jsonl invariant that
     * requires these to be written via sessionManager.addHistory.
     */
    private buildPreloadItem;
    /**
     * Build the failure reminder item (model needs to see that a *requested*
     * skill is NOT in its context — otherwise the "agent has skills
     * configured but doesn't know them" phantom bug).
     */
    private buildPreloadFailureItem;
    /**
     * 3 档 fallback 解析 skill 名称（对齐 CC runAgent.ts:resolveSkillName）。
     * 返回命中的 Skill 实例，未命中返回 undefined。
     */
    private resolveSkillNameForPreload;
    /**
     * Phase 2: Execution phase with network retry logic
     * This can be retried multiple times on network errors
     */
    private executePhaseWithRetry;
    /**
     * Shared completion finalization: scan the report for instruction-shaped
     * patterns, persist it, build the execution result and mark the task
     * completed. Used by both the normal path and the maxTurns partial-output
     * path (Claude Code parity — reaching maxTurns is a normal stop).
     */
    private finalizeCompletedResult;
    /**
     * Agent ID trailer appended to every subagent report. The `[Agent ID: <id>]`
     * token is emitted for ALL agent types — including the one-shot Explore / Plan
     * built-ins — so downstream consumers that parse it (audit / linking) keep
     * working. This matches the pre-parity output and is honest, since resume
     * actually succeeds for these sessions too; the earlier Explore/Plan omission
     * silently broke `[Agent ID: ...]` extraction for those two types.
     */
    private agentIdTrailer;
    /** Last assistant text the subagent produced (partial output for the maxTurns path). */
    private extractLastAssistantText;
    /**
     * Get the execution result
     */
    getResult(): AgentTaskExecutionResult | undefined;
    getMainSession(): Session;
    getSubAgentSession(): Session | undefined;
    private rebindIdleQueueDrain;
    releaseSubAgentSession(): void;
    private releaseSubAgentRuntime;
    /** Parent Agent tool call that created this member. Absent for a task with no tool card. */
    getParentToolCallId(): string | undefined;
    getInvocationIdentity(): AgentTaskInvocationIdentity;
    private getSubagentId;
    private buildSubagentDescriptor;
    private buildSubagentSnapshot;
    private emitSubagentStatus;
    private queueSubagentStatusPublication;
    private publishSubagentStatus;
    /**
     * Setup sub-agent session
     */
    /**
     * general-purpose 预设跟随 leader 模式（如 ptc）运行时，模型请求按运行 agent 名过滤
     * `providerData.agent === 'general-purpose'` 的历史，会把子代理自己的提示词也滤掉，
     * 请求只剩 system 消息。TUI 已在上方单独放行；ACP / print 同样需要保留。
     */
    private runsGeneralPurposePresetUnderLeaderMode;
    private setupSubAgentSession;
    /**
     * Inherit the main session's context-window override into a sub-agent session (#133811).
     *
     * Copies only the explicit parent override, if any — letting the child fall
     * back to its own model's default when the parent has none. We deliberately do
     * NOT copy the parent's *computed* effective budget: that value may have been
     * clamped to the parent's model, and blindly reusing it would misrepresent the
     * user's actual intent when the subagent runs a different model.
     * `resolveSessionContextBudget` (cbc-core) re-validates whatever we set here
     * against the child model's `supportedLengths` and fails closed if incompatible,
     * so an inherited value that doesn't fit the child model is harmless.
     *
     * Passing `null` when the parent has no override also clears any stale value
     * left over on a reused/resumed child session id. Nested subagents inherit
     * transitively because each level re-reads its own immediate parent's override.
     *
     * Both sessionManager calls are guarded with a `typeof` check: some sub-agent
     * / test-double SessionManager stands-ins only implement the members they
     * personally exercise (see agent-task-resume-model.spec.ts), and this
     * inheritance step must stay a no-op rather than throw when either method
     * is absent — mirroring the same defensive pattern `resolveSessionContextBudget`
     * (context-protocol.ts) already uses for `getOverrideContextWindow`.
     */
    private inheritParentContextWindow;
    /**
     * Build the sub-agent session's `options` / `requestOptions`.
     *
     * Shared by the fresh-create and the resume paths so a resumed sub-agent
     * runs on exactly the same model as its first turn (issue #95409).
     * `options` / `requestOptions` are runtime-only — `SessionFactory` rebuilds
     * them as `{}` for any session deserialized from disk — so the resume path
     * MUST recompute them instead of trusting whatever came back from the store.
     */
    private buildSubAgentSessionOptions;
    /**
     * Resolve agent model
     * 支持三种输入：
     * 1. "default" / "inherit" - 继承父模型，返回 undefined
     * 2. 场景类型（如 "lite", "reasoning"），根据主模型动态解析
     * 3. 模型 ID（如 "gpt-5.1-codex"），直接查找
     *
     * 优先级: 环境变量 CODEBUDDY_CODE_SUBAGENT_MODEL > 参数指定的模型
     */
    private resolveAgentModel;
    private isInheritedModel;
    private resolveConfiguredSubagentModel;
    /**
     * Configure permission mode
     */
    private configurePermissionMode;
    /**
     * Stamp `subAgentPlanModeLocked` on the sub-session meta when the
     * sub-agent is being EXPLICITLY locked into plan mode (Priority 1 / 2 in
     * configurePermissionMode). The agent-manager visibility gate reads this
     * marker to decide whether `ExitPlanMode` should be advertised to the
     * LLM — sub-agents that merely INHERIT plan mode from the main session
     * (Priority 4) must not own a plan, otherwise their ExitPlanMode call
     * surfaces an approval popup whose semantics belong to the parent.
     *
     * No-op when the resolved mode is anything other than Plan.
     */
    private markPlanModeLockedIfPlan;
    /**
     * Setup session subscriptions - forward data to main session
     * In detached mode, skip forwarding intermediate messages and state updates
     */
    private setupSessionSubscriptions;
    /**
     * Execute agent with optional custom prompt
     * @param prompt Optional custom prompt, defaults to this.config.prompt
     */
    private executeAgent;
    private executeSubagentStopHookOnce;
    /**
     * Wait for agent completion and get result
     */
    private waitForAgentCompletion;
    /**
     * Decide whether a finalOutput may be delivered to the parent, or whether a
     * retry started by a ModelResponseInterceptor owns this sub-session (#85908).
     *
     * @returns `true` to deliver (settle), `false` to defer to the retry.
     */
    private shouldDeliverDespiteRetry;
    /**
     * Bounded wait for the announced retry run to leave `idle`.
     *
     * Resolves `true` as soon as the sub-session becomes busy, `false` if nothing
     * started within {@link AgentTaskImpl.RETRY_START_GRACE_MS}. Returns early on
     * abort so a cancel is never delayed by the grace window.
     */
    private waitForRetryRunToStart;
    /**
     * Capture tool call for output
     */
    private captureToolCall;
    /**
     * Capture final output to file
     */
    private captureFinalOutput;
    /**
     * Update task status and emit status change event
     */
    private updateStatus;
    /**
     * Issue 5 · record a sanitized failure summary on the TeamMemberRegistry
     * entry for this teammate, so the team-lead's next system prompt can
     * include `<teammate-failures>` and the Desktop UI can show the reason
     * in a tooltip. No-op for non-teammates (sync sub-agents, background
     * tasks, auto-team implicit members).
     *
     * Registry lookups / mutations are best-effort: any throw is swallowed
     * and logged at warn level so a failing registry can never prevent the
     * underlying task from propagating its error upstream.
     */
    private recordTeammateFailure;
    /**
     * Subscribe to status change events
     */
    onStatusChange(listener: (event: {
        task: AgentTask;
        oldStatus: string;
        newStatus: string;
    }) => void): void;
    /**
     * Unsubscribe from status change events
     */
    offStatusChange(listener: (event: {
        task: AgentTask;
        oldStatus: string;
        newStatus: string;
    }) => void): void;
    /**
     * Subscribe to progress events (fired once per captured tool_use).
     * Used by the Agent-tool → backgroundTaskSubject bridge to emit stream-json
     * `task_progress` events with cumulative usage for background sub-agents.
     */
    onProgress(listener: (event: {
        task: AgentTask;
    }) => void): void;
    /**
     * Unsubscribe from progress events.
     */
    offProgress(listener: (event: {
        task: AgentTask;
    }) => void): void;
    /**
     * Register frontmatter hooks declared on the subagent definition and/or
     * task config. Scope-scoped to the subagent session; auto-cleaned in
     * cleanup().
     *
     * Two sources (both optional, each gated independently; surviving
     * configs are registered under the same scope):
     * 1. agent.hooks — from `.codebuddy/agents/*.md` frontmatter. Trust
     *    evaluated here via `isAgentAdminTrusted(agentConfig)`.
     * 2. config.additionalHooks — passed in by caller (e.g. skill-tool fork
     *    path carries SKILL.md frontmatter hooks here). Trust is declared by
     *    the caller via `config.additionalHooksAdminTrusted`; we cannot
     *    infer it from `subagent_type` since skill forks often reuse a
     *    trusted built-in agent like `general-purpose`.
     *
     * Admin-trusted gate: source survives if either the source itself is
     * admin-trusted, OR `settings.allowUntrustedFrontmatterHooks=true`.
     * Aligns with CC `runAgent.ts:566` `isSourceAdminTrusted` semantics.
     */
    private registerFrontmatterHooks;
    /**
     * Cleanup resources
     */
    private cleanup;
    /**
     * Parse permission mode string to enum
     */
    private parsePermissionMode;
    get agentManager(): AgentManager;
    get sessionManager(): SessionManager;
}
