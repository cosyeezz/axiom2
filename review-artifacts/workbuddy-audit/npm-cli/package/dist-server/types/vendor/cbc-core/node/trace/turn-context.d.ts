import type { AcpCancelReason } from '../../../cbc-shared/node/index.js';
import { type W3CTraceContextMeta } from '@genie/telemetry';
import type { Context } from '@opentelemetry/api';
import type { Session } from '../session/session-protocol';
/**
 * Per-turn W3C trace context (ACP v2 `_meta` reserved keys: `traceparent`,
 * `tracestate`, `baggage`).
 *
 * Deliberately NOT a Cell component: like the server surface's `rootScope`
 * (sandbox.ts), this is a plain module-level AsyncLocalStorage anchored on
 * `globalThis` so bundled and lib compositions share one scope.
 *
 * Ownership model: request boundaries enter a turn scope with
 * {@link runWithTurnContext}; admission publishes the exact request owner to the
 * per-request registry through {@link bindCurrentTurnContext}. Exit boundaries
 * either read the ambient turn ({@link currentTurnCarrier}) for outbound reads,
 * or look the carrier up by the frame's own request id
 * ({@link turnCarrierForRequest}) for delayed emits that cannot retain the scope.
 *
 * Queue semantics (Option X): a queued prompt carries its own carrier through
 * the message queue on `providerData[TURN_CARRIER_CANDIDATE_KEY]`; at drain the
 * pipeline re-enters that exact carrier via {@link runWithTurnContext} before
 * admission binds it. Queued prompts never inherit the active turn's carrier.
 */
export interface TurnContext {
    /** The three W3C keys exactly as received at the request boundary. */
    readonly inboundCarrier: Readonly<W3CTraceContextMeta>;
    /**
     * Live OTel context: inbound remote span (when the boundary supplied a
     * valid traceparent) plus baggage; TraceStartHook swaps in the local
     * interaction root span once it exists.
     */
    otelContext: Context;
    readonly session: Session;
    /** Canonical id assigned when the external user input is admitted. */
    conversationRequestId?: string;
}
export interface RequestOwner {
    readonly session: Session;
    readonly requestId: string;
    readonly turn: TurnContext;
    latestExecution?: object;
    /** An internal guard stopped this attempt; a client cancellation takes precedence. */
    termination?: {
        stopReason: 'error' | 'max_tokens';
        cancelReason: AcpCancelReason;
    };
}
export type RequestTerminalOutcome = 'written' | 'failed' | 'unconfirmed';
export interface RequestTerminal {
    readonly attempt: object;
    outcome?: RequestTerminalOutcome;
    readonly completed: Promise<RequestTerminalOutcome>;
}
export declare function getRequestOwner(ref: object): RequestOwner | undefined;
export declare function getRequestExecution(ref: object): object | undefined;
export declare function associateRequestOwner(ref: object, owner: RequestOwner, execution?: object): void;
/** Carry physical execution through admission without inventing a request owner. */
export declare function associateRequestExecution(ref: object, execution: object): void;
/** Reserve completion ownership at admission, retaining the prior result if startup fails. */
export declare function beginRequestExecution(owner: RequestOwner, execution: object): void;
/** A failed startup never owns a result; restore only the execution it actually replaced. */
export declare function abandonRequestExecution(execution: object): Session['resultSubject']['value'];
export declare function getRequestTerminal(owner: RequestOwner, destination: string): RequestTerminal | undefined;
export declare function claimRequestTerminal(owner: RequestOwner, destination: string, attempt: object): boolean;
export declare function settleRequestTerminal(owner: RequestOwner, destination: string, attempt: object, outcome: RequestTerminalOutcome): void;
/** The admission boundary, not trace binding, creates a new logical request. */
export declare function admitRequestOwner(session: Session, requestId: string): RequestOwner;
export declare function runInRequestOwner<T>(owner: RequestOwner, callback: () => T): T;
/** Transient provider-data key; stripped before history/model persistence. */
export declare const TURN_CARRIER_CANDIDATE_KEY = "codebuddy.ai/turnCarrierCandidate";
export declare const BAGGAGE_KEY_SESSION_ID = "codebuddy.session_id";
export declare const BAGGAGE_KEY_CONVERSATION_REQUEST_ID = "codebuddy.conversation_request_id";
/** Per-inference id; lives in spawn-time baggage snapshots, never in turn-level baggage. */
export declare const BAGGAGE_KEY_CONVERSATION_MESSAGE_ID = "codebuddy.conversation_message_id";
/** Main-turn aggregation key; inherited by subagent/team, stable within a user turn. */
export declare const BAGGAGE_KEY_ROOT_REQUEST_ID = "codebuddy.root_request_id";
/**
 * Read the three reserved W3C keys from an ACP `_meta`-shaped object.
 *
 * A present root `traceparent` key is authoritative even when malformed —
 * `legacyTraceparent` (vendor-prefixed mirrors, synthesized legacy ids) fills
 * in only when the root key is absent entirely.
 */
export declare function normalizeTurnCarrier(meta: Record<string, unknown> | null | undefined, legacyTraceparent?: unknown): W3CTraceContextMeta;
/** Convert legacy `traceId`/`parentSpanId` request fields into a W3C traceparent. */
export declare function synthesizeTraceparent(traceId?: string, parentSpanId?: string): string | undefined;
export declare function hasTurnCarrier(carrier: Readonly<W3CTraceContextMeta>): boolean;
/**
 * Write the carrier onto an outgoing `_meta`. Standard W3C root keys only,
 * plus the `codebuddy.ai/traceparent` vendor mirror kept for older WorkBuddy
 * renderers — delete the mirror once they read the root `traceparent` key.
 */
export declare function applyTurnCarrierToMeta(meta: Record<string, unknown>, carrier: Readonly<W3CTraceContextMeta>): void;
/**
 * Enter a turn scope for one request. The context carries the inbound remote
 * span only when the boundary supplied a valid traceparent — a purely local
 * turn stays parentless so its interaction span is a true root.
 *
 * `extraBaggage` entries (e.g. the /server run id) fill in only when the
 * inbound baggage does not already carry the key: baggage correlates to the
 * origin turn across nested agents, so upstream values win on the wire.
 */
export declare function runWithTurnContext<T>(carrier: Readonly<W3CTraceContextMeta>, session: Session, callback: () => T, extraBaggage?: Readonly<Record<string, string>>): T;
export declare function currentTurnContext(): TurnContext | undefined;
/**
 * Re-enter a previously captured turn for admission/emit work that runs detached
 * from the turn's original async chain (e.g. the ACP `inputSubject` admission
 * callback, which fires from `addHistory` outside `runWithItemTurnContext`).
 * `undefined` exits any ambient turn so a detached callback cannot borrow a
 * concurrent turn.
 */
export declare function runInTurnContext<T>(turn: TurnContext | undefined, callback: () => T): T;
/** Bind the active exact-session turn to the admitted canonical request id. */
export declare function bindCurrentTurnContext(session: Session, conversationRequestId: string): void;
/** Carrier for one exact admitted request; never returns the latest other turn. */
export declare function turnCarrierForRequest(session: Session, conversationRequestId: string | undefined): W3CTraceContextMeta;
/** Release an exact request binding. */
export declare function releaseTurnContext(session: Session, conversationRequestId: string | undefined, owner?: RequestOwner): void;
/** The current turn as an injectable three-key carrier; `{}` outside a turn. */
export declare function currentTurnCarrier(): W3CTraceContextMeta;
/**
 * Carrier of the session's most recently admitted turn, for legacy emitters
 * that run outside the turn's async chain. New response paths should use the
 * exact request lookup instead.
 */
export declare function turnCarrierForSession(session: Session): W3CTraceContextMeta;
/**
 * Return a copy of an outbound frame with the carrier of the session's most
 * recently admitted turn (see turnCarrierForSession) merged into `_meta`. This
 * is a legacy best-effort helper; exact response paths should use the request
 * lookup. Returns the frame unchanged without a live turn.
 */
export declare function withTurnCarrier<T extends {
    _meta?: Record<string, unknown> | null;
}>(session: Session, frame: T): T;
/**
 * Swap the live OTel context of the current turn in place (TraceStartHook
 * installs the interaction root span here). Per-session readers observe the
 * update because the turn object is shared, not copied.
 */
export declare function updateTurnOtelContext(context: Context): void;
/**
 * Run a callback with a derived context (e.g. the per-call execute-tool span)
 * without disturbing the enclosing turn. No-op passthrough outside a turn.
 */
export declare function runWithTurnOtelContext<T>(context: Context, callback: () => T): T;
//# sourceMappingURL=turn-context.d.ts.map