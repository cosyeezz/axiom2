/**
 * 统计服务协议
 * 定义会话统计计算和报告的接口
 */
export declare const StatsService: unique symbol;
/**
 * 连续活跃天数信息
 */
export interface StreakInfo {
    /** 当前连续活跃天数（从今天往回算） */
    currentStreak: number;
    /** 历史最长连续活跃天数 */
    longestStreak: number;
    /** 当前连续活跃的起始日期（YYYY-MM-DD 格式），无当前连续则为 null */
    currentStreakStart: string | null;
    /** 最长连续活跃的起始日期（YYYY-MM-DD 格式），无活动记录则为 null */
    longestStreakStart: string | null;
    /** 最长连续活跃的结束日期（YYYY-MM-DD 格式），无活动记录则为 null */
    longestStreakEnd: string | null;
}
/**
 * 单日活动统计
 */
export interface DailyActivity {
    /** 日期（YYYY-MM-DD 格式） */
    date: string;
    /** 消息总数（user、assistant、system 等） */
    messageCount: number;
    /** 当天有活动的会话数量 */
    sessionCount: number;
    /** 当天工具调用次数 */
    toolCallCount: number;
}
/**
 * 每日各模型的 token 使用量
 */
export interface DailyModelTokens {
    /** 日期（YYYY-MM-DD 格式） */
    date: string;
    /** 模型名称到总 token 数（输入+输出）的映射 */
    tokensByModel: Record<string, number>;
}
/**
 * 工具使用统计
 */
export interface ToolUsageStats {
    /** 工具名称（如 "Read"、"Write"、"Bash"、"TodoWrite"） */
    toolName: string;
    /** 该工具被调用的总次数 */
    count: number;
}
/**
 * 最长会话信息
 */
export interface LongestSession {
    /** 会话唯一标识符 */
    sessionId: string;
    /** 会话时长（毫秒） */
    duration: number;
    /** 会话中的消息数量 */
    messageCount: number;
    /** 会话开始时间（ISO-8601 格式） */
    timestamp: string;
}
/**
 * 单个模型的聚合使用统计
 */
export interface ModelUsage {
    /**
     * 模型展示名（来源 providerData.requestModelName，对应用户在 product.json 中
     * 配置的 displayName）。前端展示时优先使用此字段，避免直接展示 alias / 物理 endpoint id。
     * 兼容旧数据：旧 session 没有 requestModelName 时为 undefined。
     */
    displayName?: string;
    /** 该模型消耗的总输入 token 数 */
    inputTokens: number;
    /** 该模型生成的总输出 token 数 */
    outputTokens: number;
    /** 从缓存读取的 token 数（可降低 API 成本） */
    cacheReadInputTokens: number;
    /** 写入缓存供后续使用的 token 数 */
    cacheCreationInputTokens: number;
    /** 网络搜索请求次数（如适用） */
    webSearchRequests: number;
    /** 估算的美元成本（无法计算时为 0） */
    costUSD: number;
    /** 使用的上下文窗口大小（未跟踪时为 0） */
    contextWindow: number;
}
/**
 * StatsService.calculateStats() 返回的完整统计结果
 */
export interface StatsResult {
    /** 会话总数 */
    totalSessions: number;
    /**
     * 所有会话的有效消息总数
     * 仅统计 type 为 message 且 role 为 user|assistant|system 的消息
     * 且 isSidechain 不为 true
     */
    totalMessages: number;
    /**
     * 从首次会话到最后会话的总天数
     * 计算方式：(lastTimestamp - firstTimestamp) / 每天毫秒数
     */
    totalDays: number;
    /** 有至少一条消息的唯一日期数 */
    activeDays: number;
    /** 连续活跃天数信息 */
    streaks: StreakInfo;
    /** 每日活动统计数组，按日期升序排列 */
    dailyActivity: DailyActivity[];
    /** 每日各模型 token 使用量数组，按日期升序排列 */
    dailyModelTokens: DailyModelTokens[];
    /** 工具使用统计数组，按使用次数降序排列 */
    toolUsage: ToolUsageStats[];
    /** 时长最长的会话信息，无会话时为 null */
    longestSession: LongestSession | null;
    /** 平均会话时长（毫秒） */
    averageSessionDuration: number;
    /**
     * 各模型聚合使用统计，以"请求模型 id"为键
     * （即 providerData.requestModelId，对应 product.json 中配置的 model id；
     * 兼容旧数据时 fallback 到 providerData.model 即 endpoint 返回的物理模型名）
     */
    modelUsage: Record<string, ModelUsage>;
    /** 首次会话时间（ISO-8601 格式），无会话时为 null */
    firstSessionDate: string | null;
    /** 最后会话时间（ISO-8601 格式），无会话时为 null */
    lastSessionDate: string | null;
    /** 消息最多的日期（YYYY-MM-DD 格式），无活动时为 null */
    peakActivityDay: string | null;
    /** 消息最多的小时（0-23），无活动时为 null */
    peakActivityHour: number | null;
}
/**
 * 统计服务接口，用于计算会话统计数据
 */
export interface StatsService {
    /**
     * 计算所有存储会话的综合统计数据
     * @returns Promise，解析为完整统计结果
     */
    calculateStats(): Promise<StatsResult>;
}
