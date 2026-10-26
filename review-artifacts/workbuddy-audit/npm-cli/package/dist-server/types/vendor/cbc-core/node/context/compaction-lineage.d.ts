import type { CompactionKind, CompactionTrigger } from '@genie/telemetry';
import type { Session } from '../session/session-protocol';
export type { CompactionKind, CompactionTrigger };
export declare function compactionKindOf(trigger: CompactionTrigger): CompactionKind;
/** Compactions of a Session's context. Never resets, like `modelStepSeq`. */
export interface CompactionLineage {
    /** Completed compactions. */
    count: number;
    /** Compaction the current context starts from. */
    lastId?: string;
    /** Trigger of the completed compaction the next agent-loop model call reports. */
    pending?: CompactionTrigger;
}
type LineageSession = Pick<Session, 'id' | 'history' | 'compactionLineage' | 'meta'>;
/** Compaction lineage of `session`, restored from its history after resume. */
export declare function getCompactionLineage(session: LineageSession): CompactionLineage;
/**
 * Numbers a compaction boundary item before it enters history and stamps the running
 * compaction onto it; the next agent-loop model call reports it.
 */
export declare function recordCompactionBoundary(session: LineageSession, providerData: Record<string, unknown>): void;
/** Compaction lineage of one model call (gateway headers, `chat_message_send`). */
export interface ModelCallCompaction {
    /** Completed compactions of the Session when the call is sent. */
    readonly count: number;
    /** Compaction the call's context starts from. */
    readonly id?: string;
    /** Compaction calls: class of the running compaction (`X-Compaction`). */
    readonly kind?: CompactionKind;
    /** First agent-loop call after a compaction: its class (`X-Context-Compacted`) and trigger. */
    readonly contextCompacted?: CompactionKind;
    readonly trigger?: CompactionTrigger;
}
/**
 * Compaction lineage for the model call in the current async chain. Only the first
 * agent-loop call after a compaction reports it, like Claude Code's
 * `consumePendingContextCompacted`.
 */
export declare function resolveModelCallCompaction(session: LineageSession & Pick<Session, 'agentPurpose' | 'conversationRequestId'>): ModelCallCompaction;
//# sourceMappingURL=compaction-lineage.d.ts.map