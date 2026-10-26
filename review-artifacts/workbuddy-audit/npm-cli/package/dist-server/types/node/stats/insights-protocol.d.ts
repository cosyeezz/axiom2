/**
 * Insights 服务协议
 * 定义 per-session facet 分析和 HTML 报告生成的接口
 */
export declare const InsightsReportService: unique symbol;
export interface InsightsReportService {
    /**
     * 生成 HTML 报告并保存到磁盘
     * @param insightsData 完整的 insights JSON 数据
     * @param language 可选的语言设置，用于本地化报告
     * @returns 报告文件的绝对路径
     */
    generateReport(insightsData: Record<string, unknown>, language?: string): Promise<string>;
}
export declare const SessionFacetService: unique symbol;
/**
 * Per-session facet JSON 格式
 */
export interface SessionFacet {
    underlying_goal: string;
    goal_categories: Record<string, number>;
    outcome: string;
    user_satisfaction_counts: Record<string, number>;
    codebuddy_helpfulness: string;
    session_type: string;
    friction_counts: Record<string, number>;
    friction_detail: string;
    primary_success: string;
    brief_summary: string;
    session_id: string;
    /** 生成此 facet 时 session 的 updatedAt 时间戳（用于变化检测） */
    _updatedAt?: number;
    /** 分析失败标记，避免反复重试 */
    _error?: boolean;
    _errorReason?: string;
}
/**
 * Session 分析进度回调
 * @param analyzed 已分析的数量
 * @param total 需要分析的总数
 * @param cached 命中缓存的数量
 */
export type SessionAnalysisProgressCallback = (analyzed: number, total: number, cached: number) => void;
export interface SessionFacetService {
    /**
     * 获取 facets 存储目录
     */
    getFacetsDir(): string;
    /**
     * 增量分析所有 session，返回所有 facet（已有 + 新生成）
     * 跳过子 agent session
     * 对无变化的 session 直接读取已有 facet
     * 对新增/变化的 session 调用模型分析
     * @param language 可选的语言设置，用于生成本地化的 facet 内容
     * @param onProgress 可选的进度回调
     * @param signal 可选的 AbortSignal，用于取消分析
     */
    analyzeAllSessions(language?: string, onProgress?: SessionAnalysisProgressCallback, signal?: AbortSignal): Promise<SessionFacet[]>;
}
