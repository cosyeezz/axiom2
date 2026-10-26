import { type AbTestService } from '@genie/product';
import type { AgentInputItem, Model, ModelSettings } from '@openai/agents-core';
import type { SseChunkParseResult } from './sse-stream-monitor-protocol';
/** SDK base URL: configured URL without query, trailing slashes or `/responses`. */
export declare function toResponsesBaseUrl(url: string): string;
/** Request URL with exactly one trailing `/responses`; query and hash are kept. */
export declare function normalizeResponsesUrl(url: string): string;
/** Facts about the upstream call, recorded on every output item (`providerData.upstream`). */
export interface ResponsesUpstream {
    /** Model id sent on the wire; the only value encrypted reasoning can be replayed to. */
    model?: string;
    /** `x-ms-region`; needed to decrypt `encrypted_content` later. */
    region?: string;
    /** `x-account-id`. */
    accountId?: string;
    /**
     * Lineage root the call ran under (`${CODEBUDDY_SESSION_ID}`, aihub `cache_task_id`); a
     * history replaying this item keeps it, see `SessionUtils.resolveRootSessionId`.
     */
    rootSessionId?: string;
}
/** Upstream facts carried in aihub (Azure) response headers. */
export declare function readResponsesUpstreamHeaders(headers: unknown): Pick<ResponsesUpstream, 'region' | 'accountId'>;
/** Forces `ProductFeature.ResponsesStore` on; wb sets it for `--features '{"rollout":true}'`. */
export declare const ENV_RESPONSES_STORE_ENABLED = "CODEBUDDY_RESPONSES_STORE_ENABLED";
/** Env override (enable-only) first, then the feature via AbTestService; off when neither says on. */
export declare function isResponsesStoreEnabled(abTestService: AbTestService | undefined, env?: NodeJS.ProcessEnv): Promise<boolean>;
export interface ResponsesWireOptions {
    /** Sent as is, `false` included: the router must not fall back to its own default (see isResponsesStoreEnabled). */
    store: boolean;
    /**
     * Model declared reasoning (`supportsReasoning: true`). Like pi, such a request asks for
     * `reasoning.encrypted_content` whenever it carries reasoning settings, whatever `store` is.
     */
    encryptedReasoning: boolean;
    /** Restores tool-output and user images (see responses-images.ts). */
    resolveImages?: (input: AgentInputItem[]) => Promise<AgentInputItem[]>;
}
/**
 * `text.verbosity` and `providerData.max_thinking_tokens` / `stop` are chat-gateway extras
 * that the SDK would spread into the Responses body as unknown parameters.
 */
export declare function toResponsesModelSettings(settings: ModelSettings, options: ResponsesWireOptions): ModelSettings;
/** Sent for empty tool outputs (pi). */
export declare const NO_TOOL_OUTPUT = "(no tool output)";
/** Text of a tool output given as a string or an SDK `{ type: 'text' }` part. */
export declare function toolOutputText(output: unknown): string | undefined;
export declare function isMessageItem(item: Record<string, any>): boolean;
/**
 * Protocol-only copy of the model input: host metadata stripped, upstream `rs_`/`fc_`/`msg_`
 * ids kept (history ids are local), `encrypted_content` passed through byte-for-byte.
 */
export declare function toResponsesInput(input: AgentInputItem[], model: string): AgentInputItem[];
/** Wraps `OpenAIResponsesModel` so every request is rebuilt by the helpers above. */
export declare function withResponsesWire(model: Model, wireModel: string, options: ResponsesWireOptions): Model;
/**
 * Whole SSE lines across socket chunks. Responses events echo the request (instructions,
 * tools) or carry full outputs, so they routinely span chunks and only parse once complete.
 */
export declare class SseLineBuffer {
    private readonly decoder;
    private rest;
    /** Lines completed by this chunk ('' while a line is still open). */
    push(chunk: Buffer): string;
}
/** What a Responses stream event means for the adapter's SSE watchdogs. */
export interface ResponsesStreamSignal {
    content: boolean;
    substantive: boolean;
    reasoning?: string;
    text?: string;
    toolCall: boolean;
    finishReason?: string;
    /** `response.failed` / `error`: the response must not reach the SDK, even after output. */
    terminalFailure?: boolean;
    usage?: SseChunkParseResult['usage'];
    responseId?: string;
}
export declare function isResponsesStreamEvent(event: unknown): event is {
    type: string;
} & Record<string, any>;
export declare function classifyResponsesStreamEvent(event: {
    type: string;
} & Record<string, any>): ResponsesStreamSignal;
