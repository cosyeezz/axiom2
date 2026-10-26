import type { Session } from '../../vendor/cbc-core/node/index.js';
/** `extra_vars` key of the per-call harness metadata. Gateway `extra_vars` values must be strings. */
export declare const HARNESS_METADATA_EXTRA_KEY = "harnessMetadata";
export declare const HARNESS_METADATA_SCHEMA_VERSION = 1;
/** Position of an agent-loop model call in its request's serial chain. */
export interface HarnessStep {
    stepIndex: number;
    /** `conversationMessageId` of the previous agent-loop call of the same request. */
    previous?: string;
}
/** The model call and spawn tool call that started a subagent run. */
export interface HarnessSpawnedBy {
    conversationId: string;
    conversationMessageId: string;
    toolCallId: string;
}
export interface HarnessMetadata {
    schemaVersion: number;
    harnessVersion: string;
    stepIndex?: number;
    previous?: {
        conversationMessageId: string;
    };
    agent: {
        depth: number;
        spawnedBy?: HarnessSpawnedBy;
    };
}
/**
 * Takes the next agent-loop step of `requestId` on `session`. A request with earlier calls in a
 * resumed Session's history reports no step for the rest of its life rather than restarting at 0.
 */
export declare function allocateHarnessStep(session: Pick<Session, 'history'>, requestId: string | undefined, messageId: string): HarnessStep | undefined;
/** Remembers which model call issued a spawn tool call on `parent`. */
export declare function rememberSpawnToolCall(parent: object | undefined, toolCall: {
    callId?: string;
    id?: string;
    providerData?: Record<string, unknown>;
} | undefined): void;
/**
 * The spawn behind `toolCallId`, valid only while that tool call is executing: models may reuse
 * call ids across turns, so a later lookup can return a newer call of the same id.
 */
export declare function resolveHarnessSpawnedBy(parent: Pick<Session, 'id'>, toolCallId: string | undefined): HarnessSpawnedBy | undefined;
/** Binds the spawn that created `session`. Sessions resumed from disk carry none rather than a guessed one. */
export declare function bindHarnessSpawnedBy(session: object, spawnedBy: HarnessSpawnedBy | undefined): void;
export declare function buildHarnessMetadata(session: Pick<Session, 'meta'>, step: HarnessStep | undefined): HarnessMetadata;
