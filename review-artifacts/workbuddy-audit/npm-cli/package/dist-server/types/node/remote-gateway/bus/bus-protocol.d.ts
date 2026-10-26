/**
 * WebSocket bus protocol (frozen contract, protocol 1).
 *
 * One connection per page carries every long-lived subscription the UI needs —
 * the jobs directory, the agent-home directory and the conversations on screen.
 * The page origin gives the browser six HTTP/1.1 connections and the page already
 * spends them on ACP streams and terminals, so multiplexing turns "N streams per
 * document" into exactly one, which is what makes several pages (and
 * remote/tunnel access) work without extra origins or HTTP/2.
 *
 * Wire shape is fixed by docs/webui-agent-view-contract.md §1: JSON envelopes,
 * an explicit protocol version, a per-stream cursor so a reconnecting page can
 * continue instead of replaying a conversation, and an explicit resync signal
 * when continuity cannot be proven.
 */
/** Upgrade path; the HTTP server claims it from its `upgrade` event. */
export declare const BUS_PATH = "/api/v1/bus";
/** Bump when the frame shapes below change in a breaking way. */
export declare const BUS_PROTOCOL_VERSION = 1;
/** Server ping cadence (and the app-stream keepalive cadence). */
export declare const BUS_HEARTBEAT_MS = 15000;
/** Frames a single subscriber may have queued before it is considered slow. */
export declare const BUS_MAX_EVENT_BUFFER_SIZE = 512;
/**
 * Reserved stream ids for the app-level (non-conversation) streams.
 *
 * A stream id is either a conversation sessionId or one of these reserved
 * names; the journal, cursors and fan-out treat them identically, which is what
 * lets a page carry its whole long-lived surface on one socket.
 */
export declare const BUS_APP_JOBS_STREAM = "app:jobs";
export declare const BUS_APP_AGENT_HOME_STREAM = "app:agent-home";
/** Cross-page current-session notifications for background agent frames. */
export declare const BUS_APP_AGENT_SESSION_STREAM = "app:agent-session";
/** Volatile "Git status of a repository changed" signals; pages refetch on receipt. */
export declare const BUS_APP_GIT_STREAM = "app:git";
/** Why the server cannot bridge a cursor; the client answers by re-snapshotting. */
export type BusResyncReason = 'buffer_overflow' | 'session_recreated' | 'epoch_changed';
/**
 * Server → client frames.
 *
 * `event` carries the business payload as `{ event, data }` — the same pair the
 * SSE endpoints emit, so app streams keep one parser on the client.
 */
export interface BusServerHelloFrame {
    type: 'server_hello';
    protocol: number;
    /** Process-lifetime id; a change means every cursor is worthless. */
    epoch: string;
    heartbeatMs: number;
    maxEventBufferSize: number;
    capabilities: {
        eventBatching: boolean;
    };
}
export interface BusSubscribeDeniedFrame {
    type: 'subscribe_denied';
    /** Echo of the subscribe frame whose stream ids were not authorized. */
    id: string;
    streamIds: string[];
}
export interface BusAckFrame {
    type: 'ack';
    /** Echo of the subscribe/unsubscribe frame id. */
    id: string;
    /** Streams now live on this connection. */
    streams: string[];
}
export interface BusEventFrame {
    type: 'event';
    streamId: string;
    seq: number;
    epoch: string;
    /** Token-level deltas: delivered live, never retained, must not be awaited. */
    volatile?: true;
    /** Start offset of this delta inside the accumulated text (volatile chunks). */
    offset?: number;
    event: {
        event: string;
        data: unknown;
    };
    ts: string;
}
export interface BusResyncRequiredFrame {
    type: 'resync_required';
    /** Echo of the subscribe frame that could not be served, when there was one. */
    id?: string;
    streamId: string;
    reason: BusResyncReason;
    /** Server-side seq the client should treat as the new anchor. */
    currentSeq: number;
    epoch?: string;
}
export interface BusPingFrame {
    type: 'ping';
    nonce: string;
}
export type BusServerFrame = BusServerHelloFrame | BusAckFrame | BusSubscribeDeniedFrame | BusEventFrame | BusResyncRequiredFrame | BusPingFrame;
/** Client → server frames. */
export interface BusClientHelloFrame {
    type: 'client_hello';
    protocol: number;
    clientId: string;
    /** ACP connection binding; required by the authenticated gateway bus. */
    connectionId?: string;
    sessionToken?: string;
}
/** Per-stream resume point; `epoch` is what the snapshot carried. */
export interface BusStreamCursor {
    seq: number;
    epoch?: string;
}
export interface BusSubscribeFrame {
    type: 'subscribe';
    id: string;
    streamIds: string[];
    cursors?: Record<string, BusStreamCursor>;
}
export interface BusUnsubscribeFrame {
    type: 'unsubscribe';
    id?: string;
    streamIds: string[];
}
export interface BusPongFrame {
    type: 'pong';
    nonce: string;
}
export type BusClientFrame = BusClientHelloFrame | BusSubscribeFrame | BusUnsubscribeFrame | BusPongFrame;
/** Per-frame limits: a page never needs thousands of ids in one subscribe. */
export declare const BUS_MAX_STREAM_IDS_PER_FRAME = 200;
/** Env switch: `CODEBUDDY_WEB_UI_BUS=0` falls back to the legacy transports. */
export declare function isBusEnabled(): boolean;
/**
 * Validate an inbound client frame.
 *
 * The bus is reachable from any page on the gateway origin, so the parser is
 * deliberately strict: anything malformed is dropped instead of guessed at.
 */
export declare function parseBusClientFrame(raw: string): BusClientFrame | null;
/** DI token: other modules reach the bus through this. */
export declare const GatewayBusService: unique symbol;
