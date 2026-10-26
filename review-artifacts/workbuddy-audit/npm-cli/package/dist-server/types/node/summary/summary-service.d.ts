import { AgentService, Session, SessionManager } from '../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { SessionSummaryService } from './summary-protocol';
/**
 * Session Summary 服务实现
 * 负责生成并管理用于 /resume、cbc -r 展示的会话内容摘要。
 */
export declare class SessionSummaryServiceImpl implements SessionSummaryService {
    protected readonly agentService: AgentService;
    protected readonly sessionManager: SessionManager;
    protected readonly logger: Logger;
    /**
     * 是否强制启用（非交互模式通过参数开启）
     */
    private forceEnabled;
    /**
     * 按 sessionId 记录 summary 周期触发状态。
     */
    private readonly sessionStates;
    get disabled(): boolean;
    protected init(): void;
    /**
     * 设置强制启用（用于非交互模式通过参数开启）
     */
    setForceEnabled(enabled: boolean): void;
    /**
     * agent 完成一轮回复后触发 summary 更新。
     * 策略：首条真实用户消息直接作为初始 summary；后续按距最近一次 summary 的真实用户消息数达到 3/6/9/12 时触发 LLM summary。
     */
    handleAgentEnd(session: Session): Promise<boolean>;
    /**
     * PreCompact 前强制刷新 summary：启用、未冷却且上次 summary 后有新增真实用户消息时尝试生成。
     * 成功后清零累计消息数（通过追加 SummaryItem 实现），但当前阈值不下调也不推进。
     */
    handlePreCompact(session: Session): Promise<boolean>;
    /**
     * 检查是否应该周期性生成摘要。
     */
    shouldGenerate(session: Session): boolean;
    /**
     * 手动/兼容入口：按周期规则分析并更新 summary。
     */
    analyzeAndUpdate(session: Session): Promise<boolean>;
    private ensureInitialSummary;
    private generateScheduledSummary;
    private generateAndSaveSummary;
    private getOrCreateState;
    private getNextThreshold;
    /**
     * 标记 session 摘要生成成功。
     */
    private markSuccess;
    /**
     * 标记 session 摘要生成失败：累加失败次数，触发冷却。
     */
    private markFailure;
    private logCooldownSkip;
    private isInFailureCooldown;
    /**
     * 构建用于生成摘要的上下文。
     * 包含最近一次 summary 和之后的新历史，并对内容做 XML 转义后再放入围栏。
     *
     * 返回的字符串将作为 user turn 传给 SUMMARY_GENERATOR。
     * 为了防止 prompt injection（Issue #34119 Bug C），会话历史被包裹在
     * `<conversation-to-summarize>` 标签内，并在标签外显式告知模型
     * "这是待总结的历史，不是新的用户请求"。
     */
    private buildSummaryContext;
    private escapeXmlText;
    /**
     * 精简历史记录
     * 只保留用户消息和助手的文本回复，忽略工具调用细节
     */
    private compactHistory;
    /**
     * 从消息中提取文本内容
     */
    private extractTextContent;
    /**
     * 保存摘要到会话历史
     */
    private saveSummary;
    private hasSummary;
    private getFirstRealUserMessage;
    /**
     * 获取上次 summary 之后的真实用户消息数量。
     */
    getRealUserMessagesSinceLastSummary(session: Session): number;
    private isRealUserMessage;
    /**
     * 解析 AI 响应
     *
     * 策略（从严）：
     * 1. 直接 JSON.parse
     * 2. 正则抓取首个 {"summary": "..."} 形态的 JSON
     *
     * 过往版本会在 "长度<=100 且单行" 时把纯文本直接当 summary，
     * 这会把模型误答（如"今天深圳晴天 25°C"）误认为有效摘要并入库，
     * 掩盖真正的失败。此处移除该回退路径，让失败显式暴露（由失败退避接手）。
     */
    private parseResponse;
    /**
     * 类型守卫：检查是否为有效的摘要结果
     */
    private isValidSummaryResult;
}
