/**
 * Session config rules shared by ACP and stream-json (Issue #145200).
 *
 * ACP (`acp-agent.ts`) introduced these rules for #12554 (thinking) and #57413
 * (context window). stream-json `set_model` / `set_config` reuse them so the same
 * user action gives the same result on both host chains. Functions here are pure
 * over the model config and the SessionManager side tables; callers own how the
 * model config is resolved.
 */
import { type LanguageModel, type ReasoningEffortLevel } from '@genie/product';
/**
 * Opt-in for the stream-json session config behavior of Issue #145200. Unset (the
 * default) keeps the pre-#145200 behavior byte for byte. Agreed with sandbox-proxy:
 * both sides ship with it off and the cloud deployment turns it on once both
 * versions are live. When set to `1`:
 *
 *   - `set_config.contextWindow` is validated against the current model (P1-1);
 *   - stream-json `result._meta` carries `codebuddy.ai/contextWindow` (P1-2);
 *   - `set_model` reconciles thinking / context window and reports the session
 *     state in `context_window` / `thinking` (P1-4);
 *   - `set_config` accepts the session-level `thoughtLevel` key and rejects
 *     `disabled` where the model cannot turn thinking off (P2-5 / P2-6).
 *
 * When unset, `thoughtLevel` is reported as `"thoughtLevel" is not a configurable
 * key`, the message sandbox-proxy uses to fall back to the global keys.
 */
export declare const ENV_CBC_SESSION_CONFIG_SYNC = "CBC_SESSION_CONFIG_SYNC";
export declare function isSessionConfigSyncEnabled(): boolean;
/** Session-level thinking override, as stored by `SessionManager.setOverrideThinking`. */
export interface ThinkingOverride {
    thinkingEnabled?: boolean;
    reasoningEffort?: ReasoningEffortLevel;
    maxThinkingTokens?: number;
}
export interface ThinkingOverrideStore {
    getOverrideThinking(sessionId: string): ThinkingOverride | undefined;
    setOverrideThinking(sessionId: string, value: ThinkingOverride | null): void;
}
export interface ContextWindowOverrideStore {
    getOverrideContextWindow(sessionId: string): number | undefined;
    setOverrideContextWindow(sessionId: string, value: number | null): void;
}
type ModelLike = Pick<LanguageModel, 'id' | 'maxInputTokens' | 'contextWindow' | 'onlyReasoning' | 'reasoning'>;
/** ACP `thought_level` value: `disabled` | `enabled` | one of the six efforts. */
export type ThoughtLevel = 'disabled' | 'enabled' | ReasoningEffortLevel;
/** Budgets the model actually offers; same normalization as the runtime budget resolver. */
export declare function supportedContextWindows(model: ModelLike | undefined): number[];
/** A budget is selectable only on models that expose at least two budgets, including this one. */
export declare function isContextWindowSupported(model: ModelLike | undefined, value: number): boolean;
export declare function contextWindowRejection(rawValue: string, model: ModelLike | undefined): Error;
export declare function effectiveContextWindow(model: ModelLike | undefined, override: number | undefined): number | undefined;
/** Whether the model offers an Off entry. Unknown models are treated as disable-capable. */
export declare function canDisableThinking(model: ModelLike | undefined): boolean;
/**
 * Map an ACP `thought_level` value to the session override it writes.
 * Throws the same messages as ACP `setSessionConfigOption(thought_level)`.
 */
export declare function thoughtLevelToOverride(value: string, model: ModelLike | undefined): ThinkingOverride;
/** Reverse of {@link thoughtLevelToOverride}; `null` when there is no session-level choice. */
export declare function overrideToThoughtLevel(override: ThinkingOverride | undefined): ThoughtLevel | null;
/**
 * #12554: after a model change, a session-level Off is reset to On at the new
 * model's default effort when the new model cannot turn thinking off.
 * @returns whether the override changed.
 */
export declare function reconcileThinkingAfterModelChange(store: ThinkingOverrideStore, sessionId: string, model: ModelLike | undefined): boolean;
/**
 * #57413: after a model change, a session budget the new model does not offer is
 * cleared so the session falls back to the new model's default budget.
 * @returns the cleared budget, or `undefined` when nothing changed.
 */
export declare function reconcileContextWindowAfterModelChange(store: ContextWindowOverrideStore, sessionId: string, model: ModelLike | undefined): number | undefined;
export {};
