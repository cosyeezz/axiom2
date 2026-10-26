/**
 * Image parts of a model request, resolved once for both wires: chat completions
 * (`ModelRequestProcessorImpl.normalizeMessageImages`) and the Responses API
 * (`responses-images.ts`) only map the result onto their own part shapes.
 * - `image_url`: data URLs are validated and normalized, other URLs pass through;
 * - `image` (MCP; `image` once SDK-normalized, raw `data` + `mimeType`): base64 is prepared,
 *   remote URLs pass through;
 * - `image_blob_ref` (session-store dehydration): rehydrated, then prepared like any input.
 */
type Part = Record<string, any>;
export type PreparedImage = {
    ok: true;
    dataUrl: string;
} | {
    ok: false;
    reason: string;
};
export interface ImagePartDeps {
    /** Data URL of the blob, or undefined when it is gone. */
    rehydrate(ref: Part): Promise<string | undefined>;
    /** Text standing in for a blob that is gone. */
    placeholder(ref: Part): string;
    prepare(raw: string, fallbackMimeType: string): Promise<PreparedImage>;
    warn(message: string): void;
    /** Text standing in for an image that fails to decode or rehydrate. */
    errorPlaceholder: string;
}
/** An image for the wire (with the part's `image_url` options), or the text replacing it. */
export type ResolvedImage = {
    url: string;
    options?: Part;
} | {
    text: string;
};
export declare function resolveImageUrl(url: string, deps: ImagePartDeps, options?: Part): Promise<ResolvedImage> | ResolvedImage;
export declare function resolveBlobRef(ref: Part, deps: ImagePartDeps): Promise<ResolvedImage>;
/** Resolves an image part; undefined for any other part, MCP images without data included. */
export declare function resolveImagePart(part: Part, deps: ImagePartDeps): Promise<ResolvedImage | undefined>;
export {};
