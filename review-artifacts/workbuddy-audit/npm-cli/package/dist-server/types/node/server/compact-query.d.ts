import type { Session } from '../../vendor/cbc-core/node/index.js';
import { Effect } from 'effect';
import { Compactions, SessionManager } from './services';
import type { QueryOptions, QueryResult, SessionEvent } from './types';
/** Own the complete operation, including activation failures and pre-dispatch cancellation. */
export declare function beginCompactQuery(sessionId: string, runId: string, publish: (event: SessionEvent) => void): {
    compactionId: string;
    finish(result: Pick<QueryResult, 'stopReason' | 'errorMessage'>): void;
};
/** Invoke the kernel maintenance component, without command/skill resolution or user input. */
export declare const runCompactQuery: (session: Session, runId: string, compactionId: string, options: QueryOptions, publish: (event: SessionEvent) => void) => Effect.Effect<QueryResult, never, import("./services").ComponentResolver | SessionManager | Compactions>;
