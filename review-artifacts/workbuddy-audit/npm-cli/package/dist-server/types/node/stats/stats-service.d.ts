import { Logger } from '@celljs/core';
import { SessionStore } from '../../vendor/cbc-core/node/index.js';
import { StatsResult, StatsService } from './stats-protocol';
export declare class StatsServiceImpl implements StatsService {
    protected readonly logger: Logger;
    protected readonly sessionStore: SessionStore;
    /**
     * 计算所有存储会话的综合统计数据（跨所有项目）
     */
    calculateStats(): Promise<StatsResult>;
    /**
     * 获取空的统计结果
     */
    private getEmptyStatsResult;
    /**
     * 获取默认的模型使用量条目
     */
    private getDefaultModelUsage;
    /**
     * 检查 item 是否为有效的消息（过滤掉特殊 type）
     */
    private isValidMessage;
    /**
     * 检查 session 是否为老对话
     * 如果所有 assistant 类型的消息都没有 providerData.requestModelId 也没有 providerData.model 字段，则认为是老对话
     */
    private isLegacySession;
    /**
     * 检查 item 是否为助手消息
     */
    private isAssistantMessage;
    /**
     * 检查 item 是否为工具调用
     */
    private isToolCall;
    /**
     * 从 item 中提取时间戳（毫秒）
     */
    private getTimestampMs;
    /**
     * 将时间戳转换为 YYYY-MM-DD 格式
     */
    private getDateFromTimestamp;
    /**
     * 从活跃日期集合中计算连续天数信息
     */
    private calculateStreaks;
}
