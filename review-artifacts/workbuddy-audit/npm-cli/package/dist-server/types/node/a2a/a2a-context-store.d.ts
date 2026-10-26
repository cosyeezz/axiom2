import { Session } from '../../vendor/cbc-core/node/index.js';
/**
 * Session-scoped continuation state for outbound A2A calls: continuation key
 * -> A2A contextId, so a follow-up `message/send` continues the same
 * conversation on the remote agent instead of opening a fresh one.
 *
 * Why it lives on `session.meta` rather than a module-level map (the shape
 * this replaces):
 *
 *  - **Session isolation.** A module-level map is process-global. One
 *    agent-cli process can serve several conversations (and `/clear` starts a
 *    new one in the same process), so a global map lets conversation B
 *    silently resume conversation A's remote context.
 *  - **Cross-process survival.** `A2A_CONTEXTS_META_KEY` is on
 *    `PERSISTED_SESSION_META_KEYS`, so it rides the off-tree `session-meta`
 *    line inside the session transcript and comes back on `--resume`. Without
 *    it, a resumed conversation looks continuous locally while the remote
 *    agent has lost every earlier turn.
 *  - **Lifecycle for free.** The session owns the data: deleting the session
 *    drops it, a new session starts empty, and nothing needs a separate
 *    cleanup pass.
 *
 * Served sessions (ACP / gateway) never write the `session-meta` line — the
 * store still works in memory for the process lifetime, it just doesn't
 * survive a restart there. Degrading, not breaking.
 *
 * The key is `(discovery source, agentId)` — see {@link a2aContinuationKey}.
 */
export declare const A2A_CONTEXTS_META_KEY = "codebuddy.ai/a2aContexts";
/**
 * Continuation key: discovery source + agent.
 *
 * The source participates because an agent name is only unique *within* a
 * directory — the same name served by a different source is a different
 * remote. That matters more here than for an in-memory map: this state is
 * persisted, so it outlives the process and can still be around after a
 * session re-points its discovery source.
 *
 * Deliberately NOT keyed by skill. A contextId identifies a conversation with
 * an agent; skills are routing *within* that agent. Splitting per skill would
 * cut one conversation into several remote contexts that cannot see each
 * other's history.
 */
export declare function a2aContinuationKey(source: string | undefined, agentId: string): string;
/** One remembered remote conversation. `updatedAt` is epoch ms, used for expiry only. */
export interface A2aContextEntry {
    contextId: string;
    updatedAt: number;
}
/** The persisted value under {@link A2A_CONTEXTS_META_KEY}: continuation key -> entry. */
export type A2aContextMap = Record<string, A2aContextEntry>;
/**
 * How long a remembered contextId stays usable. The A2A spec lets a remote
 * agent expire and reclaim contexts, and requires it to REJECT an unknown
 * contextId rather than quietly substituting a new one — so a stale id turns
 * every later call into a hard failure. Expiring locally keeps that from
 * happening: past the TTL we simply open a fresh context.
 *
 * 24h is deliberately conservative. It comfortably covers "close the laptop,
 * resume tomorrow morning" while staying well inside any plausible remote
 * retention window.
 *
 * Expiry is the ONLY staleness defence here, on purpose. Reacting to the
 * remote's rejection instead would be more precise, but the spec defines no
 * distinct error for "unknown contextId" and this SDK surfaces failures as
 * free-text messages (see classifyA2AError), so a rejection cannot be told
 * apart from a transient network failure. Guessing wrong either discards a
 * healthy context or — if paired with an automatic retry — re-sends a task
 * the remote may already have started. A clock is not clever, but it is
 * deterministic.
 */
export declare const DEFAULT_A2A_CONTEXT_TTL_MS: number;
/**
 * Resolve the context TTL, allowing an ops override without a release.
 *
 * - unset / empty -> default
 * - positive integer -> that value
 * - zero / negative / non-numeric -> default (fail soft; a broken env var
 *   must not silently disable continuation)
 */
export declare function resolveA2aContextTtlMs(envValue?: string | undefined, defaultValue?: number): number;
/**
 * The contextId to continue with for `key` (see {@link a2aContinuationKey}),
 * or undefined to start a fresh remote context. Undefined covers all of: no
 * session, nothing remembered, malformed persisted data, and expired entries.
 *
 * Pure read — expired entries are pruned on the next write, not here, so that
 * reading never mutates the session behind the caller's back.
 */
export declare function readA2aContextId(session: Session | undefined, key: string, now?: number, ttlMs?: number): string | undefined;
/**
 * Remember `contextId` under `key` (see {@link a2aContinuationKey}) on this
 * session, pruning expired entries along the way.
 *
 * Returns whether anything actually changed, which is the caller's signal to
 * persist. A no-change result is the common case (same context, recently
 * touched) and must NOT trigger a write — every write appends a line to the
 * transcript.
 */
export declare function rememberA2aContextId(session: Session | undefined, key: string, contextId: string, now?: number, ttlMs?: number): boolean;
