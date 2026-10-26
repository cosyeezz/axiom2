import { Session } from '../session/session-protocol';
import { CompactStrategyBase } from './compact-strategy-base';
import { CompactStrategyContext, ContextCompactSummarizeOptions } from './context-protocol';
/**
 * MaxToken 压缩策略：token 超限时紧急触发。
 *
 * 触发条件：EMERGENCY_AUTO。
 *
 * 流程：
 * 1. Smart context trimming: scan from newest to oldest, stop at boundary markers
 * 2. Call contextSummary Agent with MAX_TOKEN_USER_PROMPT
 * 3. On failure: truncate the last tool-result batch and retry once while preserving call/result pairing
 * 4. On second failure (incl. summary request's own PTL 400): engineering-compact fallback
 *    (takeRecentRounds + HistoryEngineeringCompactor, no LLM), write back and continue.
 *    This path may be triggered by proactive auto-compact, which does NOT go through
 *    handlePtlError — so we must self-heal here rather than rely on PTL truncation.
 * 5. If the fallback also yields nothing: restore original history and return false
 */
export declare class MaxTokenCompactStrategy extends CompactStrategyBase {
    readonly name = "MaxToken";
    readonly priority = 2000;
    canHandle(ctx: CompactStrategyContext): boolean;
    execute(session: Session, options: ContextCompactSummarizeOptions, _ctx: CompactStrategyContext): Promise<boolean>;
    /**
     * 把压缩上限写成一条不进模型、不进 ACP 显示的终态记录。
     * 重开会话时本地历史投影靠它把这一轮收成 cancelled，并带回 cancelReason。
     * 缺身份时不写：空 parentId / requestId 过不了 durable terminal 的非空校验，
     * 半条记录比没有更难排查。
     */
    private persistCompactLimitTerminalState;
    /**
     * 清理 MaxToken 压缩为中断旧主流而设置的内部 abort 标记。
     */
    private clearCompactionAbortMarker;
    /**
     * Smart boundary trim for MaxInputToken scenario.
     */
    private smartTrimHistoryForMaxToken;
    private isSystemWarningItem;
    /**
     * Placeholder text used to replace tool result output when trimming
     * history for retry. Keeps the function_call / function_call_output
     * pairing intact so the conversation structure remains valid.
     */
    private static readonly TOOL_OUTPUT_TRUNCATED_PLACEHOLDER;
    /**
     * Trim the last tool-call round from history to reduce token count
     * before a summarisation retry.
     *
     * Strategy (scanned from the tail):
     *
     * 1. **Locate the last tool result** — walk backwards from the tail,
     *    keeping every item as-is (user / assistant / function_call), until
     *    the first `function_call_result` / `function_call_output` is found.
     *    No items are deleted in this phase. If no tool result exists in
     *    history, return undefined (nothing to trim).
     *
     *    Rationale: items between the tail and the last tool result (typically
     *    error messages, post-compact "Please continue..." injections, or
     *    partial assistant replies) are usually small in token count compared
     *    to a tool output, and removing them risks breaking required pairing
     *    (e.g. a function_call without its result, an isCompactInternal
     *    pairing the summary divider). Leave them alone — only the heavy
     *    tool outputs are worth trimming.
     *
     * 2. **Truncate the tool result batch** — once a tool result is found,
     *    walk backwards through the contiguous batch. For every
     *    `function_call_result` / `function_call_output`, replace its
     *    `output` with a short placeholder. The corresponding `function_call`
     *    items are kept as-is so the call/result pairing stays intact. Stop
     *    when a non-tool-call item (user / assistant text) is reached.
     */
    private removeLastToolResultFromHistory;
    private runContextSummaryWithRunDefault;
    /**
     * Mark existing history items as compacted and append the summary message.
     *
     * We append a compact message with `providerData.isCompacted = true`.
     * `HistoryAgentRunInterceptor.filterBeforeCompactedMessage` (`history-interceptors.ts:72`)
     * has always dropped everything before this marker at request time, but historically
     * `session.history` itself kept the pre-compact items **in memory** — this is Issue #82125:
     * long-running large-context sessions accumulated 100 K+ tokens of dead history that
     * were then `structuredClone`d by `agents-core` every turn (`runner-factory.ts:1028`),
     * blowing the heap.
     *
     * Persistence is unaffected because the jsonl is written line-by-line by `addHistory`
     * before we splice; reloads still see the full pre-compact history and rely on the
     * same request-time filter. Only the runtime array is trimmed here.
     *
     * @returns 压缩边界是否已经出现在 `session.history`。`addHistory` 被
     * `skipHistoryContext` 跳过时返回 false，调用方不得把这次压缩记为成功。
     */
    private replaceHistoryForMaxToken;
}
//# sourceMappingURL=max-token-compact-strategy.d.ts.map