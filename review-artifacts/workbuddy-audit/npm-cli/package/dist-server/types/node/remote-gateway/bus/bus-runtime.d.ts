/**
 * Process-local bus singletons and the app-stream entry points.
 *
 * Kept apart from the transport (`local-bus-service`) so producers can publish
 * without pulling the WebSocket/cell dependencies into their module graph. The
 * journal and broadcaster are process-wide on purpose: the gateway is the only
 * owner of every conversation, and every page subscribes to the same streams.
 *
 * The directory streams are produced by the controllers that already own that
 * data (`local-jobs-controller` / `local-agent-home-controller`): they hand a
 * collector over and get back a handle to stop. This module keeps the two
 * policies those callers should not each re-decide — a stopped handle when the
 * bus is off or when this process is a job worker, and the re-anchor hook that
 * lets an overrun app stream heal without asking the page to resync.
 */
import { type AppStreamPublisher, type BusAppStream, type LoggerLike } from './app-streams';
import { type BusResyncReason } from './bus-protocol';
import { BusEventJournal, type BusJournalAppendOptions } from './event-journal';
import { BusSessionBroadcaster } from './session-broadcaster';
export interface AgentSessionChangedPayload {
    jobId: string;
    sessionId: string;
}
/**
 * Publish the authoritative session currently shown by one background agent.
 *
 * The ACP session itself is owned by a worker, but the selected session is UI
 * state. Keeping that state in the gateway lets pages in different browsers
 * converge instead of relying on sessionStorage/localStorage. The controller
 * also persists the selectedSessionId in the job state before publishing, so
 * a refresh or gateway restart can recover the same value. Volatile is
 * intentional: live pages receive the change immediately without replaying a
 * stale selection after reconnect; late pages read the persisted job value.
 * `force` is reserved for the POST rebind handshake: a refreshed embedded page
 * may report the same selection again, and sibling pages still need that edge.
 */
export declare function publishAgentSessionChanged(jobId: string, sessionId: string, options?: {
    force?: boolean;
}): void;
export declare function getAgentSessionId(jobId: string): string | undefined;
export declare function getBusJournal(): BusEventJournal;
export declare function getBusBroadcaster(): BusSessionBroadcaster;
/**
 * Publish an event to every page subscribed to that stream id.
 *
 * Silent no-op when the bus is switched off: producers stay transport-agnostic
 * and cannot accidentally keep a disabled bus alive.
 */
export declare function publishBusEvent(streamId: string, event: {
    event: string;
    data: unknown;
}, options?: BusJournalAppendOptions): void;
/** Tell subscribers a stream's content was replaced; they must resync. */
export declare function resyncBusStream(streamId: string, reason: BusResyncReason): void;
/** Frame writer for app streams: `{ event, data }` payloads, same as the SSE endpoints. */
export declare const publishAppStream: AppStreamPublisher;
/**
 * Start the jobs-directory producer. The controller supplies the collector so the
 * stream and the SSE endpoint diff exactly the same entries.
 */
export declare function startJobsBusStream<T extends {
    id: string;
}>(collect: () => Promise<readonly T[]>, logger?: LoggerLike): BusAppStream;
/** Start the Agent Home activity producer (same mapping the SSE endpoint publishes). */
export declare function startAgentHomeBusStream(read: () => Promise<Record<string, unknown> | undefined>, logger?: LoggerLike): BusAppStream;
export declare function stopBusAppStreams(): void;
/** Test seam: drop the singletons so specs start from a clean journal. */
export declare function resetBusRuntimeForTests(): void;
