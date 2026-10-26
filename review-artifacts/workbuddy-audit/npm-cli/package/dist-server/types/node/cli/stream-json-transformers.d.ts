import type { CombineEvent, Session } from '../../vendor/cbc-core/node/index.js';
import type { Agent, AgentInputItem, AssistantMessageItem, FunctionCallItem, FunctionCallResultItem, StreamedRunResult, UserMessageItem } from '../../vendor/cbc-shared/node/index.js';
import type { AssistantMessage, ContentBlock, Message, PartialAssistantMessage, SystemMessage, UserMessage } from './stream-json-protocol';
export interface InputTextItem {
    type: 'input_text';
    text: string;
}
export interface InputImageItem {
    type: 'input_image';
    image: string;
    original_filename?: string;
}
export interface TypeGuards {
    isUserMessageItem(item: AgentInputItem): item is UserMessageItem;
    isAssistantMessageItem(item: AgentInputItem): item is AssistantMessageItem;
    isFunctionCallItem(item: AgentInputItem): item is FunctionCallItem;
    isFunctionCallResultItem(item: AgentInputItem): item is FunctionCallResultItem;
    isInputTextItem(item: unknown): item is InputTextItem;
    isInputImageItem(item: unknown): item is InputImageItem;
    isContentBlock(item: unknown): item is ContentBlock;
    isValidContentBlock(item: unknown): item is ContentBlock;
    hasError(item: AgentInputItem): boolean;
    isCompleted(item: AgentInputItem): boolean;
}
export declare class StreamJsonTypeGuards implements TypeGuards {
    isUserMessageItem(item: AgentInputItem): item is UserMessageItem;
    isAssistantMessageItem(item: AgentInputItem): item is AssistantMessageItem;
    isFunctionCallItem(item: AgentInputItem): item is FunctionCallItem;
    isFunctionCallResultItem(item: AgentInputItem): item is FunctionCallResultItem;
    isInputTextItem(item: unknown): item is InputTextItem;
    isInputImageItem(item: unknown): item is InputImageItem;
    isContentBlock(item: unknown): item is ContentBlock;
    isValidContentBlock(item: unknown): item is ContentBlock;
    hasError(item: AgentInputItem): boolean;
    isCompleted(item: AgentInputItem): boolean;
}
export interface ContentConverters {
    convertUserContent(content: UserMessageItem['content']): string | ContentBlock[];
    convertAssistantContent(item: AssistantMessageItem | FunctionCallItem): ContentBlock[];
    convertToTextBlock(item: unknown): ContentBlock;
    convertInputImageToImageBlock(item: InputImageItem): ContentBlock;
    extractThinkingFromReasoning(item: unknown): {
        thinkingText: string;
        signature: string;
    };
}
export declare class StreamJsonContentConverters implements ContentConverters {
    private typeGuards;
    constructor(typeGuards: TypeGuards);
    private collectProtectedTextRanges;
    private stripSystemReminderBlocksFromSegment;
    private stripSystemReminderBlocks;
    private convertUserTextBlock;
    convertUserContent(content: UserMessageItem['content']): string | ContentBlock[];
    /**
     * A local file reference carrying attachment display metadata (A2A inbound
     * files) is replayed in the persisted resource-link encoding the cloud
     * sandbox proxy restores into a file card, with `@file://…` as the visible
     * text. `originalUri` is left out: it may be a signed URL. Only the replay
     * changes; the model still reads the `@path` text.
     *
     * `,` `;` `!` `)` survive file URL encoding but end an inline `@file://`
     * reference on the display side, so they are percent-encoded here too.
     */
    private convertAttachmentReference;
    /**
     * Rewrites only an inline binary `input_file` (a base64 data URL). Text
     * files, URLs, file ids and absent payloads keep the JSON fallback so the
     * information they carry is not reduced to a label.
     *
     * The replay is for display: a PDF is re-emitted as a document, while other
     * binaries have no stream-json carrier and are shown as a label only.
     */
    private convertInlineBinaryInputFile;
    convertAssistantContent(item: AssistantMessageItem | FunctionCallItem): ContentBlock[];
    /**
     * Extract thinking text and signature from a reasoning-type item/block.
     * Handles both `rawContent` (preferred) and `content` array formats.
     */
    extractThinkingFromReasoning(item: any): {
        thinkingText: string;
        signature: string;
    };
    private convertContentBlockType;
    convertToTextBlock(item: unknown): ContentBlock;
    convertInputImageToImageBlock(item: InputImageItem): ContentBlock;
}
type CorrelatedMessage<T> = T & Pick<Message, '_requestId' | '_messageId'>;
export interface MessageTransformers {
    transformToUserMessage(item: UserMessageItem, session: Session): CorrelatedMessage<UserMessage> | undefined;
    transformToUserMessageFromFunctionResult(item: FunctionCallResultItem, session: Session): CorrelatedMessage<UserMessage>;
    transformToAssistantMessage(item: AssistantMessageItem | FunctionCallItem, session: Session, result?: StreamedRunResult<any, Agent<Session>>): CorrelatedMessage<AssistantMessage>;
}
export declare class StreamJsonMessageTransformers implements MessageTransformers {
    private contentConverters;
    constructor(contentConverters: ContentConverters);
    transformToUserMessage(item: UserMessageItem, session: Session): CorrelatedMessage<UserMessage> | undefined;
    transformToUserMessageFromFunctionResult(item: FunctionCallResultItem, session: Session): CorrelatedMessage<UserMessage>;
    transformToAssistantMessage(item: AssistantMessageItem | FunctionCallItem, session: Session, result?: StreamedRunResult<any, Agent<Session>>): CorrelatedMessage<AssistantMessage>;
    private getOutputText;
}
export declare function transformAgentInputItemToMessage(item: AgentInputItem, session: Session, result: StreamedRunResult<unknown, Agent<Session>> | undefined, helpers: StreamJsonTransformHelpers): Message | undefined;
/** Correlation inputs for framing a partial (delta) stream event. */
export interface PartialStreamEventContext {
    sessionId: string;
    parentToolUseId: string | null;
    /** Model request id (G) — becomes message_start.message.id and modelRequestId meta. */
    generationMessageId: string | undefined;
    conversationRequestId: string | undefined;
    /** Reserved transcript entry uuid for the assistant message (text deltas). */
    messageEntryId: string | undefined;
    /** Reserved transcript entry uuid for the reasoning entry (thinking deltas). */
    reasoningEntryId: string | undefined;
}
/**
 * Frame one converted Claude stream event into a `stream_event` delta envelope,
 * attaching the message-id correlation defined in docs/agent-cli/message-ids.md.
 *
 * Shared by the bin stream-json view and the `/server` subscribe fan-out so both
 * emit the identical envelope: text/thinking deltas carry
 * `_meta["codebuddy.ai/messageId"]` = the reserved transcript entry uuid, while
 * message_start/stop and tool-argument deltas carry only the turn / model-request
 * correlation. The `event.message.id` for message_start is the model request id,
 * supplied to the converter as `generationMessageId`.
 */
export declare function framePartialStreamEvent(convertedEvent: any, ctx: PartialStreamEventContext): PartialAssistantMessage & Pick<Message, '_requestId' | '_messageId' | '_meta'>;
/** The wired helper trio one consumer shares across calls. */
export interface StreamJsonTransformHelpers {
    typeGuards: TypeGuards;
    contentConverters: ContentConverters;
    messageTransformers: MessageTransformers;
}
export declare function createStreamJsonTransformHelpers(): StreamJsonTransformHelpers;
/**
 * Translate one combineSubject event into subscribe frames. View-only flows
 * (partial stream_event frames, content-filter buffering, replay, the
 * topic/ai-title/status extensions) stay in the view. User-input echoes are
 * skipped — the submitter already holds that content; tool_result user
 * frames always flow.
 */
export declare function translateCombineEvent(event: CombineEvent, session: Session, helpers: StreamJsonTransformHelpers): Message[];
/**
 * The system/init frame for a server-surface activation. Environment-derived
 * fields the surface can answer honestly are filled; the tool/command
 * inventories need the assembled agent and stay empty until the contract
 * pass wires them (the SDK type requires the keys, not the coverage).
 */
/** init 帧的可选清单（M1 补全）：装配在 server 侧（LSM）逐源 best-effort。 */
export interface ServerInitMetadata {
    tools?: string[];
    mcpServers?: Array<{
        name: string;
        status: string;
    }>;
    slashCommands?: string[];
    model?: string;
    apiKeySource?: string;
}
export declare function createServerInitMessage(session: Session, cwd: string, meta?: ServerInitMetadata): SystemMessage;
export declare class StreamEventConverter {
    private textBlockStarted;
    private thinkingBlockStarted;
    private thinkingBlockCompleted;
    private thinkingBlockIndex;
    private toolBlockStarted;
    /**
     * Per-turn accumulator for the opaque `choices[0].delta.extra_fields._meta` object.
     *
     * Agent CLI is a blind conduit: it forwards ONLY the `_meta` subtree (never the whole
     * `extra_fields`, which would leak provider-private siblings such as `reasoning_detail`),
     * and never names any inner key. Chunks are shallow-merged across a turn and reset on
     * `response_started`. The view drains it once onto the terminal assistant/result message
     * (never per chunk — avoids payload amplification).
     */
    private turnExtraFieldsMeta;
    /**
     * Fold the current model event's `extra_fields._meta` into the per-turn accumulator, and
     * reset the accumulator when a new turn starts. Called unconditionally on every model/stream
     * event so accumulation does not depend on `includePartialMessages`.
     */
    accumulateExtraFieldsMeta(event: any): void;
    /**
     * Return the accumulated `extra_fields._meta` for the current turn and clear it, so the same
     * payload is attached exactly once (to the terminal assistant message, or — if the turn emits
     * none — to the result message). Returns undefined when nothing accumulated.
     */
    consumeExtraFieldsMeta(): Record<string, unknown> | undefined;
    convert(event: any, generationMessageId?: string): any[];
}
export {};
