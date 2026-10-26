/**
 * Creates an AbortController with unlimited listener capacity on its signal.
 *
 * The OpenAI SDK's `fetchWithTimeout` (openai/client.js) registers an abort
 * listener on the signal for **every** API call without removing it afterwards.
 * In a long-running agent session each turn adds one leaked listener, easily
 * exceeding Node's default MaxListeners limit of 50 and emitting a noisy
 * `MaxListenersExceededWarning`.
 *
 * By calling `setMaxListeners(0, signal)` at creation time we suppress the
 * warning.  This is safe because the listeners are all tied to the
 * AbortController's lifetime and will be garbage-collected together with it
 * once the run completes.
 *
 * Use this helper wherever the resulting signal is passed into the OpenAI SDK
 * run loop or any other path that may register many listeners (e.g. parallel
 * sub-agent tasks sharing a parent signal).
 */
export declare function createAbortController(): AbortController;
/**
 * Suppress the MaxListeners warning on an **existing** AbortSignal.
 *
 * Useful when you don't own the AbortController but need to attach many
 * listeners to its signal (e.g. the main session signal shared by concurrent
 * AgentTask instances).
 */
export declare function unlimitAbortSignalListeners(signal: AbortSignal): void;
/** Removes a previously installed abort link. Idempotent and always safe. */
export type AbortLinkDisposer = () => void;
/**
 * Link `source` to `target`: aborting `source` aborts `target`. Aborting
 * `target` does **not** affect `source` — propagation is strictly one-way.
 *
 * Lifecycle safety (this is the root cause fixed for #82125 — the bug was never
 * "listeners are used", it was "listeners had no lifecycle", so each generation
 * strongly captured the previous controller and the whole chain stayed
 * reachable):
 *
 * 1. **Fast path** — an already-aborted `source` propagates synchronously and
 *    registers nothing, so signals that can never fire hold no listener.
 * 2. **Weak `source`** — `target` never strongly references `source`, so a live
 *    target cannot resurrect an abandoned generation upstream of it.
 * 3. **Reverse removal** — when `target` aborts, the propagation listener is
 *    removed from `source` instead of lingering until `source` dies.
 *
 * The returned disposer covers the remaining case: the owning run completes
 * normally, so the link is obsolete even though neither side ever aborted.
 *
 * `target` is held **strongly** by the propagation listener, i.e. "the link is
 * installed" implies "the target is reachable" (#115417). It used to be a
 * WeakRef, which silently broke the one guarantee this function exists to make:
 * a cascade generation that has left the call stack — the queued run's outer
 * controller on the `inner → outer → in-flight run` ESC path — is referenced by
 * nothing but the link itself, so GC collected it and `deref()` handed back
 * undefined mid-propagation. Esc then aborted the session owner and stopped
 * there, leaving the in-flight run and its foreground sub-agent running with no
 * trace in any log. Retaining the target does not bring #82125 back: the three
 * measures above plus the disposer still give every link a definite end, and
 * `once: true` keeps a fired listener from being retained.
 *
 * Modelled on `~/workspace/claude-code/src/utils/abortController.ts:68-97`.
 */
export declare function linkAbortSignalToController(source: AbortSignal, target: AbortController): AbortLinkDisposer;
//# sourceMappingURL=abort-utils.d.ts.map