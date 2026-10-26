import { Logger } from '@genie/telemetry';
import { PromptRenderer } from '../../vendor/cbc-core/node/index.js';
import { SessionRunStateMachine } from '../../vendor/cbc-core/node/index.js';
import { SettingsManager } from '../settings';
import { InsightsReportService, SessionFacetService, StatsService } from '../stats';
import { AgentRunInterceptor, AgentRunRequest } from '../../vendor/cbc-core/node/index.js';
/**
 * Insights 数据 Agent 运行拦截器
 *
 * 对齐 Claude Code 的增量 facet 架构：
 * 1. 通过 SessionFacetService 增量分析每个 session（跳过未变化的）
 * 2. 聚合所有 per-session facet 数据 + 全局统计数据
 * 3. 并行发送 7 个汇总请求（基于聚合数据）
 * 4. 发送第 8 个 at-a-glance 请求
 * 5. 生成 HTML 报告并替换占位符
 */
export declare class InsightsDataAgentRunInterceptor implements AgentRunInterceptor {
    priority: number;
    protected readonly statsService: StatsService;
    protected readonly sessionFacetService: SessionFacetService;
    protected readonly promptRenderer: PromptRenderer;
    protected readonly reportService: InsightsReportService;
    protected readonly logger: Logger;
    protected readonly settingsManager: SettingsManager;
    protected readonly stateMachine: SessionRunStateMachine;
    intercept(request: AgentRunRequest): Promise<void>;
    /**
     * 从 per-session facets + 全局统计构建聚合数据
     * 这是发送给 7 个汇总请求的输入
     */
    private buildAggregatedData;
    /**
     * 渲染模板
     */
    private renderPrompt;
    /**
     * 并行发送 7 个汇总分析请求
     */
    private runAggregateRequests;
    /**
     * 构建 facet 摘要（供 at-a-glance 使用）
     */
    private buildFacetSummary;
    /**
     * 发送 at-a-glance 汇总请求
     */
    private runConsolidationRequest;
    /**
     * 组装最终 InsightsData
     */
    private assembleInsightsData;
    private parseJsonResponse;
    private getFallback;
    private replacePlaceholder;
    /**
     * 更新 loading box 中的进度文本
     */
    private emitProgress;
    /**
     * 清除进度文本，恢复默认 loading phrase
     */
    private clearProgress;
    /**
     * 检查 abort 信号，如果已取消则抛出 AbortError
     */
    private throwIfAborted;
}
