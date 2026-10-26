/** Which classifier stage a timeout applies to. */
export type AutoModeStage = 1 | 2;
/**
 * Resolve the local timeout (ms) for an auto-mode classifier stage call.
 * Aligned with Claude Code 2.1.181: Stage 1 = 60s, Stage 2 = 120s.
 *
 * `CODEBUDDY_AUTO_MODE_CLASSIFIER_TIMEOUT_MS`, when set, overrides BOTH stages
 * (single knob, backward-compatible with the previous single-timeout behaviour).
 */
export declare function resolveAutoModeTimeoutMs(stage: AutoModeStage): number;
/**
 * Race a promise against a local timeout. Rejects with `${label} timed out after Nms`
 * if the timeout fires first. Prevents lite-model calls from hanging forever when
 * the model stream never completes.
 */
export declare function withAutoModeTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T>;
