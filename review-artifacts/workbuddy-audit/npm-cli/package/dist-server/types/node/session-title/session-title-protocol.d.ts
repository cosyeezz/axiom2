import { Session } from '../../vendor/cbc-core/node/index.js';
export declare const SessionTitleService: unique symbol;
/**
 * Per-session title-generation state.
 *
 * Models the generation as an idempotent latch ("does this session still need
 * a title?") rather than a one-shot count window. A title is generated from the
 * first real user message and retried on every subsequent user prompt until it
 * succeeds, mirroring Claude Code's behavior. This avoids the failure mode where
 * a single failed generation (network/parse/timeout) at a fixed message count
 * left the session permanently untitled.
 */
export interface SessionTitleTriggerState {
    /**
     * Idempotent latch: true once a valid title exists (generated this run, or
     * rebuilt from persisted history). When true, no further generation runs.
     */
    titled: boolean;
    /** Consecutive failed generation attempts; used to give up after a cap. */
    failedAttempts: number;
    /** Monotonic id for CAS-style guard against superseded async generations. */
    generationId: number;
    /** Set once failedAttempts hits the cap; permanently skips this session. */
    abandoned: boolean;
}
export interface SessionTitleServiceInterface {
    handleUserPromptSubmit(prompt: string, session: Session): Promise<void>;
    getPendingTitlePromise(sessionId: string): Promise<void> | undefined;
    setForceEnabled(enabled: boolean): void;
}
