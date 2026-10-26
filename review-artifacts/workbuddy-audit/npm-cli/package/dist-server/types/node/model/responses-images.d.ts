/**
 * Image restoration for Responses API requests, the counterpart of the chat-completions
 * pass in `ModelRequestProcessorImpl.normalizeMessageImages`. It runs on SDK input items
 * before serialization, so the SDK emits the native `input_image` wire shape:
 * - tool outputs whose JSON text carries image parts (Read / screenshot `image_url`, MCP
 *   `image`, `image_blob_ref` after session-store dehydration) become structured outputs;
 * - user `input_image` parts holding blob refs (resumed runs) are rehydrated.
 * Output shape follows pi's `convertToolResultOutput`: text joined into one leading
 * `input_text`, then `input_image` parts with `detail`; a plain string once no image is left.
 * Outputs without images are left untouched to keep prompt-cache bytes stable, and history
 * is never mutated.
 */
import type { AgentInputItem } from '@openai/agents-core';
import { type ImagePartDeps } from './image-parts';
type Part = Record<string, any>;
export interface ResponsesImageDeps extends ImagePartDeps {
    supportsImages: boolean;
    isBlobRef(value: unknown): boolean;
    /** Replaces images the model cannot take. */
    omittedNote: string;
}
/** One user image as Responses input: prepared, a placeholder, or the omitted note for text-only models. */
export declare function resolveUserImage(image: unknown, detail: unknown, deps: ResponsesImageDeps): Promise<Part>;
export declare function resolveResponsesImages(input: AgentInputItem[], deps: ResponsesImageDeps): Promise<AgentInputItem[]>;
export {};
