export declare const CONVERSATION_REQUEST_ID_META_KEY = "codebuddy.ai/conversationRequestId";
export declare const CONVERSATION_REQUEST_ID_CANDIDATE_KEY = "conversationRequestIdCandidate";
export declare class ConversationRequestIdError extends TypeError {
    readonly name = "ConversationRequestIdError";
}
/** Validate client-provided IDs before they can reach headers, logs, or persistence. */
export declare function assertClientConversationRequestId(value: unknown): string;
export declare function generateConversationRequestId(): string;
export declare function resolvePreassignedConversationRequestId(items: Iterable<{
    providerData?: Record<string, unknown>;
}>, pendingRequestId?: string): string | undefined;
//# sourceMappingURL=conversation-request-id.d.ts.map