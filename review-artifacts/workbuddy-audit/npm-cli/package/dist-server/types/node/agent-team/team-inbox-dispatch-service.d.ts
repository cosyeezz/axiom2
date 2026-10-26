/**
 * Team Inbox Dispatch Service
 *
 * CLI-internal auto-activator for team-inbox messages in Mode B (deferred dispatch).
 *
 * Why this service exists
 * =======================
 * When the team lead is busy running a turn, teammate SendMessage calls (and the
 * framework's 4s auto-notification) write to the lead's mailbox file. The poller
 * in `team-create-tool.ts` picks those up; in Mode B it enqueues them into
 * `RichMessageQueueManager` and marks the last one as `sendNow` (sets
 * `runtime.immediateItemId`). Without this service, *nothing* would trigger
 * `activate()` — UI-originated queue items rely on the renderer to do it, but
 * team-originated items have no UI hook. Result: messages would sit in the
 * rich queue indefinitely and the lead would "never hear back", which is the
 * exact bug this service fixes.
 *
 * What it does
 * ============
 * For each registered session, subscribe to `SessionRunStateMachine.getChange$`.
 * On every transition that lands the session back at `idle` (the canonical
 * equivalent of legacy `agent_end`), schedule an auto-dispatch attempt (via
 * `queueMicrotask` to give other run-state subscribers — e.g. `markItemSent`
 * — a chance to run first). The attempt:
 *   1. Checks the `CBC_TEAM_IMMEDIATE_DISPATCH` feature flag.
 *   2. Reads the rich queue for this session. Only proceeds if there is an
 *      `immediateItemId` or any `pending` / `sending` item.
 *   3. Skips if the session is mid-compact (`session.isCompressing`), has
 *      pending permission/question requests, is paused, or is already
 *      dispatching (re-entry guard).
 *   4. Calls `activate()` to pop the prioritized item.
 *   5. Calls `AgentService.run()` with the item's text as a fresh independent
 *      turn. On the resulting transition back to idle, this method is called
 *      again, so leftover queue items drain one per turn.
 *
 * What it does NOT do
 * ===================
 * - Does not interrupt in-flight tool calls. Dispatch only happens at idle
 *   transitions, so the current turn completes cleanly.
 * - Does not touch Mode A (`session.queue`) — that path keeps working as before
 *   because the legacy `MessageQueueAgentRunInterceptor` drains it.
 * - Does not change `RichMessageQueueManager` semantics; UI-initiated sendNow
 *   still works identically. If the UI's `activate_queue` RPC beats us to a
 *   given item, our `activate()` call returns `{ item: undefined }` and we
 *   skip the run (no duplicate dispatch).
 */
import { AgentRuntimeResolver, AgentService, Session, SessionRunStateMachine } from '../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { type TeamInboxDispatchService } from './team-protocol';
/**
 * Decide what to do with a paused rich queue when `agent_end` fires.
 *
 * Pure function so it can be unit-tested without spinning up a CellJS
 * container or mocking `RichMessageQueueManager` end-to-end. The dispatch
 * service consumes this decision and applies the side effects (resume + clear
 * lead-inbox flag) accordingly.
 *
 * Returns:
 *   - `'proceed'` — queue is not paused; carry on to the dispatch attempt.
 *   - `'auto-resume'` — paused with `pauseReason === 'cancel'`; the previous
 *     turn was cancelled and the agent is now idle (we're inside the
 *     `agent_end` callback), so unpause and continue.
 *   - `'skip'` — paused with any other reason (e.g. `'error'`); leave the
 *     pause in place and require an explicit resume.
 */
export declare function decidePausedQueueAction(runtime: {
    paused?: boolean;
    pauseReason?: string;
} | undefined): 'proceed' | 'auto-resume' | 'skip';
export declare class TeamInboxDispatchServiceImpl implements TeamInboxDispatchService {
    protected readonly logger: Logger;
    protected readonly agentService?: AgentService;
    protected readonly runtimeResolver?: AgentRuntimeResolver;
    protected readonly stateMachine: SessionRunStateMachine;
    /** Active run-state change subscriptions keyed by session id. */
    private readonly subscriptions;
    /** Session ids currently inside `runAutoDispatch` (re-entry guard). */
    private readonly dispatching;
    register(session: Session): void;
    unregister(sessionId: string): void;
    /**
     * Defer the dispatch attempt by one microtask. Concretely:
     * - The idle transition fans out to multiple subscribers (`markItemSent`
     *   on the rich queue, phase emitters, etc). Letting them run first means
     *   we observe the final post-turn state.
     * - It also guarantees the current call stack's `runStateSubject.next(...)`
     *   has fully returned, so nested `agentService.run` we may trigger cannot
     *   re-enter the subscriber synchronously.
     */
    private scheduleAutoDispatch;
    /**
     * Core dispatch logic. Called one microtask after `agent_end` emits.
     *
     * Guards (in order):
     *   1. Feature flag off  → skip.
     *   2. Not a team lead session → skip; regular UI queues are dispatched by
     *      the renderer owner via `activate_queue`.
     *   3. Re-entry (same session already dispatching) → skip.
     *   4. Compact in flight (`session.isCompressing`) → skip; compact's own
     *      continue-run will emit `agent_end` later and we'll get another shot.
     *   5. Rich queue container unresolved or missing → skip.
     *   6. Just cancelled but queue pause is not visible yet → skip; this avoids
     *      racing ahead of the renderer's `pause_queue` RPC.
     *   7. Queue paused (`runtime.paused`):
     *        - `pauseReason === 'cancel'` → the user cancelled the previous
     *          turn; we're now in the resulting `agent_end`, so auto-resume
     *          and let the queued items drain (fix for "queued messages
     *          remain stuck after cancel" bug). Also clears the lead-inbox
     *          paused flag so mailbox polling recovers.
     *        - any other reason (e.g. `'error'`) → skip; explicit resume
     *          required by user/UI.
     *   8. No `immediateItemId` and no `pending` / `sending` item → skip
     *      (nothing to dispatch).
     *
     * When all guards pass:
     *   - Call `activate(sessionId)`. This consumes `immediateItemId` first and
     *     falls back to the oldest `pending` item. If the UI beat us to it and
     *     the item already went out, `item` is `undefined` — we just return.
     *   - Convert the popped item's content blocks to a plain string and wrap
     *     it in a user message.
     *   - Call `AgentService.run()` to start a fresh independent turn. The
     *     resulting `agent_end` will re-enter this method to drain any leftover
     *     items, one per turn, in FIFO order.
     */
    private runAutoDispatch;
}
