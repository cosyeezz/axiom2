/**
 * Frame envelope shared by both ends of a worker connection (the main-thread host and the
 * worker-side guest speak it through the same FramePeer):
 *
 *   request              { t, rid, ...payload }      answered by { t: `${t}.result`, rid, ok, value | error }
 *   notice               { t, ...payload }           no answer
 *   request.abort        { t: 'request.abort', rid } the requester gave up; the handler's signal aborts
 *   handshake            { t: 'ready', protocol }    the guest's first frame; a mismatch closes the peer
 *   heartbeat            { t: 'ping', seq } / { t: 'pong', seq }   host asks, guest answers
 *
 * Every frame is plain JSON (structured-clone safe, no functions, no Buffers).
 */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | {
    [key: string]: JsonValue;
};
export interface JsonObject {
    [key: string]: JsonValue;
}
export declare const READY_TYPE = "ready";
export declare const PING_TYPE = "ping";
export declare const PONG_TYPE = "pong";
/** Notice that a pending request was abandoned by its requester; carries the request's rid. */
export declare const REQUEST_ABORT_TYPE = "request.abort";
export declare const REPLY_SUFFIX = ".result";
/** Frame keys the envelope owns; a payload may not redefine them. */
export declare const RESERVED_KEYS: ReadonlySet<string>;
export declare function replyType(t: string): string;
export declare function isReplyType(t: string): boolean;
export interface ReadyFrame {
    t: typeof READY_TYPE;
    protocol: number;
}
export interface ReplyErrorShape {
    name: string;
    message: string;
    stack?: string;
}
export interface ReplyFrame {
    t: string;
    rid: string;
    ok: boolean;
    value?: unknown;
    error?: ReplyErrorShape;
}
/**
 * True for values that survive the boundary unchanged: JSON primitives, arrays and plain
 * objects (from this realm or a vm context's), nested at most 64 levels and acyclic. Class
 * instances, Dates, Maps, Buffers, typed arrays, functions and symbols are refused so a
 * caller never relies on structured clone preserving something the realm boundary will
 * flatten anyway. An `undefined` property value or array item is tolerated: structured clone
 * carries it as is, and JSON would drop or null it, as an optional field would be.
 */
export declare function isJsonValue(value: unknown, depth?: number, seen?: Set<object>): value is JsonValue;
/**
 * A request or notice payload as callers type it: any object whose members are plain JSON at
 * runtime. Typed loosely on purpose, so interfaces without an index signature (a tools
 * catalog, a request record) pass without casts; `assertPayload` is the real gate.
 */
export type Payload = Record<string, unknown>;
/** Validates a request or notice payload before it is spread into an envelope. */
export declare function assertPayload(t: string, payload: unknown): asserts payload is Payload;
/** Flattens any thrown value into the error shape a reply frame carries. */
export declare function toReplyError(error: unknown): ReplyErrorShape;
/** The worker is gone (crashed, exited, timed out, killed); every in-flight request ends with this. */
export declare class WorkerDeadError extends Error {
    readonly reason: string;
    readonly name = "WorkerDeadError";
    constructor(reason: string, options?: {
        cause?: unknown;
    });
}
/** A request's deadline passed. The worker is not killed for it; the requester decides what follows. */
export declare class WorkerDeadlineError extends Error {
    readonly request: string;
    readonly deadlineMs: number;
    readonly name = "WorkerDeadlineError";
    constructor(request: string, deadlineMs: number);
}
/** The other side answered a request with `ok: false`. */
export declare class WorkerReplyError extends Error {
    readonly name: string;
    readonly remoteStack?: string;
    constructor(shape: ReplyErrorShape);
}
//# sourceMappingURL=frames.d.ts.map