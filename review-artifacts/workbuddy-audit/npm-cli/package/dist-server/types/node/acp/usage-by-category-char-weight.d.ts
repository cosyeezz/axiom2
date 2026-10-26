/**
 * 字符权重 · 上下文消耗 5 类目细拆专用。
 * CJK / ASCII 字母空白 / 其它字符分别按 1.2 / 0.25 / 0.7 折算。
 */
/**
 * 按字符权重把字符串折算成「token 数」估算量（用于 5 类目反向归一化的相对比例）。
 * 真实 token 数由 ACP usage_update.used 决定；本函数仅用作类目分配权重。
 */
export declare function weighted(text: string): number;
