import type { AgentInputItem, ResponseStreamEvent } from '../../vendor/cbc-shared/node/index.js';
import type { McpServer as AcpMcpServer, PlanEntry, PromptRequest, SessionNotification, ToolCallContent, ToolCallLocation, ToolKind } from '../acp/acp-protocol';
import { UserMessage } from '../cli/stream-json-protocol';
import { McpDataValue } from '../mcp';
/**
 * TodoWrite tool input structure (from Claude Code)
 */
export interface TodoWriteInput {
    todos?: Array<{
        id?: string;
        content: string;
        activeForm?: string;
        status: 'pending' | 'in_progress' | 'completed';
        dependencies?: string[];
    }>;
    newTodos?: Array<{
        id?: string;
        content: string;
        activeForm?: string;
        status: 'pending' | 'in_progress' | 'completed';
        dependencies?: string[];
    }>;
}
/**
 * Tool information for ACP tool_call sessionUpdate
 */
export interface ToolInfo {
    title: string;
    kind: ToolKind;
    content: ToolCallContent[];
    locations?: ToolCallLocation[];
    /** ACP _meta extension fields for subagent/extra metadata */
    _meta?: Record<string, unknown>;
}
/**
 * Categories of facts a single provider stream event can carry at the same time.
 *
 * A Chat Completions delta may, for example, contain `reasoning_content` and `tool_calls`
 * simultaneously — each becomes a separate ACP update.
 *
 * Only facets the decoder actually produces are listed. Assistant text is not among them:
 * it arrives on its own `output_text_delta` / `response.text.delta` event rather than
 * alongside reasoning in one raw delta, so no consumer could observe a `'text'` facet.
 */
export type SourceEventFacet = 'reasoning' | 'tool';
/**
 * Objective description of the provider stream event an ACP update was decoded from.
 *
 * This states only *what the source event contained*. It deliberately carries no display
 * decision: clients own their own presentation rules. Attached to `agent_thought_chunk`
 * only, because ACP delivers one update per notification — by the time a client sees a
 * thought, it can no longer tell whether the same source event also produced tool activity.
 *
 * See Issue #78472.
 */
export interface SourceEventMeta {
    facets: SourceEventFacet[];
}
export declare class AcpUtils {
    /**
     * Internal sessionUpdate types produced by {@link AcpUtils.convertOpenAIEventToAcp}
     * for streaming tool-call arguments. These are NOT part of the ACP schema — they are
     * translated into standard 'tool_call' / 'tool_call_update' events by acp-agent before
     * dispatch. Keep them in sync with the switch branches that emit them.
     */
    static readonly INTERNAL_STREAMING_UPDATES: ReadonlySet<string>;
    /** Whether the given update is an internal streaming event that must not be sent to ACP clients directly. */
    static isInternalStreamingUpdate(update: unknown): boolean;
    /**
     * 从 tool_call sessionUpdate 中提取工具名：title → _meta['codebuddy.ai/toolName'] → toolName。
     *
     * 单一真源：AcpAgent 自身处理 tool_call 填充 toolCallNameById（见其 combineSubject handler）、
     * 以及 AcpTeamBridge 转发 team member tool_call 透传给 notifyToolCallSent，两处共用本方法，
     * 避免规则漂移。工具名缺失返回 undefined——调用方按“未知工具”处理（reclaim 收尾时不跳过，
     * 安全兜底）。
     */
    static extractToolName(acpUpdate: unknown): string | undefined;
    /**
     * ACP `_meta` key carrying objective facts about the provider stream event a thought
     * chunk was decoded from. See {@link SourceEventMeta}.
     */
    static readonly SOURCE_EVENT_META_KEY = "codebuddy.ai/sourceEvent";
    /**
     * Whether the given assistant message item represents a user-initiated abort ("Interrupted by user").
     * These messages should be forwarded to the UI so cancellation state is visible.
     */
    static isInterruptedByUserMessage(item: AgentInputItem): boolean;
    private static withMessageCorrelation;
    private static isRecord;
    private static attachToolMetaData;
    /**
     * Parse value to Record<string, unknown> for ACP rawInput/rawOutput
     * Tries to parse string as JSON, otherwise wraps the value
     */
    static parseToRecord(value: any, wrapKey: string): Record<string, unknown> | undefined;
    private static parseFunctionCallRawInput;
    private static parseFunctionCallResultRawInput;
    /**
     * Convert TodoWriteInput to PlanEntry array for ACP plan sessionUpdate
     */
    static convertTodosToPlanEntries(input: TodoWriteInput): PlanEntry[];
    /**
     * Convert AgentInputItem from history to ACP SessionNotification update field(s)
     * Used during session replay in loadSession
     *
     * For user messages with content blocks, returns multiple standard user_message_chunk
     * updates (one per content block in order) to preserve positional information of images.
     * For other message types, returns a single update in an array.
     *
     * @param item - Agent input item from session history
     * @returns Array of SessionNotification['update'] items, preserving content order
     */
    static isGoalAcpHistoryItem(item: {
        type?: string;
        providerData?: {
            goalStatus?: unknown;
            [key: string]: unknown;
        };
    }): boolean;
    static convertHistoryItemToAcp(item: AgentInputItem): SessionNotification['update'][];
    private static convertHistoryItemContentToAcp;
    /**
     * Convert OpenAI AgentInputItem to ACP SessionNotification update field
     *
     * Handles tool call and tool result items
     *
     * @param item - Agent input item (function_call or function_call_result)
     * @param cachedFileContent - Cache of file contents for calculating affected lines in edits
     * @param meta - Optional metadata from CombineEvent (e.g. parentToolUseId for subagent events)
     */
    static convertInputItemToAcp(item: AgentInputItem, cachedFileContent?: {
        [key: string]: string;
    }, meta?: {
        parentToolUseId?: string;
    }): SessionNotification['update'] | null;
    private static convertInputItemContentToAcp;
    /**
     * 统一解析 FunctionCallResultItem 到 ACP 协议的 status 字段。
     *
     * 保险丝策略：只要 providerData 里带有 error 语义，**无视 result.status**，
     * 一律降级为 'failed'，并标注 businessFailed=true 供 UI 渲染兜底。
     *
     * 这是 Fix 3 的关键路径 — 即使 tool handler 忘记显式降级（Fix 2 之外的漏网之鱼）
     * 或历史会话 replay 带有老数据（status=completed + providerData.error 并存），
     * UI 都不会再显示"Completed"徽标。
     *
     * @returns acpStatus 映射后的 ACP 协议状态
     * @returns businessFailed 是否触发了兜底降级（CLI 给的 status 与 error 语义不一致）
     */
    private static resolveAcpToolStatus;
    /**
     * 判断 error 字段是否表示"真的有错误"：
     * - 字符串：trim 后非空即为真
     * - 对象：带非空 message 才算真（避免空对象/null 被误判）
     * - 其他类型：不算错误
     */
    private static isTruthyErrorField;
    /**
     * Convert OpenAI ResponseStreamEvent to ACP SessionNotification update field
     *
     * ResponseStreamEvent has these type values:
     * - "output_text_delta": Text output streaming
     * - "response_done": Response completed
     * - "response_started": Response started
     * - "model": Raw model event (event data is in event.event field, which is any type)
     */
    /**
     * Returns every ACP update the source event carries, in emission order.
     *
     * Conversion is LOSSLESS: a single provider event may hold reasoning, text and tool
     * fields at once, and each is converted independently. There is no priority between
     * them — an early return on one field would silently drop the others (Issue #78472,
     * where reasoning_content swallowed same-event tool_calls and the UI rendered tool
     * calls as endless "deep thinking").
     *
     * Thought updates additionally carry {@link SourceEventMeta} under
     * {@link AcpUtils.SOURCE_EVENT_META_KEY}, so clients that suppress reasoning when the
     * same source event also produced tool activity can decide synchronously, before the
     * thought reaches any UI state. Only objective facts are recorded here; the display
     * rule itself belongs to the client.
     *
     * Some returned events use INTERNAL sessionUpdate types (tool_call_pending,
     * tool_call_arguments_delta, tool_call_arguments_done) that are not part of
     * the ACP schema — the acp-agent translates them into standard 'tool_call'
     * and 'tool_call_update' events before dispatching to clients. Downstream
     * broadcast/forward paths that don't run the translation should use
     * {@link AcpUtils.isInternalStreamingUpdate} to filter them out.
     */
    static convertOpenAIEventToAcp(event: ResponseStreamEvent): SessionNotification['update'][];
    private static convertOpenAIEventContentToAcp;
    /**
     * Attach objective {@link SourceEventMeta} to an update, preserving existing `_meta`.
     *
     * Facets are emitted in a fixed order so equal source events always produce an
     * identical array, which keeps assertions and log comparisons stable.
     */
    private static withSourceEventMeta;
    /**
     * Wrap output in markdown code block for terminal/command output
     * Matches Claude Code's error formatting behavior
     */
    private static wrapInCodeBlock;
    /**
     * Convert tool result to ACP ToolCallContent
     */
    private static convertToolResultToAcp;
    private static convertToolResultValueToAcp;
    private static joinProtectedTextBlocks;
    /**
     * Runtime response items carry reversible v2 ranges directly. Replay items pair restored
     * plaintext with their persisted v1 ciphertext projection and are upgraded when aligned.
     */
    private static protectedHistoryText;
    private static migrateLegacyProtection;
    /**
     * Extract channel metadata from text containing channel tags inside system-reminder blocks.
     *
     * Channel events are injected by ChannelEventAgentRunInterceptor as:
     *   <system-reminder><channel source="wechat" chat_id="..." sender="...">content</channel></system-reminder>
     *
     * Returns the first channel's metadata and content, or null if no channel tags found.
     */
    static extractChannelInfo(text: string): {
        source: string;
        sender: string;
        chatId?: string;
        chatType?: 'single' | 'group';
        content: string;
    } | null;
    /**
     * Infer tool kind from tool name
     */
    static inferToolKind(toolName: string): ToolKind;
    /**
     * Convert ACP McpServer[] to dynamic scope MCP config
     */
    static convertAcpMcpServersToDynamic(mcpServers: AcpMcpServer[]): McpDataValue;
    /**
     * Extract tool information from function call (tool_use)
     * Used to create rich tool_call sessionUpdate with content and locations
     *
     * @param toolUse - Function call item with name and input
     * @param cachedFileContent - Cache of file contents for calculating affected lines in edits
     * @returns Tool information including title, kind, content, and locations
     */
    static toolInfoFromToolUse(toolUse: {
        name: string;
        input: any;
    }, cachedFileContent?: {
        [key: string]: string;
    }): ToolInfo;
    /**
     * 根据 MIME 类型返回合适的图片扩展名（截图落盘用）
     */
    private static getImageExtension;
    /**
     * 把剪贴板截图等仅有 base64 的图片落盘到用户数据目录。
     * 写盘成功返回绝对路径；失败返回 undefined（不阻断主流程）。
     */
    private static persistClipboardImage;
    static promptToUserMessage(prompt: PromptRequest): UserMessage;
    private static isImageLocalPathText;
    /** 去掉正文里的 `<image_local_path>`，保留用户问题。 */
    private static stripImageLocalPathMarkup;
    private static convertPersistedUserImageBlockToAcpContentBlock;
    private static parseDataUri;
    private static formatUriAsLink;
    private static encodeResourceLink;
    /**
     * Extract blob ID from blob file path.
     * Path format: ~/.codebuddy/blobs/{prefix}/{blob_id}.{ext}
     * Example: /Users/alice/.codebuddy/blobs/73/730cb23af77affb3d477e8ce682c4e27f36d8c34881d4181ec249f84bbf706cc.jpg
     * Returns: 730cb23af77affb3d477e8ce682c4e27f36d8c34881d4181ec249f84bbf706cc
     */
    static extractBlobIdFromPath(blobPath: string): string | undefined;
}
