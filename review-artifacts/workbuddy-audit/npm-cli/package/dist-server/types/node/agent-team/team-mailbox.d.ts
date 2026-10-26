import { Logger } from '@genie/telemetry';
import { InboxMessage, TeamMailbox } from './team-protocol';
/**
 * File-system based mailbox for Agent Team communication.
 *
 * Each team member has an inbox file at:
 *   ~/.codebuddy/teams/{teamName}/inboxes/{memberName}.json
 *
 * Inbox files are JSON arrays of InboxMessage objects.
 * New messages are appended to the array; the poller detects new unread entries.
 */
export declare class TeamMailboxImpl implements TeamMailbox {
    protected readonly logger: Logger;
    /** Active polling timers keyed by "{teamName}/{memberName}" */
    private pollers;
    /** In-process serialization for same-inbox read-modify-write operations. */
    private readonly mutationTails;
    /** Poll ticks and explicit wake-ups share this same-inbox consumer lane. */
    private readonly consumerTails;
    init(): void;
    send(teamName: string, recipient: string, message: Omit<InboxMessage, 'read'>): Promise<void>;
    broadcast(teamName: string, sender: string, message: Omit<InboxMessage, 'read'>): Promise<string[]>;
    getUnread(teamName: string, memberName: string): Promise<InboxMessage[]>;
    getAll(teamName: string, memberName: string): Promise<InboxMessage[]>;
    acknowledge(teamName: string, memberName: string, messageIds: readonly string[]): Promise<number>;
    deliverUnreadOnce(teamName: string, memberName: string, callback: (messages: InboxMessage[]) => void | Promise<void>): Promise<boolean>;
    markAllAsRead(teamName: string, memberName: string): Promise<void>;
    createInbox(teamName: string, memberName: string): Promise<void>;
    startPolling(teamName: string, memberName: string, callback: (messages: InboxMessage[]) => void | Promise<void>, intervalMs?: number): () => void;
    private stopPolling;
    private loadInbox;
    private readInboxFile;
    /** Deterministic migration identity for one append-only legacy row. */
    private deriveLegacyMessageId;
    private withInboxMutex;
    private writeInbox;
    /**
     * Async existence probe replacing `existsSync` (lint rule `genie-n/no-sync`).
     * `access` rejects when the path is missing or unreadable; we treat both
     * as "not present" since callers only need a boolean.
     */
    private pathExists;
}
