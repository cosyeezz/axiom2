/**
 * Chat-completions-style finish reason of a terminal OpenAI Responses API stream event
 * (`response.completed` / `response.incomplete` / `response.failed` / `error`);
 * `undefined` for every other event.
 */
export declare function responsesFinishReason(event: unknown): string | undefined;
/**
 * The terminal Responses event behind an SDK `response_done` event: the SDK keeps the event
 * type in `providerData` and the rest of the response (status, model, incomplete_details) in
 * `response.providerData`. `undefined` for chat-completions responses.
 */
export declare function responsesTerminalEventOf(done: {
    providerData?: Record<string, any>;
    response?: {
        output?: unknown;
        providerData?: Record<string, any>;
    };
}): {
    type: string;
    response: Record<string, any>;
} | undefined;
//# sourceMappingURL=responses-api-utils.d.ts.map