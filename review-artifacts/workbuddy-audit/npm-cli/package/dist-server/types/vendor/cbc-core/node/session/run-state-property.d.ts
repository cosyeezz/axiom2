import { BehaviorSubject } from 'rxjs';
import type { Session } from './session-protocol';
import { SessionRunStateSnapshot } from './session-run-state-machine-protocol';
/**
 * Install a getter/setter pair on `session.runState` that pushes every
 * canonical snapshot through `runStateSubject`.
 *
 * `runStateSubject` is the single source of truth: getter reads
 * `runStateSubject.value`, setter forwards to `runStateSubject.next()` after
 * a `(status, lastTransition.at)` dedupe. This guarantees the property and
 * the subject can never diverge.
 *
 * Dedup rule: redundant assignments (same status AND same transition
 * timestamp) are no-ops, so callers can freely re-write `session.runState`
 * without producing spurious emissions. A self-loop transition (e.g.
 * `AGENT_HANDOFF` keeping `agent_running`) advances `at`, so it still fires.
 *
 * Lives in its own module (no `../utils` / `../tips` import chain) so it can
 * be imported safely from unit tests without dragging the full agent-cli
 * runtime along.
 */
export declare function installRunStateProperty(session: Session, runStateSubject: BehaviorSubject<SessionRunStateSnapshot>): void;
//# sourceMappingURL=run-state-property.d.ts.map