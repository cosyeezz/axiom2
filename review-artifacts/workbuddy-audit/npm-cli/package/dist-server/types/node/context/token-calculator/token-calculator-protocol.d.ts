import { AgentInputItem } from '../../../vendor/cbc-shared/node/index.js';
export declare const TokenCalculator: unique symbol;
/**
 * Token 计算器接口
 */
export interface TokenCalculator {
    /**
     * 估算AgentInputItem数组的token数量
     * @param items 输入项数组
     * @returns 估算的token数量
     */
    estimateTokens(items: AgentInputItem[]): number;
    /**
     * 估算单个AgentInputItem的token数量
     * @param item 输入项
     * @returns 估算的token数量
     */
    estimateItemTokens(item: AgentInputItem): number;
    /**
     * 检查是否超过token限制
     * @param items 输入项数组
     * @param maxTokens 最大token限制
     * @param safeMargin 安全边界系数
     * @returns 是否超限
     */
    isOverLimit(items: AgentInputItem[], maxTokens: number, safeMargin: number): boolean;
}
