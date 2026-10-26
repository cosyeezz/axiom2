import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { HookEvent, HookInput, HookOutput } from '../control-signal/control-signal-protocol';
export type { HookEvent, HookInput } from '../control-signal/control-signal-protocol';
export type HookJSONOutput = HookOutput | {
    async: true;
    asyncTimeout?: number;
};
export type HookCallback<E extends HookEvent = HookEvent> = (input: Extract<HookInput, {
    hook_event_name: E;
}>, toolUseId: string | undefined, options: {
    signal: AbortSignal;
}) => Promise<HookJSONOutput>;
export interface HookCallbackMatcher<E extends HookEvent = HookEvent> {
    matcher?: string;
    hooks: HookCallback<E>[];
    /** Seconds; defaults to 60. */
    timeout?: number;
}
export type QueryHooks = {
    [E in HookEvent]?: HookCallbackMatcher<E>[];
};
interface Owner {
    readonly controller: AbortController;
}
export interface QueryHookScope {
    readonly hooks: QueryHooks;
    readonly owner: Owner;
}
/** Snapshot the serializable shape, retaining callback function identities. */
export declare function snapshotQueryHooks(hooks: QueryHooks): QueryHooks;
/** Omission keeps the residency binding; an explicit empty object clears it. */
export declare function setSessionQueryHooks(session: Session, hooks: QueryHooks): void;
export declare function resolveQueryHooks(session?: Session): QueryHookScope | undefined;
/** Async children retain the callback snapshot of the run that created them. */
export declare function withSessionQueryHooks<A>(session: Session, operation: () => A): A;
/**
 * The SessionEnd callbacks of a closing residency, taken before its binding
 * closes. They get an owner of their own, as they outlive the aborted run.
 */
export declare function sessionEndQueryHooks(session: Session): QueryHookScope | undefined;
export declare function withQueryHookScope<A>(binding: QueryHookScope | undefined, operation: () => A): A;
export declare function closeSessionQueryHooks(session: Session): void;
export declare function invokeQueryHook(binding: QueryHookScope, callback: HookCallback, input: HookInput, toolUseId: string | undefined, timeoutMs: number, executionSignal?: AbortSignal): Promise<HookJSONOutput>;
