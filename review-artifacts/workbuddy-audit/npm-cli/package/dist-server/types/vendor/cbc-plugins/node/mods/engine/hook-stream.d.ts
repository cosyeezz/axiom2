/**
 * Streaming events (official `StreamingEventName`: `turn.step`, `process.spawn`).
 *
 * A hook on one is an async generator (`StreamHook`): `next(e)` hands it the
 * stream beneath (`HookStream`: an `AsyncGenerator<Chunk, Result>` with a
 * `result` promise), what it yields is the stream its caller reads, and what
 * it returns is the result above it — nothing returned lets its last
 * `next(e)`'s result stand. Each `next(e)` opens a fresh stream beneath; a hook
 * that never calls it yields its own chunks and nothing beneath runs. The
 * bottom of the chain is the host's stream (the model's response, the child's
 * output).
 *
 * The budget (`HookBudget.ms`) counts the hook's own code between two pieces,
 * never a wait at a `yield` or on the stream beneath. A hook that throws or
 * runs out of budget is skipped from there on: the stream beneath (the one it
 * opened, or a fresh one) carries on to the caller unchanged.
 */
import type { EventInput, EventResult, Origin, TraceEntry } from '../types/index';
/** Official `HookStream<C, R>`. */
export type HookStream<C, R> = AsyncGenerator<C, R> & {
    readonly result: Promise<R>;
};
/** One link of a streaming chain, as the registry selected it. */
export interface StreamLink {
    readonly plugin: string;
    readonly tier: string;
    readonly run: (input: EventInput, next: (e: EventInput) => HookStream<unknown, EventResult>) => unknown;
    /** Runs `step` as this hook's own code: its `$` calls do not re-enter it. */
    readonly enter: <T>(step: () => T) => T;
}
export interface StreamChain {
    readonly event: string;
    readonly links: readonly StreamLink[];
    /** The bottom: the host's own stream for `e`. */
    readonly core: (e: EventInput) => AsyncGenerator<unknown, EventResult>;
    readonly budgetMs: number;
    readonly origin: Origin;
    readonly trace: TraceEntry[];
    readonly onFailure?: (plugin: string, kind: 'throw' | 'timeout', message?: string) => void;
    readonly freeze?: (e: EventInput) => EventInput;
}
/** Wraps a generator as a `HookStream`: `result` settles once it is read to its end. */
export declare function toHookStream<C, R>(source: AsyncGenerator<C, R>): HookStream<C, R>;
/** Runs the chain from link `idx`: the stream the link above (or the caller) reads. */
export declare function runStream(chain: StreamChain, input: EventInput, idx?: number): HookStream<unknown, EventResult>;
//# sourceMappingURL=hook-stream.d.ts.map