import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { AgentInputItem, RunContext, ToolExecuteArgument } from '../../vendor/cbc-shared/node/index.js';
import { ToolArg, ToolPermissionType } from '../../vendor/cbc-shared/node/index.js';
import type { Agent } from '@openai/agents';
import { type SensitiveToolEgressProjection } from './tool-protocol';
export declare abstract class BaseTool {
    abstract name: string;
    description: string;
    strict: boolean;
    aliases: string[] | undefined;
    /**
     * Other tools whose deny/ask rules also constrain this tool (e.g. ViewImage
     * inherits Read's path restrictions). Restrictions are one-way: these names
     * never grant allow, never match allow rules, and do not affect registration
     * or tool exposure.
     */
    readonly permissionRestrictionNames: readonly string[];
    isEnabled: boolean | ((args: {
        runContext: RunContext<Session>;
        agent: Agent;
    }) => boolean | Promise<boolean>);
    shouldShowInToolSearch?(): boolean;
    needsApproval: boolean | ((runContext: RunContext<Session>, input: any, callId?: string) => Promise<boolean>);
    errorFunction(context: RunContext, error: Error | unknown): Promise<string>;
    resolveNeedPermissionArgs(runContext: RunContext, input: ToolExecuteArgument<any>, callId?: string): ToolArg[];
    /**
     * Project this tool's input into the minimal, security-relevant text the auto
     * mode classifier needs to judge the action. Aligned with Claude Code's
     * per-tool `toAutoClassifierInput`.
     *
     * Contract (do NOT change without re-reading `tools/auto-mode/`):
     *  - Return `''` (the default) when the tool exposes nothing the classifier
     *    needs. Such tools are dropped from the classifier transcript, and — when
     *    the action being classified is one of them — auto mode allows it without
     *    calling the model (the "no classifier-relevant input" short-circuit).
     *  - Override in tools whose input carries risk (Bash command, Write content,
     *    Agent prompt, …). Project only the security-relevant field(s), never the
     *    whole input blob and never tool output.
     *  - `input` is the parsed tool input object (same shape `execute` receives).
     *    It may be malformed when reconstructed from history; guard accordingly
     *    and never throw — return `''` on anything unexpected.
     */
    toAutoClassifierInput(input: unknown): string;
    /**
     * Whether this call may run alongside sibling calls of the same model turn.
     * Defaults to false (run in model order); read-only tools opt in. `input` is
     * the parsed tool input and may be malformed — never throw.
     */
    isConcurrencySafe(_input: unknown): boolean | Promise<boolean>;
    resolveSensitiveEgress(_input: unknown, _context: RunContext<Session>): SensitiveToolEgressProjection | undefined | Promise<SensitiveToolEgressProjection | undefined>;
    resolveToolType(toolNames: string[]): ToolPermissionType;
    resolveRejectedResult(_rawItem: AgentInputItem): Promise<AgentInputItem[]>;
    /**
     * Default thrown-error classifier: tools that need tool-specific error codes
     * should override this. Returning undefined lets ToolHookManager fall back to
     * generic cross-tool classification.
     */
    resolveThrownErrorCode(error: unknown): string | undefined;
    /**
     * Check if background execution should be blocked for this session.
     *
     * Only *pure single-shot print* mode (e.g. `-p`) blocks background execution,
     * because that path (CliExecutor.executeSingleRequest) calls process.exit(0)
     * immediately after the main agent completes, which would kill any running
     * background tasks.
     *
     * Modes that keep the process alive allow background execution:
     * - stdio stream-json (inputFormat === 'stream-json'): routed to
     *   CliExecutor.executeStreamMode, which stays alive while stdin is open —
     *   the SDK/caller controls the lifecycle, same as Claude Code. Background
     *   tasks keep running and their completion notifications are injected into
     *   the session for the model to read via BashOutput. Note that the CLI
     *   always sends `print: true` on the wire even for stdio stream-json, so
     *   `print` alone cannot distinguish the two — `inputFormat` is the reliable
     *   signal (it mirrors the executeStreamMode vs executeSingleRequest split).
     * - HEADLESS build: only indicates missing TUI modules; background task
     *   infrastructure (AgentTaskManager, TeamMailbox) has no TUI dependency
     */
    protected isBackgroundExecutionBlocked(session: Session | undefined): boolean;
}
