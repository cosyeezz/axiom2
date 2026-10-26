/**
 * Typed local-transcript I/O failure (issue #119545).
 *
 * The only reason this type exists: `addHistory` must be able to tell "the
 * local JSONL copy could not be written" apart from "this turn is broken".
 * Windows `EBUSY` on the transcript is a third-party sharing violation, and a
 * side-channel copy must never terminate a turn that is still executing tools.
 *
 * Everything else about persistence stays best-effort on purpose: there is no
 * pending queue, no cross-process outbox and no durability barrier, so nothing
 * else in the runtime waits on, or can be vetoed by, this file.
 */
export type SessionPersistencePhase = 'open' | 'stat' | 'write' | 'close' | 'rollback';
export type SessionPersistenceRollbackOutcome = 'not-needed' | 'succeeded' | 'failed';
export interface SessionPersistenceErrorOptions {
    phase: SessionPersistencePhase;
    cause: unknown;
    attempt?: number;
    rollbackOutcome?: SessionPersistenceRollbackOutcome;
    retryable?: boolean;
}
/**
 * Windows sharing violations and their POSIX lookalikes. `EBUSY` is the one
 * this ticket measured (25% of appends within 10ms of the previous write);
 * `EPERM` / `EACCES` ride along because the same scanners produce them.
 */
export declare function isRetryableSessionPersistenceError(error: unknown): boolean;
export declare class SessionPersistenceError extends Error {
    readonly phase: SessionPersistencePhase;
    readonly code?: string;
    readonly attempt: number;
    readonly rollbackOutcome: SessionPersistenceRollbackOutcome;
    readonly retryable: boolean;
    constructor(options: SessionPersistenceErrorOptions);
}
/**
 * Duck-typed on purpose: core and the host package can each hold their own copy
 * of this class, so `instanceof` is not reliable across the package boundary.
 * The required fields keep a foreign error named `SessionPersistenceError` from
 * being mistaken for one of ours — an unrecognized error still fails the run,
 * which is the safe direction.
 */
export declare function isSessionPersistenceError(error: unknown): error is SessionPersistenceError;
//# sourceMappingURL=session-persistence-error.d.ts.map