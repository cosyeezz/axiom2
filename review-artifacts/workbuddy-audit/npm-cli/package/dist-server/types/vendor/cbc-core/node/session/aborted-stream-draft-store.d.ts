import type { AgentInputItem, ResponseStreamEvent } from '../../../cbc-shared/node/index.js';
export interface AbortedStreamFlushContext {
    messageId: string;
    model: string;
    timestamp: number;
    /** 用户配置的模型 ID（product.json 的 model.id），用于上报归因 */
    requestModelId?: string;
    /** 模型显示名（product.json 的 model.name），用于上报展示 */
    requestModelName?: string;
    traceId?: string;
    conversationRequestId?: string;
    rootRequestId?: string;
}
export declare class AbortedStreamDraftStore {
    private assistantMessageDraft?;
    private reasoningDraft?;
    private readonly toolCallDrafts;
    private readonly toolCallIndexToId;
    private readonly committedRefs;
    private readonly committedKeys;
    ingestModelStreamEvent(event: ResponseStreamEvent): void;
    markCommitted(rawItem: AgentInputItem): void;
    flushAbortedItems(context: AbortedStreamFlushContext): AgentInputItem[];
    private ingestRawModelEvent;
    private ingestResponsesEvent;
    private ingestChatCompletionsEvent;
    private ingestChatToolCalls;
    private resolveToolCallId;
    private appendAssistantText;
    private appendReasoningText;
    private ensureAssistantMessageDraft;
    private ensureReasoningDraft;
    private ensureToolCallDraft;
    private pushIfFlushable;
    private toAbortedItem;
    private hasMeaningfulContent;
    private isCommitted;
    private getItemKeys;
    private deleteToolCallIndex;
    private resetDrafts;
}
//# sourceMappingURL=aborted-stream-draft-store.d.ts.map