import { Session } from '../session/session-protocol';
import { CompactStrategyBase } from './compact-strategy-base';
import { CompactStrategyContext, ContextCompactSummarizeOptions } from './context-protocol';
/**
 * PreMessage 压缩策略：在发送用户消息前触发。
 *
 * 触发条件：PRE_MESSAGE_AUTO 或 USER_COMMAND（WorkBuddy / TUI 手动压缩）。
 *
 * 流程：
 * 1. Engineering compact (no LLM call)
 * 2. If tokens are small enough → replace history directly
 * 3. If still too large → LLM summary, then replace history
 * 4. If LLM fails → try truncate-then-compact fallback; if that fails,
 *    use the original engineering compact result as last resort
 *
 * Does NOT abort current stream, does NOT send continue message by default.
 * The interceptor restores user input and lets the pipeline continue.
 */
export declare class PreMessageCompactStrategy extends CompactStrategyBase {
    readonly name = "PreMessage";
    readonly priority = 3000;
    canHandle(ctx: CompactStrategyContext): boolean;
    execute(session: Session, options: ContextCompactSummarizeOptions, ctx: CompactStrategyContext): Promise<boolean>;
    /**
     * Core implementation of pre-message compaction.
     */
    private doPreMessageCompactionCore;
    /**
     * Run LLM summary on the engineering-compacted content for pre-message compact.
     */
    private runLlmSummaryForPreMessage;
    /**
     * Mark existing history items as compacted and append the compact result message.
     *
     * We append a compact message with `providerData.isCompacted = true`.
     * `HistoryAgentRunInterceptor.filterBeforeCompactedMessage` (`history-interceptors.ts:72`)
     * has always dropped everything before this marker at request time, but historically
     * `session.history` itself kept the pre-compact items **in memory** — this is Issue #82125:
     * long-running large-context sessions accumulated dead history that was then
     * `structuredClone`d by `agents-core` every turn (`runner-factory.ts:1028`), blowing the heap.
     *
     * Persistence is unaffected because the jsonl is written line-by-line by `addHistory`
     * before we splice; reloads still see the full pre-compact history and rely on the
     * same request-time filter. Only the runtime array is trimmed here.
     */
    private replaceHistoryForPreMessage;
}
//# sourceMappingURL=pre-message-compact-strategy.d.ts.map