import { type Session } from '../../vendor/cbc-core/node/index.js';
import type { TaskOutcome } from '../galileo/task-outcome';
import type { QueryTerminal } from './types';
interface QueryOutcomeFacts {
    failure?: unknown;
    permissionDenied?: boolean;
    cancelled?: boolean;
}
/** The foreground prompt's existing CLI reporters, owned by dispatch/settlement. */
export declare function beginQueryTelemetry(session: Session, runId: string): {
    finish(terminal: QueryTerminal, facts?: QueryOutcomeFacts): Promise<TaskOutcome | undefined>;
    dispose(): void;
} | undefined;
export {};
