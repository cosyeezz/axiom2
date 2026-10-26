/**
 * 守恒分配函数 —— 把 totalTokens 按 5 类目权重分配到非负整数桶里，sum 严格守恒。
 * 算法：floor 分配 + 按余数从大到小补 1。
 */
export type UsageByCategoryKey = 'systemPrompt' | 'conversation' | 'tools' | 'mcp' | 'skills';
export declare function distributeWithConservation(estimates: Record<UsageByCategoryKey, number>, totalTokens: number): Record<UsageByCategoryKey, number>;
