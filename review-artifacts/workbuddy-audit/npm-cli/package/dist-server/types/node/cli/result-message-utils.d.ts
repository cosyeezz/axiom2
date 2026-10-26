import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { AgentInputItem, AssistantMessageItem } from '../../vendor/cbc-shared/node/index.js';
import { ResultMessage, TerminalReason } from './stream-json-protocol';
/**
 * Utility class for creating result messages
 * Used by both LLMView and StreamJsonView to ensure consistent result formatting
 */
export declare class ResultMessageUtils {
    /**
     * Serialize error to string format for SDK transmission.
     * If error has status and code fields, serialize to JSON string with structured data.
     * Otherwise, use plain text format.
     *
     * @param error - Error object to serialize
     * @returns Error string (JSON or plain text)
     */
    private static serializeErrorForSdk;
    /**
     * 结构化错误信息（`errors_info[i]` 与 `errors[i]` 一一对应）。
     *
     * 语义边界（谨慎判定"有没有结构化信息"）：
     * - **纯 `Error` 实例 / 纯字符串**视为无结构化信息，返回 null——虽然 `Error.message`
     *   可以当 details，但那与 `errors[i]` 字符串完全重复，没有额外信息，反而让消费方
     *   误以为拿到了"结构化数据"。
     * - **判定"有结构化"的门槛**：至少能抽出 `status` / `code` / `category` 三者之一
     *   （details 只是文案，独占不算"结构化"）。
     */
    static extractStructuredErrorInfo(error: unknown): {
        status?: number;
        code?: string | number;
        category?: string;
        details?: string;
    } | null;
    /**
     * 把一批错误批量抽成 `errors_info[]`（与 `errors[]` 一一对应）。
     *
     * 兼容性约束（重要，勿改）：
     * - 只增加**单个**可选顶层字段 `errors_info`（消费者不读 = 无变化，读了拿更好）；
     * - **不改动**既有 `errors: string[]` 契约（老消费者继续能吃）；
     * - 数组长度**严格等于** `errors` 长度，索引可对齐（`errors_info[i]` 描述 `errors[i]`）；
     * - 单条错误抽不出结构化维度时该位置为 `null`（表达"这条没有结构化信息"，
     *   不用空对象是因为 `{}` 语义模糊）；
     * - **全部元素都为 `null`** 时整体省略 `errors_info` 字段，避免污染 fixture / snapshot。
     *
     * 数据来源见 {@link extractStructuredErrorInfo} 顶部注释；
     * `category` 命名与 `classifyErrorAsRequestError`（acp-agent.ts）对齐。
     *
     * 返回：能覆盖 result-message-utils.ts 与 stream-json-view.ts 两处入口的复用工具。
     */
    static buildErrorsInfo(rawErrors: unknown[]): Array<{
        status?: number;
        code?: string | number;
        category?: string;
        details?: string;
    } | null> | undefined;
    /**
     * 错误终态没有任何文案时的兜底描述，按错误的**形状**给出可区分的文本。
     *
     * 不能返回空串：下游 sandbox-proxy 的 `processResult`（event_processor.go）会先把
     * `errors[]` 里的空串全部过滤掉，再用 `len(errorTexts) > 0 || len(errorsInfo) > 0`
     * 决定要不要构造 endTurn 的错误 `_meta`。文案与结构化维度同时为空时整条 `_meta`
     * 被丢弃，CLS 上只剩 `stop_reason=refusal` + `error=""` + `error_class=unknown`
     * 的终态——既进不了错误分类，也没法按文本聚类回查。
     */
    private static describeErrorWithoutMessage;
    /** 兜底槽位的机器可读标记，用于把"CLI 确实没有错误信息"与"分类器没命中"区分开。 */
    static readonly EMPTY_ERROR_CODE = "cbc_empty_error";
    /**
     * 构造错误终态的 `errors` / `errors_info` 两个字段，保证它们**始终可归类**。
     *
     * 不变量（三个错误终态入口共用，勿在调用方另起炉灶）：
     * - `errors.length >= 1`——一个都没有时补一条，`is_error=true` 却 `errors: []`
     *   等于把失败原因整条丢掉；
     * - 每个 `errors[i]` 都是**非空**字符串——空串会被 proxy 过滤成等价于没有；
     * - 文案是兜底补出来的槽位，其 `errors_info[i]` 至少带 {@link EMPTY_ERROR_CODE}，
     *   让消费方能直接判定"这条是 CLI 侧无信息"，而不是去猜文本。
     *
     * 能正常抽出文案的槽位行为完全不变（含 `errors_info` 整体省略的既有语义）。
     */
    static buildErrorTerminalFields(rawErrors: unknown[]): {
        errors: string[];
        errors_info?: Array<{
            status?: number;
            code?: string | number;
            category?: string;
            details?: string;
        } | null>;
    };
    /**
     * Create a result message with session statistics
     *
     * @param session - Current session
     * @param completedItem - Last completed assistant message item
     * @param options - Options
     *   - includeTimestamp: Whether to include ISO timestamp in result
     *   - apiDurationMs: Cumulative API call duration in ms (from CostService)
     */
    static createResultMessage(session: Session, completedItem?: AssistantMessageItem, options?: {
        includeTimestamp?: boolean;
        apiDurationMs?: number;
    }): ResultMessage & {
        __timestamp?: string;
    };
    /**
     * 被取消的一轮的终态。
     *
     * 取消不是错误：`subtype=success`、`is_error=false`，由 `terminal_reason` 表明
     * 这一轮是被中止的（对齐 Claude Code）。`result` 固定为空——本轮已产出的内容
     * 早已随流写出，这里不能再去历史里找"最后一条完成的答复"，那条可能是上一轮的。
     * 同理不带 `structured_output`：它不随轮次重置，读到的可能是上一轮留下的值。
     */
    static createCancelledResultMessage(session: Session, options?: {
        apiDurationMs?: number;
    }): ResultMessage;
    /**
     * 判断被中止的一轮停在哪个阶段，只看本轮（从末尾往回，遇到用户消息为止）。
     *
     * 中断时，没执行完的工具调用会被补上一条 `status=incomplete` 的结果；中断来得
     * 更早时，工具调用可能连结果都还没有。两者都说明停在工具执行上，其余情况视为
     * 停在模型输出上。
     */
    static resolveAbortTerminalReason(history: AgentInputItem[] | undefined): TerminalReason;
    /**
     * Check if an item has an error
     */
    static hasError(item: AgentInputItem): boolean;
    /**
     * Extract result content from an agent input item
     */
    static extractResultContent(item: AgentInputItem): string;
    /**
     * Find the last completed assistant message in history
     */
    static findLastCompletedAssistantMessage(history: AgentInputItem[]): AssistantMessageItem | undefined;
    /**
     * Find the last assistant message in history (regardless of status)
     * This is used for interrupt scenarios where the message has status: 'incomplete'
     */
    static findLastAssistantMessage(history: AgentInputItem[]): AssistantMessageItem | undefined;
}
