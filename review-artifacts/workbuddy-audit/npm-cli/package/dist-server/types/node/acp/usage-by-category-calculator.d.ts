/**
 * 上下文消耗 5 类目细拆 · 字符分类 + 反向归一化分配。
 * 严格守恒：sum(usageByCategory) === input.totalTokens（即 ACP usage_update.used）。
 */
/** 5 类目细拆结果。schema 版本字段 `version` 为后续扩展预留。 */
export interface UsageByCategory {
    systemPrompt: number;
    conversation: number;
    tools: number;
    mcp: number;
    skills: number;
    /** schema 版本：未来扩展加字段时 +1，客户端按 version 兼容。 */
    version: 1;
}
/** 单个 tool 定义的最小契约（仅消费 name + description；其它字段透传 JSON.stringify）。 */
export interface ToolLike {
    name: string;
    description?: string;
    /** OpenAI Agent SDK 的 tool 通常带 parameters/schema；calculator 不解析，只 JSON.stringify。 */
    input_schema?: unknown;
    parameters?: unknown;
}
/** 单条 history item 的结构松约束（结构不规范时 calculator 跳过，不抛错）。 */
export interface HistoryItemLike {
    type?: string;
    role?: string;
    content?: unknown;
    callId?: string;
    name?: string;
    arguments?: unknown;
    output?: unknown;
}
export interface UsageByCategoryInput {
    /** 当前请求最终发给模型的 system prompt 渲染产物（已 resolve 为字符串）。 */
    systemPrompt: string;
    /** 当前请求装载的 tool 定义列表（用作字符代理：JSON.stringify 每个 tool）。 */
    tools: ReadonlyArray<ToolLike>;
    /** session.history（user/assistant 消息 + function_call / function_call_result）。 */
    history: ReadonlyArray<HistoryItemLike>;
    /** ACP usage_update.used，作为最终归一化的总分母。 */
    totalTokens: number;
}
export declare const IMAGE_TOKEN_PER_PIECE = 85;
export declare class UsageByCategoryCalculator {
    static compute(input: UsageByCategoryInput): UsageByCategory;
}
export declare function zeroUsageByCategory(): UsageByCategory;
/**
 * 单条 history item 对 systemPrompt / conversation / 图片张数的字符贡献。
 *
 * SSOT：全量 `compute` 与增量 publisher 共用本函数，保证「进行中增量」与
 * 「prompt_end 全量」的类目结果严格一致（`weighted` 逐字符可加，item 边界不切
 * 代理对，故 `weighted(Σparts) === Σ weighted(part)`）。
 *
 * - systemPrompt 贡献：仅 user message 的 hidden context block 第一个子 section
 *   （UserInfoSection 等价物）；解析失败/无 hidden block 时为空，整条 user 文本
 *   由 conversation 承接。
 * - conversation 贡献：user/assistant 文本（user 去掉第一个 hidden section）
 *   + function_call 的 JSON.stringify + function_call_result 的 output 文本。
 * - 图片不计字符权重，按张数单独累加（由调用方 ×IMAGE_TOKEN_PER_PIECE）。
 */
export declare function collectHistoryItemChars(item: unknown): {
    systemPromptChars: string;
    conversationChars: string;
    imagePieces: number;
};
