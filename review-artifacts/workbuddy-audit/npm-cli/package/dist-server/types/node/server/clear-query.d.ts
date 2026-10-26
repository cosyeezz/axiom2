import { type Session } from '../../vendor/cbc-core/node/index.js';
import { Effect } from 'effect';
import { SessionManager } from './services';
import type { QueryOptions, QueryResult, SessionEvent } from './types';
/** Preserve the transcript; the kernel history filter starts model context after this boundary. */
export declare const runClearQuery: (session: Session, runId: string, options: QueryOptions, publish: (event: SessionEvent) => void) => Effect.Effect<QueryResult, never, SessionManager>;
