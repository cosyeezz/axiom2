import { type AgentInputItem, Usage } from '../../../cbc-shared/node/index.js';
import type { Session, SubagentTokenUsageSnapshot } from '../session/session-protocol';
export interface ContextUsageSnapshot {
    used: number;
    modelId?: string;
}
export interface LatestUsageSnapshot {
    /** Normalized SDK usage used by existing token-count consumers. */
    usage: Usage;
    /** Provider-native usage, preserving prompt-cache fields when available. */
    rawUsage: unknown;
    /** Completion time of the history item carrying this usage. */
    timestamp?: number;
    /**
     * 这条用量对应的执行模型。优先 requestModelId（用户选中的模型），
     * 没有时回退到响应里的 model。Auto 路由下两者可能不同。
     */
    model?: string;
}
export declare abstract class UsageUtils {
    /** Normalize persisted records and per-response stream usage for SDK aggregation. */
    static normalizeUsage(raw: unknown): Usage;
    /**
     * Return cumulative Session token counters for ACP end-turn usage.
     * Invalid or entirely empty data is omitted rather than fabricated.
     */
    static getCumulativeTokenUsage(session: Session): SubagentTokenUsageSnapshot | undefined;
    static getLatestUsage(session: Session): Usage | undefined;
    /** Current context occupancy, distinct from the last billable model request. */
    static getContextUsage(history: AgentInputItem[]): ContextUsageSnapshot | undefined;
    /** A successful compact boundary supersedes all pre-compact measurements. */
    static getItemContextUsage(item: AgentInputItem): ContextUsageSnapshot | undefined;
    /** Estimate the replacement model context without counting provider/billing metadata. */
    static estimateCompactedContextTokens(item: AgentInputItem, instructions?: string, tools?: readonly unknown[]): number;
    /**
     * Returns the latest non-compact usage together with its provider-native
     * cache fields and response timestamp.
     */
    static getLatestUsageSnapshot(session: Session): LatestUsageSnapshot | undefined;
    /**
     * 最近一个压缩边界之后，最后一条带 usage 的消息上的执行模型。
     * 和 currentModelId 相同、或边界之后没有用量时返回 undefined。
     *
     * 压缩边界之前的用量不算：压缩完成后旧模型自动失效，不必再清一份内存记录。
     * A→B→C 且 B 没跑过时，最后一条用量仍是 A。
     */
    static resolvePreSwitchModelId(session: {
        history?: AgentInputItem[];
    }, currentModelId: string | undefined): string | undefined;
    private static findLatestUsageSnapshot;
    /** 用户选中的模型优先于响应里的实际路由模型。 */
    private static readExecutedModelId;
    static getTotalUsage(items: AgentInputItem[]): Usage;
    /**
     * 从单个 item 的 rawUsage/usage 提取 cache_read_input_tokens（命中缓存的输入 token）。
     *
     * 我们的 SDK 输出是 Anthropic 风格（cache_read_input_tokens），但网关是 OpenAI 风格：
     * 真实命中值落在 prompt_tokens_details.cached_tokens / prompt_cache_hit_tokens，而 Anthropic
     * 命名字段被网关**零填成 0**。因此兼容多种命名：
     *   - cache_read_input_tokens（Anthropic 原生 snake_case）
     *   - cacheReadInputTokens（camelCase）
     *   - inputTokensDetails[].cached_tokens / inputTokensDetails.cached_tokens（openai-agents，数组或对象）
     *   - prompt_tokens_details.cached_tokens（OpenAI 兼容 Chat Completions / 我们的网关 / GLM）
     *   - prompt_cache_hit_tokens（DeepSeek / 网关）
     *
     * ⚠️ 必须用 firstPositiveTokenCount 而非 `??` 链：网关会把不认识的字段零填(=0)，
     *    而 `??` 只在 null/undefined 回退，遇到"存在但为 0"会短路 → 漏读真实值（命中恒为 0 的根因）。
     */
    static getCacheReadTokens(rawUsage: any): number;
    /**
     * 从单个 item 的 rawUsage 提取 cache_creation_input_tokens（写入缓存的输入 token）。
     * 兼容 Anthropic 原生(cache_creation_input_tokens) 与 OpenAI 风格网关(prompt_cache_write_tokens)；
     * 同样用 firstPositive 避免零填短路。
     * prompt_cache_miss_tokens 是未命中缓存的普通输入（DeepSeek: prompt = hit + miss），不是缓存写入，
     * 计入这里会让上游 `prompt - read - write` 的净 input 恒为 0。
     */
    static getCacheCreationTokens(rawUsage: any): number;
    /**
     * 从 history items 聚合 cache 用量
     */
    static getAggregatedCacheUsage(items: AgentInputItem[]): {
        cacheRead: number;
        cacheCreation: number;
    };
}
//# sourceMappingURL=usage-utils.d.ts.map