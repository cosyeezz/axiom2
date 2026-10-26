/**
 * Cross-process connection lock for WeCom AI Bot instances.
 *
 * A WeCom bot (bot_id + secret) only tolerates ONE active WebSocket subscriber:
 * a second subscribe makes the server kick the first one via `disconnected_event`.
 *
 * Because the per-instance `autoConnect` flag lives in the shared
 * `~/.codebuddy/channels/wecom/instances.json`, every CBC process that starts on
 * the same machine would otherwise auto-connect and stomp on a bot that another
 * still-alive process is already serving. This lock makes ownership explicit:
 *
 *   - auto-connect may not steal from a live foreign holder (it yields),
 *   - a stale holder (dead pid / different host) is reclaimed,
 *   - an explicit manual connect may force-take-over.
 */
export type WecomConnectionLockAcquireResult = 'acquired' | 'held-by-live-other';
export interface WecomConnectionLockDeps {
    homeDir?: string;
    now?: () => number;
    pid?: number;
    host?: string;
    /** Override for tests; defaults to a `process.kill(pid, 0)` probe. */
    isPidAlive?: (pid: number) => boolean;
}
export declare class WecomConnectionLock {
    private readonly holderId;
    private readonly pid;
    private readonly host;
    private readonly now;
    private readonly isPidAlive;
    private readonly filePath;
    constructor(instanceId: string, deps?: WecomConnectionLockDeps);
    /**
     * Claim ownership of the connection.
     *
     * @param force - True for an explicit user action; it takes over even when a
     *   live foreign process currently holds the lock.
     */
    acquire(force?: boolean): WecomConnectionLockAcquireResult;
    /** Release the lock, but only if this instance is still the recorded holder. */
    release(): void;
    /** Whether this instance still owns the lock file. */
    isHolder(): boolean;
    /**
     * The live local process that currently holds the lock, if it is not us.
     * Used after being kicked off the bot to tell "a local process took it over"
     * (it will leave, so waiting and reconnecting is safe) from "someone elsewhere
     * took it" (we cannot know when it leaves, so stay down).
     */
    foreignLiveHolder(): {
        pid: number;
    } | undefined;
    private read;
    private write;
    /**
     * A foreign holder is only considered live when the lock came from this host
     * and its pid is still running. Records from another host cannot be probed
     * locally, so they are treated as reclaimable.
     */
    private isForeignHolderAlive;
}
