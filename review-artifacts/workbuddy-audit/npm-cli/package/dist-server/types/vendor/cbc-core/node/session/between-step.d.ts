/**
 * Between-tool-and-model error resilience — deterministic in-loop stage (design:
 * docs/agent-cli/between-tool-and-model-error-resilience.md §3.4).
 *
 * The loop runs deterministic side effects between a tool result and the next
 * model request (history admission → transformItemForSaveAsync → image blob
 * dehydrate / externalize / checkpoint / …). Their only job is to produce a
 * *valid next model request*; a best-effort enrichment failure does not stop
 * that. So the correct default here is "degrade and continue", not "crash".
 *
 * betweenStep inverts the historical posture from throw-unless-whitelisted to
 * degrade-unless-fatal (Codex "Layer 1 — degrade in place" parity):
 *   - control signals (abort / permission / hook-block) → propagate (terminal by design);
 *   - programmer bugs (ERR_* / TypeError / assertion) → propagate (never hide defects);
 *   - everything else (esp. FS errno / transient IO) → log + degrade to a valid fallback.
 */
/**
 * The single FS-errno allowlist for the whole between-tool-and-model stage
 * (design §3.4: "Consolidates blob-store's DEGRADABLE_FS_ERRNOS so every leaf
 * shares one definition."). It lives here, in cbc-core, because that is the
 * lowest layer that both the stage helper and the agent-cli blob-store leaf can
 * depend on — the enforced direction is `agent-cli → cbc-core → cbc-shared`, so
 * the leaf imports this downward rather than each layer keeping a parallel list.
 *
 * Only "environment cannot write" filesystem errnos: read-only / served FS
 * (EROFS), missing shard dir (ENOENT), permission (EACCES/EPERM), space/quota
 * (ENOSPC/EDQUOT), low-level IO / dir shape (EIO/ENOTDIR/EISDIR/EBUSY). Node's
 * `ERR_*` programmer-error codes deliberately do NOT belong here — they carry a
 * `code` but are call-site bugs, classified by isProgrammerBug and surfaced.
 */
export declare const DEGRADABLE_FS_ERRNOS: ReadonlySet<string>;
/**
 * Deliberately single-argument: the host logger (celljs `Logger`) has the shape
 * `warn(message, context?: string)` — its second parameter is a *context label*,
 * not varargs. Passing an error there stringifies it into `[Error: …]` and drops
 * `stack` / `code` entirely (a non-Error throw becomes `[object Object]`), so the
 * degrade record must serialize the error into `message` itself. Narrowing the
 * interface makes that misuse impossible to reintroduce.
 */
export interface BetweenStepLogger {
    warn(message: string): void;
}
/**
 * Terminal control signals: a user abort, context-compaction abort, permission
 * denial, or hook block. These are not "errors" in the degrade sense — they are
 * the loop's intended terminal outcomes and must propagate unchanged.
 */
export declare function isControlSignal(error: unknown): boolean;
/**
 * Programmer bugs must surface loudly, never be swallowed as a degrade: a
 * genuine defect hidden behind a placeholder is far worse than a lost turn.
 * Covers TypeError / ReferenceError / SyntaxError, assertion failures, and
 * Node's `ERR_*` internal codes (which include the serialize guard
 * `ERR_STRING_TOO_LONG`). Prototype-loss across realms falls back to `name`.
 */
export declare function isProgrammerBug(error: unknown): boolean;
/**
 * Environmental / transient IO failures — the canonical degradable class. Not a
 * gate in betweenStep (the default already degrades); used to label the degrade
 * record and shared with the blob-store leaf as the one FS-errno definition.
 */
export declare function isEnvironmentalError(error: unknown): boolean;
/**
 * Wrap a deterministic between-tool-and-model side effect. On success passes the
 * value through; on a control signal or programmer bug rethrows; otherwise logs
 * and returns the caller's `degrade()` fallback so the loop continues with a
 * valid-but-lesser request.
 *
 * @param label short site identifier, e.g. "dehydrate:user-message-image".
 * @param fn the side effect to attempt.
 * @param degrade Tier-A recovery: produce a valid, descriptive fallback value.
 * @param logger optional structured logger for the degrade record.
 */
export declare function betweenStep<T>(label: string, fn: () => Promise<T>, degrade: () => T, logger?: BetweenStepLogger): Promise<T>;
//# sourceMappingURL=between-step.d.ts.map