import type { PromptResponse as AcpV1PromptResponse, SessionConfigOption as AcpV1SessionConfigOption, SessionNotification as AcpV1SessionNotification, SessionUpdate as AcpV1SessionUpdate, SetSessionConfigOptionRequest as AcpV1SetSessionConfigOptionRequest } from '@agentclientprotocol/sdk';
import { type RequestPermissionRequest as AcpV2RequestPermissionRequest, type SessionConfigOption as AcpV2SessionConfigOption, type SessionUpdate as AcpV2SessionUpdate, type SetSessionConfigOptionRequest as AcpV2SetSessionConfigOptionRequest, type ToolCallUpdate as AcpV2ToolCallUpdate, type UpdateSessionNotification as AcpV2UpdateSessionNotification } from '@agentclientprotocol/sdk/experimental/v2';
export type AcpV1MessageChunk = Extract<AcpV1SessionUpdate, {
    sessionUpdate: 'user_message_chunk' | 'agent_message_chunk' | 'agent_thought_chunk';
}>;
export type AcpV2MessageChunk = Extract<AcpV2SessionUpdate, {
    sessionUpdate: 'user_message_chunk' | 'agent_message_chunk' | 'agent_thought_chunk';
}>;
export type AcpV2Message = Extract<AcpV2SessionUpdate, {
    sessionUpdate: 'user_message' | 'agent_message' | 'agent_thought';
}>;
export type AcpV2StateUpdate = Extract<AcpV2SessionUpdate, {
    sessionUpdate: 'state_update';
}>;
export type AcpV2ConfigOptionUpdate = Extract<AcpV2SessionUpdate, {
    sessionUpdate: 'config_option_update';
}>;
export type AcpV2ProjectionErrorCode = 'invalid_terminal_output_chunk' | 'invalid_terminal_update' | 'missing_message_id' | 'invalid_replay_message_run' | 'permission_options_required';
/**
 * A migration-boundary error. The v2 projector fails closed when a v1 value
 * cannot satisfy a required v2 invariant instead of inventing wire identity or
 * relying on schema coercion.
 */
export declare class AcpV2ProjectionError extends Error {
    readonly code: AcpV2ProjectionErrorCode;
    constructor(code: AcpV2ProjectionErrorCode, message: string);
}
type AcpV1ToolUpdate = Extract<AcpV1SessionUpdate, {
    sessionUpdate: 'tool_call' | 'tool_call_update';
}>;
export declare function projectAcpV1ToolCallUpdateToV2(update: AcpV1ToolUpdate): AcpV2ToolCallUpdate;
export interface AcpV2TaskPlanRevision {
    sourceId: string;
    revision: bigint;
    isTaskPlanCurrent: boolean;
    revisionsBySource: ReadonlyMap<string, bigint>;
}
export declare function markAcpV2TaskPlanNotCurrent(latestRevisionBySessionId: Map<string, AcpV2TaskPlanRevision>, sessionId?: string): void;
/**
 * Project the v1 message-chunk subset onto the v2 wire schema.
 *
 * v1 allowed a missing message ID; v2 does not. This boundary deliberately
 * rejects such chunks so the eventual runtime adapter must supply the Agent
 * CLI's canonical message identity before advertising v2.
 */
export declare function projectAcpV1MessageChunkToV2(update: AcpV1MessageChunk): AcpV2MessageChunk;
/**
 * Collapse one contiguous v1 message-chunk run into the v2 whole-message
 * upsert recommended for replay.
 *
 * Whole updates replace the complete content array for their `messageId`.
 * Live projection intentionally continues to use
 * {@link projectAcpV1MessageChunkToV2}; this helper is only valid after the
 * transport has positively identified a replay scope.
 */
export declare function projectAcpV1MessageRunToV2(updates: readonly AcpV1MessageChunk[]): AcpV2Message;
/**
 * Project each canonical v1 session notification to its v2 representation.
 *
 * `current_mode_update` is omitted because mode is represented by the
 * config-option update emitted for the same transition. The removed
 * CodeBuddy `session_end` pseudo-update is intentionally outside the typed
 * v1 input and therefore cannot leak through this boundary.
 */
export declare function projectAcpV1SessionNotificationToV2(notification: AcpV1SessionNotification): AcpV2UpdateSessionNotification | undefined;
/**
 * Project one private-core notification to its complete ordered v2 update
 * sequence. Most inputs yield zero or one update. A successful TaskCreate,
 * TaskUpdate, or TaskList result carrying a full TaskStorage snapshot yields
 * the completing tool update followed by the replacing standard v2 plan.
 *
 * Both live delivery and replay must use this boundary so they cannot drift.
 */
export declare function projectAcpV1SessionNotificationToV2Updates(notification: AcpV1SessionNotification, latestTaskPlanRevisions?: Map<string, AcpV2TaskPlanRevision>): AcpV2UpdateSessionNotification[];
/**
 * Project a replay snapshot from the v1 chunk-only schema into canonical v2
 * whole-message upserts.
 *
 * A message can be interrupted by tool or lifecycle updates and then resume
 * later. Each emitted upsert therefore contains every chunk observed so far
 * for the same `(sessionId, messageId)`, rather than only the suffix
 * since the interruption. This keeps replay deterministic for clients that
 * replace message content on every whole-message update. A message ID cannot
 * cross user/agent/thought kinds within one session; such input is rejected
 * instead of being split into multiple logical messages.
 */
export declare function projectAcpV1ReplayNotificationsToV2(notifications: readonly AcpV1SessionNotification[], latestTaskPlanRevisions?: Map<string, AcpV2TaskPlanRevision>): AcpV2UpdateSessionNotification[];
/**
 * Wrap a projected update in the v2 notification envelope without sharing
 * mutable metadata with the caller.
 */
export declare function projectAcpV2UpdateNotification(sessionId: string, update: AcpV2SessionUpdate, meta?: Record<string, unknown> | null): AcpV2UpdateSessionNotification;
export declare function projectAcpV2RunningStateUpdate(meta?: Record<string, unknown> | null): AcpV2StateUpdate;
export declare function projectAcpV2RequiresActionStateUpdate(meta?: Record<string, unknown> | null): AcpV2StateUpdate;
/**
 * ACP v1 completed `session/prompt` with a stop-bearing response. ACP v2
 * accepts the prompt immediately and reports completion as an idle
 * `state_update`; this projection captures that lifecycle change explicitly.
 */
export declare function projectAcpV1PromptResponseToV2StateUpdate(response: AcpV1PromptResponse): AcpV2StateUpdate;
/**
 * ACP v2 renamed option `id` to `configId` and group `group` to `groupId`.
 * Keep those wire changes in one exact, typed projection.
 */
export declare function projectAcpV1ConfigOptionToV2(option: AcpV1SessionConfigOption): AcpV2SessionConfigOption;
export declare function projectAcpV1ConfigOptionsToV2(options: readonly AcpV1SessionConfigOption[]): AcpV2SessionConfigOption[];
export declare function projectAcpV1ConfigOptionsUpdateToV2(options: readonly AcpV1SessionConfigOption[], meta?: Record<string, unknown> | null): AcpV2ConfigOptionUpdate;
/**
 * ACP v2 makes the selected-value discriminator mandatory (`id` or
 * `boolean`). V1's select branch omitted it.
 */
export declare function projectAcpV1SetConfigOptionRequestToV2(request: AcpV1SetSessionConfigOptionRequest): AcpV2SetSessionConfigOptionRequest;
export declare function projectAcpV2SetConfigOptionRequestToV1(request: AcpV2SetSessionConfigOptionRequest): AcpV1SetSessionConfigOptionRequest;
export type AcpV2StandardPermissionOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
export interface AcpV2PermissionOptionIntent {
    id: string;
    label: string;
    kind: AcpV2StandardPermissionOptionKind;
    _meta?: Record<string, unknown> | null;
}
export type AcpV2PermissionSubjectIntent = {
    kind: 'tool_call';
    toolCall: AcpV2ToolCallUpdate;
} | {
    kind: 'command';
    command: string;
    cwd: string;
    toolCallId?: string | null;
    terminalId?: string | null;
    _meta?: Record<string, unknown> | null;
};
export interface AcpV2PermissionIntent {
    sessionId: string;
    title: string;
    description?: string | null;
    subject?: AcpV2PermissionSubjectIntent | null;
    options: readonly AcpV2PermissionOptionIntent[];
    _meta?: Record<string, unknown> | null;
}
/**
 * Map Agent CLI's normalized approval intent onto v2's title/subject/options
 * request. This intentionally does not consume the v1 request shape: v2 can
 * represent command approval directly and does not require a synthetic tool
 * call.
 */
export declare function projectAcpV2PermissionIntent(intent: AcpV2PermissionIntent): AcpV2RequestPermissionRequest;
export {};
