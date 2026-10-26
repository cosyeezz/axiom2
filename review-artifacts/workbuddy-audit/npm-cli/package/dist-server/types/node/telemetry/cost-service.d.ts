import { CostService, CostStatistics, FileChangeStats, TokenUsageByModel } from './cost-protocol';
export declare class CostServiceImpl implements CostService {
    private readonly _onDidChangeCost;
    readonly onDidChangeCost: import("@celljs/core").Event<void>;
    private startupTime;
    private apiDuration;
    private fileChangeStats;
    private tokenUsageByModel;
    init(): void;
    getStartupTime(): number;
    getRunningTime(): number;
    recordFileChange(addedLines: number, deletedLines: number, addedChars: number, deletedChars: number): void;
    getFileChangeStats(): FileChangeStats;
    recordTokenUsage(modelId: string, modelName: string, inputTokens: number, outputTokens: number, cachedReadTokens: number, cachedWriteTokens: number): void;
    getTokenUsageByModel(): TokenUsageByModel;
    recordAPIDuration(duration: number): void;
    getAllStatistics(): CostStatistics;
    resetStatistics(): void;
    private getModelCostText;
    formatCostInfo(): string;
}
