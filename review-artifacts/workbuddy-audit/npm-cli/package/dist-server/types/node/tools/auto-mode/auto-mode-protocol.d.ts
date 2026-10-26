import { PermissionMode } from '../../../vendor/cbc-shared/node/index.js';
/**
 * Auto mode permission subsystem — public protocol.
 *
 * All auto-mode-specific logic is aggregated under `tools/auto-mode/`. Host files
 * (tool-permission-service, interruption-service, agent-task, session-middleware)
 * only depend on the symbols exported here, never on the internals.
 */
/** DI symbol for the auto mode permission service. */
export declare const AutoModePermissionService: unique symbol;
/** Classifier verdict categories, aligned with Claude Code auto mode. */
export type AutoModeDenyCategory = 'soft_deny' | 'hard_deny' | 'unknown' | 'unavailable';
/**
 * Result of classifying a tool call that would otherwise prompt the user.
 *
 * The classifier verdict is binary (allow | block, mapped to allow | deny here).
 * There is no `ask` result — "requires confirmation" is the host's decision when
 * the classifier is `unavailable` (see fallback). `unavailable.failClosed`
 * tells the host whether to deny (non-interactive) or fall back to a prompt.
 * `unavailable.kickOutOfAuto` is set once the circuit breaker trips — the host
 * should switch the session out of auto mode (back to default), aligned with
 * Claude Code's `kickOutOfAutoIfNeeded`.
 *
 * `unavailable.noVerdict` marks the case where the classifier RAN but returned
 * nothing usable (Claude `parse_failure`): always fail-closed, and the host uses
 * the "no verdict" deny message instead of the "temporarily unavailable" one. It
 * counts toward the denial limit below, so an unusable classifier model does not
 * block every action for the rest of the session.
 *
 * `transcriptTooLong` is produced when the serialized transcript exceeds the
 * classifier model's context window (Claude `transcript_too_long`). The host
 * falls back to normal permission handling (prompt) when interactive, and
 * ABORTS the agent run when headless (`headlessAbort`), aligned with Claude's
 * "exceeded context window in headless mode".
 *
 * `denialLimitExceeded` is produced when classifier outcomes that blocked the
 * action (block verdicts, or runs that produced no verdict) hit the
 * 3-consecutive / 20-total denial limit (Claude `I_m`). Interactive sessions
 * fall back to a prompt (auto pauses); headless runs abort (`headlessAbort`),
 * aligned with Claude's "too many classifier denials in headless mode".
 */
export type AutoModePermissionResult = {
    behavior: 'allow';
    reason: string;
    source: 'fastPath' | 'classifier';
} | {
    behavior: 'deny';
    reason: string;
    category: AutoModeDenyCategory;
} | {
    behavior: 'unavailable';
    reason: string;
    failClosed: boolean;
    kickOutOfAuto?: boolean;
    noVerdict?: boolean;
} | {
    behavior: 'transcriptTooLong';
    reason: string;
    headlessAbort: boolean;
    actualTokens: number;
    limitTokens: number;
} | {
    behavior: 'denialLimitExceeded';
    reason: string;
    headlessAbort: boolean;
};
/** Availability of auto mode for the current session/environment. */
export interface AutoModeAvailability {
    available: boolean;
    reason?: 'disabledBySettings' | 'modelUnavailable';
    message?: string;
}
/** Resolved auto mode rules (after $defaults expansion). */
export interface AutoModeRules {
    environment: string[];
    allow: string[];
    soft_deny: string[];
    hard_deny: string[];
}
/**
 * A classification request. The host passes the raw tool call plus the
 * conversation transcript and user deny rules; the service owns all prompt
 * assembly (system prompt + two-stage classifier).
 */
export interface AutoModePermissionRequest {
    /** Session id, for per-session circuit-breaker / recent-denials bookkeeping. */
    sessionId: string;
    toolName: string;
    toolInput: unknown;
    /** The runtime mode (always Auto when this is invoked). */
    currentMode: PermissionMode;
    /** Abort signal tied to the host run; classifier must not outlive it. */
    signal?: AbortSignal;
    /** Whether the session can prompt the user (interactive) — drives fallback. */
    canPrompt: boolean;
    /**
     * Whether the session is headless (outputFormat json / stream-json). On a
     * transcript-too-long it drives ABORT instead of a prompt fallback.
     */
    headless?: boolean;
    /**
     * Conversation history to serialize into the `<transcript>` the classifier
     * reads. The action being classified (toolName/toolInput) is appended as the
     * most-recent entry by the serializer. History is DATA — it never grants
     * permission. Loosely typed (AgentInputItem[]) to keep the protocol from
     * depending on the agent runtime types.
     */
    transcript?: unknown[];
    /** User-configured `permissions.deny` rules, injected into the classifier prompt. */
    settingsDenyRules?: string[];
}
/**
 * Auto mode permission service — the single entry point host code depends on.
 */
export interface AutoModePermissionService {
    /** Gate: is auto mode usable right now (settings + model)? */
    isAutoModeAvailable(): Promise<AutoModeAvailability>;
    /**
     * Whether `defaultMode: auto` may be granted by the settings sources present.
     * Auto is privileged: only user / CLI scopes may grant it; project / project-local
     * are ignored (anti repo self-grant). Enterprise policy/flag sources are not
     * implemented in this product.
     */
    isSettingsAutoGrantAllowed(): Promise<boolean>;
    /** Classify a tool call that would otherwise prompt. */
    classifyAsk(request: AutoModePermissionRequest): Promise<AutoModePermissionResult>;
}
/**
 * Per-stage local timeouts for a classifier call (ms), aligned with Claude Code
 * 2.1.181: Stage 1 = 60s (`§9.2`), Stage 2 = 120s (`§9.3`). Stage 2 gets the
 * longer budget because it runs the thinking pass with the large output budget.
 */
export declare const AUTO_MODE_CLASSIFIER_STAGE1_TIMEOUT_MS_DEFAULT = 60000;
export declare const AUTO_MODE_CLASSIFIER_STAGE2_TIMEOUT_MS_DEFAULT = 120000;
/**
 * Env override for the classifier timeout. When set, it overrides BOTH stages
 * (single knob — we do not expose per-stage env). Kept for backward compat with
 * the previously single-timeout behaviour.
 */
export declare const AUTO_MODE_CLASSIFIER_TIMEOUT_ENV = "CODEBUDDY_AUTO_MODE_CLASSIFIER_TIMEOUT_MS";
