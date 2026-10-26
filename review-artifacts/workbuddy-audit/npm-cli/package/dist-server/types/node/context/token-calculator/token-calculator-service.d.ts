/**
 * Token 计算器服务实现
 */
import { AgentInputItem } from '../../../vendor/cbc-shared/node/index.js';
import { TokenCalculator } from './token-calculator-protocol';
/**
 * 基于 tiktoken 的 Token 计算器实现
 */
export declare class TikTokenCalculatorService implements TokenCalculator {
    private readonly TOKENS_PER_MESSAGE;
    private readonly TOKENS_PER_NAME;
    private readonly BASE_TOKENS;
    /**
     * 估算AgentInputItem数组的token数量
     */
    estimateTokens(items: AgentInputItem[]): number;
    /**
     * 估算单个 AgentInputItem 的 token 数量
     */
    estimateItemTokens(item: AgentInputItem): number;
    /**
     * 检查是否超过token限制
     */
    isOverLimit(items: AgentInputItem[], maxTokens: number, safeMargin: number): boolean;
    /**
     * 估算文本的token数量
     * 优化的实现，提高准确性和性能
     */
    private estimateTextTokens;
    /**
     * 获取详细的token分析
     */
    getDetailedTokenAnalysis(items: AgentInputItem[]): Promise<{
        totalTokens: number;
        itemBreakdown: Array<{
            index: number;
            type: string;
            role?: string;
            tokens: number;
            contentPreview: string;
        }>;
        summary: {
            systemItems: number;
            systemTokens: number;
            userItems: number;
            userTokens: number;
            assistantItems: number;
            assistantTokens: number;
            toolItems: number;
            toolTokens: number;
        };
    }>;
}
