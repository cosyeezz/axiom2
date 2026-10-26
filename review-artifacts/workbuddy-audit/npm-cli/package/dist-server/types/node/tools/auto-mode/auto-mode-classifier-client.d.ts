import { AgentManager, AgentService } from '../../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { BaseTool } from '../base-tool';
import { AutoModeRules } from './auto-mode-protocol';
import { AutoModeSystemPromptBuilder } from './auto-mode-system-prompt-builder';
import { AutoModeTranscriptLimit } from './auto-mode-transcript-limit';
export declare const AutoModeClassifierClient: unique symbol;
/**
 * Raw classifier verdict, aligned with Claude Code 2.1.179.
 *
 * The classifier model emits a BINARY decision via `<block>yes/no</block>`:
 *  - `<block>no</block>`  → allow
 *  - `<block>yes</block><reason>…</reason>` → block
 * There is no `ask` verdict — "requires confirmation" is a host-side fallback
 * when the classifier is unavailable / fails, not a model output.
 *
 * `noClassifierRelevantInput` short-circuits BEFORE any model call: when the
 * action's own projection is empty (Claude "Tool declares no classifier-relevant
 * input"), auto mode allows it with zero LLM cost.
 */
export interface ClassifierVerdict {
    decision: 'allow' | 'block';
    reason: string;
    /** True when allowed purely because the action had no classifier-relevant input (no model call). */
    noClassifierRelevantInput?: boolean;
    /**
     * The action's projection (Claude `toAutoClassifierInput`) — the dedup key
     * for denial tracking (decision D3-A #2). Empty for the no-input short-circuit.
     */
    inputKey: string;
}
export interface ClassifyInput {
    signal?: AbortSignal;
    toolName: string;
    toolInput: unknown;
    rules: AutoModeRules;
    /** Conversation history (AgentInputItem[]); action is appended as the last entry. */
    transcript?: unknown[];
    /** User `permissions.deny` rules injected into the system prompt. */
    settingsDenyRules?: string[];
    /**
     * Optional CODEBUDDY.md / rule-layer text injected as a separate user
     * context message (Claude CLAUDE.md injection, decision D2). Treated as
     * context about user intent, never as blanket authorization.
     */
    projectInstructions?: string;
    /** Session id — used only to name the error-dump file on classifier failure. */
    sessionId?: string;
}
/** Thrown when a classifier STAGE 1 call fails before Stage 2 runs (Claude: block "for safety"). */
export declare class ClassifierUnavailableError extends Error {
    readonly cause?: unknown | undefined;
    constructor(message: string, cause?: unknown | undefined);
}
/**
 * Thrown when the classifier model was reachable and answered, but its response
 * is unusable — e.g. a reasoning-only model (gpt-5.5 via the Responses API) spent
 * the whole small output budget on hidden thinking, leaving an empty visible
 * answer, so the Agents SDK threw while reading an empty content array.
 *
 * Distinct from ClassifierUnavailableError (a genuine transport/model outage):
 * the model is up, it's just a poor fit for the tiny classifier budget. The host
 * still blocks the action fail-closed (Claude `parse_failure` → `shouldBlock`),
 * but with "no verdict" wording that points at the classifier model instead of
 * claiming a transient outage, and it must NOT trip the failure circuit breaker.
 */
export declare class ClassifierResponseUnusableError extends Error {
    readonly cause?: unknown | undefined;
    constructor(message: string, cause?: unknown | undefined);
}
/**
 * Heuristic: does a Stage-1 error look like "the model answered but the response
 * was empty / unparseable" rather than a transport/model outage?
 *
 * Two known shapes, both meaning "the model is up, its visible answer is empty":
 *  - The Agents SDK reads `content[last].type` on the assistant message; an empty
 *    content array (no visible text — the reasoning-only case above) makes
 *    `content[last]` undefined and throws `TypeError: Cannot read properties of
 *    undefined (reading 'type')`.
 *  - A reasoning model that spends the whole output budget on hidden thinking
 *    produces a turn with no visible answer, so the run ends without a final
 *    output and the SDK throws `MaxTurnsExceededError` (`maxTurns` is 1 here).
 *    The shared guard handles minified classes and retains a name fallback for
 *    a second SDK copy (dual-dist), as in session-manager.
 */
export declare function isClassifierResponseUnusable(err: unknown): boolean;
/**
 * Thrown when STAGE 2 errors after Stage 1 already ran (both-mode, Stage 1 did
 * not return `<block>no`). Claude blocks based on the Stage 1 assessment rather
 * than failing open — the reason names this so it is auditable. Distinct from
 * ClassifierUnavailableError so the host can use the Stage-1-based reason.
 */
export declare class ClassifierStage2Error extends Error {
    readonly cause?: unknown | undefined;
    constructor(message: string, cause?: unknown | undefined);
}
/**
 * Thrown when the serialized transcript exceeds the classifier model's context
 * window (Claude `transcript_too_long`). Distinct from ClassifierUnavailableError
 * because the host handles it differently (prompt fallback interactive, abort
 * headless) and it must NOT trip the failure circuit breaker.
 */
export declare class TranscriptTooLongError extends Error {
    readonly actualTokens: number;
    readonly limitTokens: number;
    constructor(actualTokens: number, limitTokens: number);
}
/**
 * Invokes the lite model for risk classification, using the real Claude Code
 * two-stage `<block>` mechanism.
 *
 *  - Stage 1 (fast): system prompt + transcript + STAGE1_SUFFIX, tiny budget +
 *    `</block>` stop, no user-intent / ALLOW. `<block>no</block>` → allow
 *    immediately. Otherwise continue to Stage 2.
 *  - Stage 2 (thinking): system prompt + transcript + STAGE2_SUFFIX, large
 *    budget, NO stop sequence (so `<reason>` after `</block>` is preserved),
 *    full rules incl. user intent + ALLOW.
 *
 * The system prompt (framework + injected rules + settings deny rules) is built
 * per call; the transcript is the serialized conversation history with the action
 * being classified as the last entry. The model is the one configured for this
 * agent (`settings.subagents.agents.autoModeClassifier.model`) and otherwise the
 * shipped `lite` default; isolation is owned by
 * AgentService.runOneTimeWithOverrides; the output budget is widened for models
 * that cannot disable reasoning (see `runStage`).
 */
export declare class AutoModeClassifierClientImpl {
    protected readonly agentService: AgentService;
    protected readonly agentManager: AgentManager;
    protected readonly systemPromptBuilder: AutoModeSystemPromptBuilder;
    protected readonly transcriptLimit: AutoModeTranscriptLimit;
    /** All registered tools — used only to look up per-tool classifier projections. */
    protected readonly tools: BaseTool[];
    protected readonly logger: Logger;
    /** Lazy `toolName → BaseTool` index for projection lookup. */
    private toolIndex?;
    classify(input: ClassifyInput): Promise<ClassifierVerdict>;
    /**
     * Project the action being classified. Returns `''` (short-circuit-to-allow)
     * only when the tool's own projection is empty; an unknown tool projects to
     * its raw input so a tool we cannot reason about is never auto-allowed by the
     * empty-projection path (it still goes to the classifier).
     */
    private projectAction;
    /**
     * Project a history tool_use. Unknown tools are dropped from history (return
     * undefined) — Claude skips tools it has no projection for; in history this
     * is safe because the missing context only weakens, never bypasses, a check.
     */
    private projectHistory;
    /** Call a tool's projection, treating any throw as malformed input (Claude raw-input fallback). */
    private safeProject;
    private fallbackProjection;
    private getToolIndex;
    /**
     * CODEBUDDY.md / rule-layer context message (decision D2). Prepended to the
     * classifier messages with the same framing Claude uses: it is context about
     * the user's environment and intent, and only an explicit authorization of
     * the SPECIFIC action under review may be weighed — generic "be autonomous"
     * encouragement is NOT authorization.
     */
    private buildContextMessages;
    /**
     * Whether the classifier model keeps reasoning no matter what we ask
     * (Claude 2.1.226 `Xpr`). Two existing product signals carry that meaning:
     *  - `onlyReasoning`: the model only has a reasoning mode;
     *  - `reasoning.canDisableThinking === false`: no "off" switch is offered.
     *
     * Models whose capabilities we cannot read are treated as forcing reasoning.
     * That covers both "no model at all" and the `{ id, name }` placeholders
     * AgentManager builds for ids only the gateway knows (env
     * `CODEBUDDY_SMALL_FAST_MODEL`, `settings.variantModels`, a session model
     * outside `modelMap`): those carry no capability fields, so the two signals
     * above would silently read as "reasoning can be disabled". `supportsReasoning`
     * is the marker — every text model in the product config declares it, the
     * placeholders declare nothing.
     *
     * Erring this way is cheap (a model that can turn reasoning off just gets
     * budget it never uses) while the opposite breaks the classifier outright, so
     * unknown models take the headroom. Claude's `Xpr` falls back to a
     * provider-level check for the same reason.
     */
    private forcesReasoning;
    /**
     * Resolve the model the classifier stages run on:
     *  1. an explicitly picked classifier model — `CODEBUDDY_CODE_SUBAGENT_MODEL`,
     *     then `settings.subagents.agents.autoModeClassifier.model`
     *     (project > user), i.e. the shared per-Agent priority chain so `/agents`
     *     shows what actually runs; pinned onto the run via the `model` override;
     *  2. otherwise the shipped default — `product.json` declares `lite`, whose
     *     resolution stays with `AgentService.resolveRunOneTimeModel` (its
     *     session-aware variant resolution, #82146); we only mirror it here to
     *     decide the output budget.
     *
     * Read-only; a resolution failure yields an empty choice, which
     * `forcesReasoning` treats as "assume reasoning" (grant the headroom).
     */
    private resolveClassifierModel;
    /** The user's configured classifier model, or undefined when they configured none. */
    private resolveConfiguredClassifierModel;
    /**
     * Failure text for "the model answered but produced no usable verdict". Names
     * the model that ran and the knob that changes it: the cause is model fit (a
     * model that spends the small output budget on hidden reasoning), which only
     * the user can fix by pointing the classifier at another model.
     *
     * Which knob is named follows whichever source actually won. Telling the user
     * to edit settings while `CODEBUDDY_CODE_SUBAGENT_MODEL` is set would be wrong
     * advice — the env var outranks settings for every sub-agent, so the edit
     * would have no effect.
     */
    private describeUnusableResponse;
    private runStage;
    /**
     * Best-effort error dump (Claude `auto-mode-classifier-errors/<session>.txt`):
     * write the failing error + action + system prompt + transcript so a flaky
     * classifier can be diagnosed. Never throws — diagnostics must not mask the
     * original failure.
     */
    private dumpError;
    /**
     * Parse `<block>yes|no</block>` after stripping `<thinking>` (Claude nLK/jhK).
     * Returns true=block, false=allow, null=unparseable.
     */
    private parseBlock;
    /** Parse the first `<reason>…</reason>` after stripping `<thinking>` (Claude iLK). */
    private parseReason;
    /** Remove `<thinking>…</thinking>` blocks (and an unterminated trailing one). */
    private stripThinking;
}
