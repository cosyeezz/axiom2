import { Provider } from '@celljs/core';
import { ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import { AgentManager } from '../agent/agent-protocol';
import { AgentRunSettings } from '../agent/agent-runtime-protocol';
import { InterruptionService, Session, SessionManager } from '../session/session-protocol';
import { CompactStrategy, type ContextCompactResult, ContextCompactSummarizeOptions, ContextCompactSummarizer } from './context-protocol';
/**
 * 压缩路由器（瘦身后的 Summarizer）。
 *
 * 职责：
 * 1. 通用准入判断（isCompressing? cooldown? autoCompactEnabled? ...）
 * 2. 构建 CompactStrategyContext
 * 3. 按 priority 遍历策略，分发到第一个匹配的策略执行
 *
 * 不包含任何具体的压缩逻辑实现。
 */
export declare class ContextCompactSummarizerImpl implements ContextCompactSummarizer {
    private activeCompactions?;
    protected readonly productManager: ProductManager;
    protected readonly agentManager: AgentManager;
    protected readonly logger: Logger;
    protected readonly settingsManager: AgentRunSettings;
    protected readonly sessionManager: SessionManager;
    protected readonly interruptionService: InterruptionService;
    protected readonly strategyProvider: Provider<CompactStrategy>;
    compactAndSummarize(session: Session, options?: ContextCompactSummarizeOptions): Promise<boolean>;
    compactWithResult(session: Session, options?: ContextCompactSummarizeOptions): Promise<ContextCompactResult>;
    private compactWithResultOwned;
    /**
     * 按优先级匹配（PreMessage → MaxToken），跳过 Blocking（仅作最终兜底），执行第一个命中的策略；
     * 都不命中则安全网回落到 Blocking。逻辑与压缩 span 化之前完全一致，只是把散落的 `return` 收敛成
     * 统一的 `{ success, strategyName }` 返回值，供 `compactAndSummarize` 的 try/finally 做 span 收尾。
     */
    private runCompactStrategies;
    /**
     * Reads the permission approval truth source before compaction.
     * pending$ covers multi-agent approvals; interruptionSubject is kept only as
     * a legacy fallback for ACP-compatible paths that have not migrated yet.
     */
    private getPendingInterruptionForSession;
}
//# sourceMappingURL=context-compact-summarizer.d.ts.map