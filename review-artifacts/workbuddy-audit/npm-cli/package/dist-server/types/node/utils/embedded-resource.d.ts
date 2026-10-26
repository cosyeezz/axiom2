import type { ContentBlock as AcpContentBlock } from '@agentclientprotocol/sdk';
import type { AgentInputItem } from '../../vendor/cbc-shared/node/index.js';
import type { ContentBlock } from '../cli/stream-json-protocol';
export declare const MAX_ACP_EMBEDDED_BLOB_BYTES: number;
type EmbeddedResource = Extract<AcpContentBlock, {
    type: 'resource';
}>['resource'];
type AcpBlobResource = Extract<EmbeddedResource, {
    blob: string;
}>;
/** Shared attachment projection; it does not select the CLI's ACP wire version. */
export declare class EmbeddedResourceCodec {
    static normalizeEmbeddedBlobMimeType(value: unknown): string;
    static embeddedBlobModelKind(mimeType: unknown): 'file' | 'image' | 'opaque';
    /**
     * Validate an ACP embedded-resource base64 payload and return its decoded
     * byte length without materializing the bytes.
     *
     * RFC 4648 encodes a zero-byte value as the empty string. ACP's Blob
     * resource schema permits that value, so admit it while retaining the
     * strict alphabet/padding checks for every non-empty payload.
     */
    static validatedEmbeddedBlobLength(base64: string): number;
    static decodeEmbeddedBlob(base64: string): Buffer;
    static describeOpaqueEmbeddedBlob(resource: AcpBlobResource, bytes: Buffer): string;
    static formatUriAsLink(uri: string, name?: string): string;
    static toModelContent(resource: EmbeddedResource): {
        content: ContentBlock[];
        context: ContentBlock[];
    };
}
/** Project a request copy; the transcript retains the original SDK content. */
export declare function projectPromptFilesForModel(items: AgentInputItem[]): AgentInputItem[];
export {};
