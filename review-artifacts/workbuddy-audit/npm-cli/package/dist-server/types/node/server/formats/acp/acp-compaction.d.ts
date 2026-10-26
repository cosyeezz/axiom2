import type { ContentBlock, SessionNotification } from '@agentclientprotocol/sdk';
import { CompactType } from '../../../../vendor/cbc-core/node/index.js';
export declare const CODEBUDDY_SESSION_COMPACT_METHOD: "_codebuddy.ai/session/compact";
export declare const CODEBUDDY_COMPACTION_UPDATE_TYPE: "compaction_update";
export declare const CODEBUDDY_COMPACTION_TYPE_META_KEY: "codebuddy.ai/compactType";
export declare const CODEBUDDY_COMPACTION_TRIGGER_META_KEY: "codebuddy.ai/trigger";
/** Use the locked SDK's standard wire shape and open status type. */
export type AcpCompactionUpdate = Extract<SessionNotification['update'], {
    sessionUpdate: 'compaction_update';
}>;
export type AcpCompactionStatus = AcpCompactionUpdate['status'];
export type AcpCompactionTrigger = 'manual' | 'auto';
export interface AcpCompactionUpdateOptions {
    /** CodeBuddy-only provenance; projected under namespaced ACP metadata. */
    trigger: AcpCompactionTrigger;
    /** Optional source classification; presentation remains a Client decision. */
    compactType?: string;
    /** Safe, user-displayable retained summary. Internal model context is never used. */
    summary?: ContentBlock[] | null;
    error?: string | null;
    meta?: Record<string, unknown> | null;
}
export interface AcpCompactSessionRequest {
    sessionId: string;
    _meta?: Record<string, unknown> | null;
}
export declare function compactTypeToTrigger(compactType: CompactType | string | undefined): AcpCompactionTrigger;
/** Standard ACP update; CodeBuddy source classification uses optional metadata. */
export declare function createAcpCompactionUpdate(compactionId: string, status: AcpCompactionStatus, options: AcpCompactionUpdateOptions): SessionNotification['update'];
