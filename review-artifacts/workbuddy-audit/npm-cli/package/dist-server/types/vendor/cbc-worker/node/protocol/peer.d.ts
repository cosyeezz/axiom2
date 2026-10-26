import type { AnyChannel, ChannelSpec, NoticeName, NoticePayload, PayloadArgs, RequestName, RequestPayload, RequestReply } from './spec';
/** A Worker, `parentPort`, or a MessagePort. */
export interface PeerPort {
    postMessage(value: unknown): void;
    on(event: 'message', listener: (value: unknown) => void): unknown;
    off?(event: 'message', listener: (value: unknown) => void): unknown;
}
export type PeerRole = 'host' | 'guest';
export interface PeerLogger {
    debug?(message: string): void;
    warn?(message: string): void;
}
export interface PeerOptions {
    role: PeerRole;
    /** Sent in `ready` by the guest, compared against it by the host. */
    protocol: number;
    /** Log prefix. */
    name?: string;
    logger?: PeerLogger;
}
export type PeerState = 'connecting' | 'open' | 'closed';
export type PeerCloseKind = 
/** The guest's `ready` frame carried another protocol number, or the first frame was not `ready`. */
'protocol'
/** Consecutive pings went unanswered. */
 | 'heartbeat'
/** The owner closed the peer (worker died, terminated, or a deliberate `close`). */
 | 'closed';
export interface PeerCloseInfo {
    kind: PeerCloseKind;
    reason: string;
    cause?: unknown;
}
export interface RequestContext {
    rid: string;
    /** Aborts when the requester sends `request.abort` or the peer closes. */
    signal: AbortSignal;
}
export type RequestHandler<P, R> = (payload: P, context: RequestContext) => R | Promise<R>;
export type NoticeHandler<P> = (payload: P) => void;
export interface RequestOptions {
    /** Abandons the request: rejects locally with an AbortError and tells the other side. */
    signal?: AbortSignal;
    /**
     * Rejects with WorkerDeadlineError when no reply arrived in time and tells the other side.
     * The peer stays open: a slow request is not evidence that the worker is gone.
     */
    deadlineMs?: number;
}
export interface HeartbeatOptions {
    intervalMs: number;
    missedLimit: number;
}
export declare class FramePeer<Out extends ChannelSpec = AnyChannel, In extends ChannelSpec = AnyChannel> {
    private readonly port;
    private readonly options;
    private currentState;
    private closeInfo?;
    private seq;
    private readonly pending;
    private readonly inflight;
    private readonly requestHandlers;
    private readonly noticeHandlers;
    private readonly openListeners;
    private readonly closeListeners;
    private readonly openPromise;
    private resolveOpen;
    private rejectOpen;
    private readonly listener;
    private heartbeatTimer?;
    private heartbeatPaused;
    private heartbeatSeq;
    private heartbeatOutstanding;
    private heartbeatMissed;
    constructor(port: PeerPort, options: PeerOptions);
    get state(): PeerState;
    get role(): PeerRole;
    /** Resolves once the connection is open (immediately for a guest); rejects if it closed first. */
    whenOpen(): Promise<void>;
    /** Guest role: sends the handshake. Call it once every handler is installed. */
    ready(): void;
    onOpen(listener: () => void): () => void;
    onClose(listener: (info: PeerCloseInfo) => void): () => void;
    request<K extends RequestName<Out>>(t: K, ...args: PayloadArgs<RequestPayload<Out, K>, RequestOptions>): Promise<RequestReply<Out, K>>;
    /** One-way frame; false when the peer is not open. */
    notify<K extends NoticeName<Out>>(t: K, ...args: PayloadArgs<NoticePayload<Out, K>>): boolean;
    /** Answers the other side's requests of type `t`; the return value (or throw) becomes the reply. */
    onRequest<K extends RequestName<In>>(t: K, handler: RequestHandler<RequestPayload<In, K>, RequestReply<In, K>>): () => void;
    onNotice<K extends NoticeName<In>>(t: K, handler: NoticeHandler<NoticePayload<In, K>>): () => void;
    /** Rejects every pending outbound request with an Error carrying `reason`; the peer stays open. */
    abortAll(reason: string): void;
    /** Host role: pings on an interval; `missedLimit` unanswered pings in a row close the peer. */
    startHeartbeat(heartbeat: HeartbeatOptions): void;
    stopHeartbeat(): void;
    /** Stops counting missed pongs (a worker busy in synchronous code cannot answer them). */
    pauseHeartbeat(): void;
    resumeHeartbeat(): void;
    /**
     * Closes the peer: pending requests reject with WorkerDeadError, in-flight handlers see their
     * signal abort, close listeners run once. Idempotent.
     */
    close(reason: string, kind?: PeerCloseKind, cause?: unknown): void;
    private onMessage;
    private reply;
    private postAbort;
    private post;
    private clearPending;
    private log;
}
//# sourceMappingURL=peer.d.ts.map