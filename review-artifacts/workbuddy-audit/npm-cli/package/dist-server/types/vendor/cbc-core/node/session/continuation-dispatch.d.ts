import type { AgentInputItem } from '../../../cbc-shared/node/index.js';
import type { Session } from './session-protocol';
export interface SessionContinuationOptions {
    /** Resolve against current state when the host dequeues the ticket. Empty input skips the turn. */
    resolveInput?: () => AgentInputItem[];
    /** Combine sources sharing this key while their ticket is still queued, within this session only. */
    coalesceKey?: string;
}
type ContinuationDispatcher = (input: AgentInputItem[], options?: SessionContinuationOptions) => void;
export declare function bindSessionContinuation(session: Session, dispatch: ContinuationDispatcher): void;
/** Synchronous admission, not turn completion. A closed owner rejects admission. */
export declare function dispatchSessionContinuation(session: Session, input: AgentInputItem[], options?: SessionContinuationOptions): boolean;
export {};
//# sourceMappingURL=continuation-dispatch.d.ts.map