import type { Logger } from '@genie/telemetry';
import type { Session } from './session-protocol';
import type { SessionRunStateMachine } from './session-run-state-machine-protocol';
export declare const DRAIN_LOOP_GUARD_THRESHOLD = 3;
/**
 * Apply the trip actions for a no-progress loop.
 *
 * `forceIdle` alone is not enough: it re-wakes the drain paths, so the
 * suppression flag they consult must be set in the same step. Idempotent —
 * a second trip on the same session is a no-op.
 */
export declare function tripDrainLoopGuard(session: Session, stateMachine: SessionRunStateMachine, logger: Pick<Logger, 'error'>, diagnostics: string): void;
export declare function trackEmptyDrainAndMaybeTripGuard(session: Session, stateMachine: SessionRunStateMachine, logger: Pick<Logger, 'error'>): void;
export declare function resetEmptyDrainLoopGuard(session: Session): void;
//# sourceMappingURL=empty-drain-loop-guard.d.ts.map