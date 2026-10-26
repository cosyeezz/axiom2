import { SessionCheckpointHost } from '../session/session-manager-host-protocol';
import { Session } from '../session/session-protocol';
import { CompactStrategyBase } from './compact-strategy-base';
import { CompactHost } from './context-host-protocol';
import { CompactStrategyContext, ContextCompactSummarizeOptions } from './context-protocol';
/**
 * Blocking 压缩策略：兜底策略。
 *
 * 使用 compact agent 进行完整的压缩流程。
 * 触发条件：canHandle 固定返回 true，作为最后的兜底。
 *
 * 流程：
 * 1. Abort current stream
 * 2. Run compact agent
 * 3. Wait for completion
 * 4. Send continue message
 */
export declare class BlockingCompactStrategy extends CompactStrategyBase {
    readonly name = "Blocking";
    readonly priority = 1000;
    protected readonly compactHost: CompactHost;
    protected readonly checkpointHost: SessionCheckpointHost;
    canHandle(_ctx: CompactStrategyContext): boolean;
    execute(session: Session, options: ContextCompactSummarizeOptions, ctx: CompactStrategyContext): Promise<boolean>;
    /**
     * 查找 Subagent 对应的主 Session。
     */
    private findMainSession;
    private doBlockingCompaction;
    /**
     * 压缩失败/取消后恢复 session 的非 history 状态字段。
     *
     * ⚠️ 重要:**不修改 session.history,不写入 jsonl**。
     * session 历史是不可变的事实记录,失败的 compact user/assistant message 留在 jsonl 里,
     * 后续 agent run 通过 view 层(`HistoryUtils.getCompactHistory` /
     * `HistoryUtils.replaceCompactWithSummary`)自动忽略提不到 <summary> 的失败段。
     *
     * 仅恢复:
     * - `session.resultSubject`:把 lastAgent 从 compact 回滚为 preCompactResult
     * - `session.lastMessageId`:回滚到压缩前的 message id (不传则从当前 history 末尾推断)
     */
    private restoreSessionStateAfterFailedCompact;
    private getLastMessageIdFromHistory;
}
//# sourceMappingURL=blocking-compact-strategy.d.ts.map