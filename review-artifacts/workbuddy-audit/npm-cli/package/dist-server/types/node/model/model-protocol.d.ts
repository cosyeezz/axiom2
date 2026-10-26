import { type Model, OpenAIChatCompletionsModel, type RawModelProvider } from '../../vendor/cbc-shared/node/index.js';
export { Model, OpenAIChatCompletionsModel };
export declare const MAX_MODEL_CACHE_SIZE = 10;
export { AUTHENTICATION_REQUIRED_MESSAGE, AUTHENTICATION_FAILED_MESSAGE } from '../../vendor/cbc-shared/node/index.js';
export declare const ModelProvider: unique symbol;
export declare const ModelErrorAnalyzer: unique symbol;
export declare const ModelRequestProcessor: unique symbol;
export interface ModelProvider extends RawModelProvider {
    isNetworkReady(modelName: string): Promise<boolean>;
}
export interface ModelErrorAnalyzer {
    analyze(error: unknown, axiosConfig: any): Promise<Response>;
    createErrorResponse(body: string, status: number, statusText: string, headers?: Record<string, string>): Response;
}
/** Request body shape: chat completions `messages`, or Responses API `input` (pi `api`). */
export type ModelRequestWire = 'chat-completions' | 'responses';
export interface ModelRequestProcessor {
    /**
     * Priority of the processor. Lower values execute first.
     * Default is 1000. GzipRequestProcessor should use a high value (e.g., 9999)
     * to ensure it runs after all other processors that need to access the raw body.
     */
    priority?: number;
    /** Wires whose bodies the processor understands; every wire when omitted. */
    readonly wires?: readonly ModelRequestWire[];
    process(axiosConfig: any): Promise<void>;
}
