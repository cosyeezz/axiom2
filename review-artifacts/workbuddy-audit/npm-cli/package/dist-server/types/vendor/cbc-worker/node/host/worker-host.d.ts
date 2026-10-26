import { type HeartbeatOptions, type NoticeHandler, type RequestHandler, type RequestOptions } from '../protocol/peer';
import type { AnyProtocol, NoticeName, NoticePayload, PayloadArgs, ProtocolSpec, RequestName, RequestPayload, RequestReply } from '../protocol/spec';
import { type WorkerLaunchOptions } from './launch';
export interface WorkerHostLogger {
    debug?(message: string): void;
    info?(message: string): void;
    warn?(message: string): void;
    error?(message: string): void;
}
export interface RestartOptions {
    /** Spawn a fresh worker after a death. Off: the host stays dead until `start()` is called again. */
    auto: boolean;
    /** Consecutive automatic restarts without a successful reply before the host gives up. */
    max: number;
    /** Delay before the n-th restart is `backoffMs * n`. */
    backoffMs: number;
}
export interface WorkerHostOptions {
    /** Log prefix. */
    name: string;
    /** The worker script, a string constant produced by `scripts/gen-worker-source.mjs`. */
    source: string;
    /** Expected value of the guest's `ready` frame; a different value is a build drift and is never restarted. */
    protocol: number;
    launch?: WorkerLaunchOptions;
    heartbeat?: HeartbeatOptions;
    restart?: RestartOptions;
    /** How long the guest may take to send `ready`. */
    readyTimeoutMs?: number;
    logger?: WorkerHostLogger;
}
export type WorkerHostState = 'idle' | 'starting' | 'ready' | 'dead';
export type DeathKind = 
/** `new Worker` threw. */
'spawn'
/** No `ready` frame within `readyTimeoutMs`. */
 | 'ready-timeout'
/** The guest's `ready` carried another protocol number (never restarted: the bundle drifted). */
 | 'protocol'
/** The worker emitted `error`. */
 | 'error'
/** The worker exited on its own. */
 | 'exit'
/** `missedLimit` pings went unanswered. */
 | 'heartbeat'
/** The application called `kill()` (a backstop it decided on); restart policy applies. */
 | 'killed'
/** `terminate()`: final, no restart. */
 | 'terminated';
export interface DeathInfo {
    kind: DeathKind;
    reason: string;
    /** A restart is scheduled; `onReady` fires again once the new worker handshakes. */
    willRestart: boolean;
    /** Number of automatic restarts already attempted since the last successful reply. */
    attempt: number;
    /** The generation that died; the next worker is `generation + 1`. */
    generation: number;
    cause?: unknown;
}
export interface ReadyInfo {
    /** Increments on every spawn; stamp application ids with it to reject the previous worker's leftovers. */
    generation: number;
}
/**
 * The main-thread owner of one worker: spawns it from a source string, speaks to it through a
 * host-role FramePeer (handshake, rid-correlated requests, notices, heartbeat), and turns any
 * sign of death into one path: the peer closes (every in-flight request rejects with
 * WorkerDeadError, every in-flight handler's signal aborts), `onDeath` listeners run, then a
 * restart is scheduled when the policy says so. What to replay into a fresh worker is the
 * application's business: it does that from `onReady`.
 *
 * A request deadline is not a death: it rejects that request (WorkerDeadlineError) and tells
 * the guest. An application that treats a missed deadline as a hung worker calls `kill()`.
 */
export declare class WorkerHost<S extends ProtocolSpec = AnyProtocol> {
    private readonly options;
    private worker?;
    private peer?;
    private currentGeneration;
    private currentState;
    private terminated;
    private readyPromise?;
    private readyResolve?;
    private readyReject?;
    private readyTimer?;
    private heartbeatPaused;
    private readonly requestHandlers;
    private readonly noticeHandlers;
    private readonly deathListeners;
    private readonly readyListeners;
    private restartAttempt;
    private restartTimer?;
    constructor(options: WorkerHostOptions);
    get state(): WorkerHostState;
    /** 0 before the first spawn, then the current worker's generation. */
    get generation(): number;
    /** Spawns the worker (idempotent while starting or ready) and resolves once it handshaked. */
    start(): Promise<void>;
    /** Sends a request and resolves with the guest's reply; rejects with WorkerReplyError, WorkerDeadlineError or WorkerDeadError. */
    request<K extends RequestName<S['host']>>(t: K, ...args: PayloadArgs<RequestPayload<S['host'], K>, RequestOptions>): Promise<RequestReply<S['host'], K>>;
    /** One-way frame to the guest; false when the worker is not ready to receive it. */
    notify<K extends NoticeName<S['host']>>(t: K, ...args: PayloadArgs<NoticePayload<S['host'], K>>): boolean;
    /** Answers the guest's requests of type `t`, across restarts; the handler's return value (or throw) becomes the reply. */
    onRequest<K extends RequestName<S['guest']>>(t: K, handler: RequestHandler<RequestPayload<S['guest'], K>, RequestReply<S['guest'], K>>): () => void;
    onNotice<K extends NoticeName<S['guest']>>(t: K, handler: NoticeHandler<NoticePayload<S['guest'], K>>): () => void;
    onDeath(listener: (info: DeathInfo) => void): () => void;
    /** Fires after every successful handshake, including the ones after a restart. */
    onReady(listener: (info: ReadyInfo) => void): () => void;
    /** Stops counting missed pongs (a worker busy in synchronous code cannot answer them). */
    pauseHeartbeat(): void;
    resumeHeartbeat(): void;
    /** Kills the current worker as an application decision (a backstop); the restart policy applies. */
    kill(reason: string): void;
    /** Kills the worker for good: no restart, `start()` rejects from now on. */
    terminate(): Promise<void>;
    private spawn;
    private onPeerOpen;
    private onPeerClose;
    private die;
    private log;
}
//# sourceMappingURL=worker-host.d.ts.map