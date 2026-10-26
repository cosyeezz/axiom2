/**
 * `packages/agent-cli/src/node/cli/mods-lifecycle-observer.ts`
 *
 * ## Purpose
 *
 * The mod runtime (`packages/cbc-plugins`) already dispatches a handful of
 * middleware events at their real trigger sites (`session.start` /
 * `session.end` from the terminal-play + prompt-context bridges;
 * `tool.call` / `prompt.submit` / `prompt.context` from their respective
 * pipelines). What's still missing is the **turn lifecycle** — mod authors
 * write `on('turn.start', …)` / `on('turn.complete', …)` and expect a fire
 * for every model turn, but no place in cbc-core dispatches them yet.
 *
 * Rather than plant a `runtime.dispatch('turn.start', …)` call inside
 * `AgentService.run()` (a 1400-line function whose control flow already
 * juggles admission, cancellation, retry and compact), we hook onto the
 * `SessionRunStateMachine` observable that cbc-core already exposes for
 * exactly this shape of observer. The state machine is the single source of
 * truth for "a run is preparing", "a run is done", etc.; it emits one event
 * per legal transition. We map the transitions we care about to broker
 * `fireX()` calls.
 *
 * ## Mapping
 *
 * | State machine transition | Mod event | Payload |
 * |---|---|---|
 * | `RUN_PREPARING` (session becomes PREPARING) | `turn.start` | `{ turnId, agentId, prompt? }` |
 * | terminal → `IDLE` after any of `RUN_FAILED` / `FORCE_IDLE` / `AGENT_ENDED` / `MODEL_RESPONSE_DONE` | `turn.complete` | `{ turnId, agentId, reason, isAborted, durationMs, answer, usage }` |
 *
 * `turnId` uses the state machine's own `runId` (which is stable through
 * the terminal transition per the protocol contract), keeping start / end
 * correlatable.
 *
 * ## Why not fire more transitions
 *
 * The state machine also emits `TOOL_STARTED` / `TOOL_ENDED` /
 * `MODEL_REQUEST_STARTED`, but those correspond to `tool.call` / model I/O
 * events that are already dispatched at their real sites; firing them from
 * here would double-count. `session.attach` / `session.detach` are a remote
 * client joining the roster (the Web UI's first ask to draw, in AcpAgent);
 * the terminal's attachment is the REPL binding and raises nothing.
 *
 * ## Lifecycle
 *
 * Bootstrap installs one observer per session (subscribed on
 * `SessionManager.sessionSubject`). When the session changes we tear the
 * subscription down and rebuild for the new session; the previous session
 * has already fired its terminal `turn.complete` by then.
 *
 * Errors thrown from the broker are swallowed — mod misbehaviour must not
 * break cbc's run loop. The broker itself already swallows; we add a
 * defensive `.catch()` at the outer boundary for belt-and-braces.
 */
import type { Session, SessionManager, SessionRunStateMachine } from '../../vendor/cbc-core/node/index.js';
/** `$.session.usage()` as the host computes it: what `session.measure` carries after a turn. */
export type ModsUsageReader = () => Promise<unknown>;
/**
 * Wire up state-machine → mod-event observers on the given session
 * manager. Returns a teardown function that unsubscribes all observers.
 *
 * Safe to call multiple times — each call installs an independent chain
 * (the caller is responsible for holding onto the returned teardown).
 */
export declare function installModsLifecycleObserver(sessionManager: Pick<SessionManager, 'sessionSubject'> & Partial<Pick<SessionManager, 'flushHistory' | 'recordModLogMessage'>>, stateMachine: Pick<SessionRunStateMachine, 'getChange$' | 'getSnapshot'>, readUsage?: ModsUsageReader): () => void;
/** The text of the last assistant message: official `TurnCompleteInput.answer`. */
export declare function extractAnswer(session: Pick<Session, 'history'>): string;
