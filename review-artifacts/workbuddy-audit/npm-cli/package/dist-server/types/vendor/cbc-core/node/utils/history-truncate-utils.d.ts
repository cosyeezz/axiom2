import type { AgentInputItem } from '../../../cbc-shared/node/index.js';
/**
 * 被 truncateHead 插入到 history 开头的合成 user 消息标记。
 * 下次重试时必须剥掉，否则"只丢 marker 再 re-add marker"会导致零进展。
 */
export declare const PTL_RETRY_MARKER = "[earlier conversation truncated to fit context limit]";
/**
 * PTL 重试最大次数（包括外层拦截器触发 + compact 内部 summarize 触发）。
 * 超过即吐错给用户，避免无限打补丁。
 */
export declare const MAX_PTL_RETRIES = 3;
/**
 * History 截断工具 — 当 compact 无法救回 400 input-length-too-long 错误时，
 * 按 API-round 边界精确丢弃最老的消息段，尽量少破坏 tool_use/tool_result 配对。
 *
 * 对齐 Claude Code `truncateHeadForPTLRetry` 的思路：
 *   1. 按 user 消息边界切组（agent-cli 每个 user message 开一个新轮次）
 *   2. 按 token gap 累积丢最老的组，gap 解析不到则 fallback 丢 20%
 *   3. 至少保留一组让下次仍有上下文；否则返回 null 交给调用方吐错
 *   4. 丢后若首条变成 assistant/function_call，插入 PTL_RETRY_MARKER 合成 user 消息
 *      避免 API 拒绝 "first message must be role=user"
 *   5. 下次重试前剥掉上次留下的 marker，防止自环
 */
export declare namespace HistoryTruncateUtils {
    /**
     * 按 user message 边界把 history 切成若干 API round group。
     *
     * 切分规则：
     *   - 遇到 user message（非 system reminder / non-custom）→ 开新组，该 user 消息是新组的首条
     *   - assistant、function_call、function_call_result、reasoning 等都归入"当前最后一个 user 的组"
     *   - 头部未见到 user 之前的所有消息（system reminder / summary / file-snapshot / compact-summary 等）
     *     归入 group 0（首组），下次截断时优先保留
     *
     * 这样丢弃老组时天然保证 tool_use/tool_result 配对完整（它们都在同一组内）。
     */
    function groupMessagesByApiRound(history: AgentInputItem[]): AgentInputItem[][];
    /**
     * 按 token gap 累积丢最老的 API round groups，返回截断后的 history。
     *
     * @param history 原 history（通常是 session.history 引用）
     * @param gap    PtlErrorUtils 解析出的 actual - limit。undefined 时走 20% fallback
     * @returns      截断后的新 history；无法再丢时返回 null（调用方应 surface 错误）
     */
    function truncateHeadByTokenGap(history: AgentInputItem[], gap: number | undefined): AgentInputItem[] | null;
    /**
     * 扫描 history 中最近若干条消息，统计 PTL_RETRY_MARKER 出现次数。
     * 拦截器用此判断是否已达 MAX_PTL_RETRIES。
     */
    function countPtlRetries(history: AgentInputItem[]): number;
}
//# sourceMappingURL=history-truncate-utils.d.ts.map