import { Logger } from '@genie/telemetry';
import { type ImageBlobService } from '../blob-store/blob-store-protocol';
import { ModelRequestProcessor } from './model-protocol';
export declare class ModelRequestProcessorImpl implements ModelRequestProcessor {
    readonly wires: readonly ["chat-completions"];
    protected readonly logger: Logger;
    protected readonly imageBlobService: ImageBlobService;
    init(): void;
    process(axiosConfig: any): Promise<void>;
    private normalizeFunctionArguments;
    /**
     * Normalize empty content without losing reasoning or tool calls.
     *
     * Some providers (Bedrock ConverseStream, etc.) reject messages whose content
     * field is null, undefined, an empty string, or an empty array. Fix these by:
     * - For assistant messages with tool_calls: remove the content field entirely
     *   (OpenAI spec allows this when tool_calls is present)
     * - For assistant messages carrying reasoning without tool_calls: use an empty string
     *   (Chat Completions requires content unless tool_calls is present)
     * - For other empty assistant or user messages: remove from the list
     * - For tool/system messages: leave unchanged
     */
    private sanitizeEmptyContent;
    private hasReasoningPayload;
    /**
     * 统一验证结构化消息中的图片，并还原 tool message 的 JSON 字符串 content。
     *
     * 处理三种情况：
     * 0. content 包含 MCP 形状的图片块 { type:'image', image|data, mimeType? } → 统一转成
     *    image_url（与内置 Read 工具一致），再走 Case 1。MCP 工具（如截图类工具）返回的图片
     *    经 OpenAI Agents SDK 归一化后会变成 type:'image'（而非 image_url），若不转换，
     *    模型只会收到一坨 JSON 字符串、看不到图片。仅改写发往模型的请求体，不影响持久化历史
     *    与 UI 渲染（UI 走 acp-utils，仍读取 type:'image' 形状）。
     * 1. content 包含 image_url（data URI 未被 dehydrate）→ 直接解析为数组
     * 2. content 包含 image_blob_ref（已被 session-store dehydrate）→ 从 blob store
     *    读取 data URI 后转换为 image_url 格式的数组
     */
    private normalizeMessageImages;
    private readonly imagePartDeps;
}
