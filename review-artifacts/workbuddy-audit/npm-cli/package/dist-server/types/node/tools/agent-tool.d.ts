import { type Session } from '../../vendor/cbc-core/node/index.js';
import { FunctionCallItem, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { type ICwdService, type IWorktreeChangeDetector, type IWorktreeService } from '@genie/cbc-worktree';
import { EventService, Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { ConsoleManager } from '../console';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
/** Override for the synchronous sub-agent wall-clock budget (positive integer ms). */
export declare const ENV_SUBAGENT_TIMEOUT_MS = "CODEBUDDY_SUBAGENT_TIMEOUT_MS";
export declare class AgentTool extends BaseTool implements Tool {
    protected readonly logger: Logger;
    protected readonly consoleManager: ConsoleManager;
    protected readonly eventService: EventService;
    protected readonly cwdService: ICwdService;
    protected readonly worktreeService: IWorktreeService;
    protected readonly worktreeChangeDetector: IWorktreeChangeDetector;
    private teamSpawnChain;
    /** 串行化团队 spawn；当前项失败返回调用方，但不污染后续队列。 */
    private enqueueTeamSpawn;
    name: ToolNames;
    isConcurrencySafe(): boolean;
    readonly promptCacheStability: "volatile";
    /**
     * Tool schema is a **method** (not a static object) so ToolManager.get()
     * re-evaluates it per invocation and reflects the current process env.
     * This is how we hide `run_in_background` from the model when
     * `CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS` is truthy (issue #63114 — in
     * request-response SDK / print-mode consumers, background agent results
     * cannot flow back into the lead's final answer, so the host disables the
     * whole capability instead of shipping half a feature).
     *
     * The runtime guard in `execute()` still ignores `run_in_background=true`
     * from stale/cached tool calls that bypass this schema.
     */
    parameters(): z.ZodTypeAny;
    private buildParametersSchema;
    argumentRenderer: ToolCallArgumentRenderer;
    needsApproval: boolean;
    /**
     * Auto mode classifier projection: `(${subagent_type}, mode=${mode}): ${prompt}`
     * (Claude alignment, decision D1). The sub-agent prompt is projected so a
     * delegated dangerous action is visible to the classifier (delegation-bypass
     * defense). NOTE: CodeBuddy's Agent tool has `needsApproval = false`, so the
     * current action never reaches the classifier directly — this projection is
     * consumed when an Agent call appears in the history transcript.
     */
    toAutoClassifierInput(input: unknown): string;
    execute(input: any, context?: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult>;
    protected spawn(input: any, context?: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult>;
    /**
     * 将 Agent 工具执行异常映射到 19920 段细分错误码。
     */
    private classifyAgentError;
    /**
     * Classify an error thrown out of `task.execute()` on a synchronous sub-agent.
     *
     * Timeout is matched by error type; the abort/interruption flags stay
     * substring-based for the pre-existing abort sentinels.
     */
    private static classifySubagentFailure;
    /**
     * Tool result handed back to the parent agent when a synchronous sub-agent
     * spent its wall-clock budget, so the parent can adapt instead of hanging.
     *
     * Carries the same durable sub-agent link (`ToolResult.subAgent`) as the
     * interrupted branch below: the failed run already exposed it through
     * `task.getResult()`, and dropping it would leave the timed-out call with no
     * child-transcript link, no lifecycle descriptor and no session id.
     */
    private static buildTimeoutResult;
    /**
     * Wall-clock budget that actually fired, in seconds; `undefined` when it
     * cannot be recovered.
     *
     * Prefers the value carried on the `SubagentWallClockTimeoutError` so the
     * message can never disagree with the budget that was armed; falls back to a
     * live env read for dual-dist builds where the error arrived from a second
     * copy of the module and only its `name` matched.
     *
     * Rounded to a whole second but never below 1: a sub-second budget (e.g.
     * `CODEBUDDY_SUBAGENT_TIMEOUT_MS=400`) would otherwise read "timed out after 0s".
     */
    private static timeoutSecondsOf;
    /**
     * Resolve the wall-clock budget for synchronous sub-agents from
     * `CODEBUDDY_SUBAGENT_TIMEOUT_MS` — same family as the other sub-agent
     * guardrails (`CODEBUDDY_CODE_SUBAGENT_MAX_TURNS` et al.): operator-set env,
     * live-read from `process.env` (prewarm contract).
     *
     * **Opt-in**: unset, empty, unusable (non-numeric / non-positive) or above
     * {@link MAX_SUBAGENT_TIMEOUT_MS} → no watchdog, i.e. the previous
     * wait-forever behaviour, so unrelated scenarios are unaffected. The upper
     * bound is load-bearing: Node clamps an oversized `setTimeout` delay to 1 ms,
     * which would abort the sub-agent instantly instead of never timing out.
     */
    private static resolveSubagentTimeoutMs;
    /**
     * Generate an auto-name for a background agent: "{agentType}-{seq}"
     * e.g. "explore-1", "explore-2", "plan-1"
     */
    private generateBackgroundAgentName;
    /**
     * Resolve a member name that is unique within `teamName` (checked against
     * the in-memory TeamMemberRegistry). If `desired` already exists, append a
     * short random hex suffix and retry — aligns with TeamCreate's "rename on
     * conflict" idempotency strategy and prevents a leftover/stale teammate
     * (e.g. a `critic` from a finished team) from blocking new background
     * agent spawns with misleading "already active" errors.
     */
    private resolveUniqueMemberName;
    /**
     * Ensure the lead is in a team before spawning a named/background member.
     * Named Agent() from Code Mode must not require a prior TeamCreate.
     */
    private ensureTeamForSpawn;
    /**
     * Spawn a background agent as a team member in an auto-created team.
     *
     * This replaces the old "implicit team" approach. Instead of ad-hoc
     * TeamMember + setAgentTask() + ensureInboxPolling(), we:
     * 1. Auto-create a team via TeamManager (if not already in one)
     * 2. Spawn the agent using TeamMember.spawn() for full lifecycle support
     * 3. Register with TeamManager for persistence to config.json
     */
    private spawnBackgroundAgent;
    /**
     * Spawn a teammate in the current active team.
     * Teammates always run in detached + background mode.
     * If the lead is not in a team yet, auto-create one (same as background Agent).
     */
    private spawnTeammate;
    /**
     * Cleanup agent worktree after task completion.
     * - No changes: auto-delete worktree, return removal message
     * - Has changes: preserve worktree, return info message
     *
     * Message format aligned with Claude Code:
     * - No changes: "Worktree removed (no changes)"
     * - Has changes: "Worktree preserved at ${path} on branch: ${branch}"
     */
    private cleanupAgentWorktree;
    /**
     * Spawn a Fork subagent that inherits the parent agent's full context.
     * Reuses spawnBackgroundAgent() with agentType='fork', which is recognized
     * by AgentTask.setupPhase() to inherit the default agent definition.
     */
    private spawnForkAgent;
    private backgroundSubAgentMeta;
    /**
     * Execute a Fork subagent synchronously (blocking).
     * Same as standard sync sub-agent but uses AgentNames.FORK so that
     * AgentTask.setupPhase() inherits the default agent definition and
     * setupSubAgentSession() injects parent conversation history.
     */
    private executeSyncForkAgent;
    /**
     * Build the fork child's prompt by prepending behavioral rules.
     * The <fork-boilerplate> tag serves dual purpose:
     * 1. Behavioral instructions for the fork child
     * 2. Marker for isInForkChild() recursive fork prevention
     */
    private buildForkChildPrompt;
    /**
     * Check if the current execution context is inside a Fork child.
     * Two-layer defense:
     * 1. Session meta: check if agentName === 'fork'
     * 2. Message scan: check for <fork-boilerplate> tag in session history
     */
    private isInForkChild;
    private getAgentManager;
    /**
     * Enforces `CODEBUDDY_DISABLE_BUILTIN_SUBAGENTS` (issue #99451) for a
     * built-in-disableable `subagent_type`. Throws unless a custom OR plugin
     * agent overrides it (matching tool-manager.ts's exposure-layer check —
     * see that file's `CUSTOM_AGENT_TAG || PLUGIN_AGENT_TAG` filter).
     *
     * Deliberately reads tags via `AgentManager.getAgentConfig()` rather than
     * `CustomAgentManager.get()`: the latter's `loadCustomAgents()` filters
     * out anything tagged `PLUGIN_AGENT_TAG`, so a plugin-provided override
     * would be misreported as absent here — a "shown in the tool catalog but
     * blocked at runtime" bug that existed in the original CustomAgentManager
     * -based check.
     */
    private assertBuiltinSubagentOverrideAllowed;
    /**
     * 上报插件 subagent 能力调用埋点。
     * Agent 的 tags 格式为 [CLI_AGENT_TAG, CUSTOM_AGENT_TAG, PLUGIN_TAG, source]，
     * 其中 source 形如 "pluginName@marketplaceName"。
     * 仅在 WorkBuddy Desktop 宿主下上报。
     */
    private reportPluginAgentCall;
    /**
     * Build the optional `subAgent` slice on the returned ToolResult — present
     * when AgentTask recorded a stable child session identity. `lastId` remains
     * optional because an empty run still has observable lifecycle state even
     * though it contributes no nested transcript items. Spread
     * `...AgentTool.subAgentMetaOf(executionResult)` at the call site.
     */
    private static subAgentMetaOf;
}
