import { Event } from '@celljs/core';
export declare const CostService: unique symbol;
export interface FileChangeStats {
    totalAddedLines: number;
    totalDeletedLines: number;
    totalAddedCharacters: number;
    totalDeletedCharacters: number;
}
export interface TokenUsageByModel {
    [modelId: string]: {
        inputTokens: number;
        outputTokens: number;
        cachedReadTokens: number;
        cachedWriteTokens: number;
        modelName: string;
    };
}
export interface CostStatistics {
    startupTime: number;
    apiDuration: number;
    runningTime: number;
    fileChangeStats: FileChangeStats;
    tokenUsageByModel: TokenUsageByModel;
}
export interface CostService {
    onDidChangeCost: Event<void>;
    /**
     * 获取应用启动时间
     */
    getStartupTime(): number;
    /**
     * 获取当前运行时长（毫秒）
     */
    getRunningTime(): number;
    /**
     * 记录文件变更统计
     */
    recordFileChange(addedLines: number, deletedLines: number, addedChars: number, deletedChars: number): void;
    /**
     * 获取文件变更统计
     */
    getFileChangeStats(): FileChangeStats;
    /**
     * 记录Token使用统计
     */
    recordTokenUsage(modelId: string, modelName: string, inputTokens: number, outputTokens: number, cachedReadTokens: number, cachedWriteTokens: number): void;
    /**
     * 获取按模型分组的Token使用统计
     */
    getTokenUsageByModel(): TokenUsageByModel;
    /**
     * 记录 API 调用时长
     */
    recordAPIDuration(duration: number): void;
    /**
     * 获取完整的使用统计
     */
    getAllStatistics(): CostStatistics;
    /**
     * 重置统计数据
     */
    resetStatistics(): void;
    /**
     * 格式化成本信息
     */
    formatCostInfo(): string;
}
