/**
 * Memory Age Utilities
 *
 * 提供记忆新鲜度/陈旧度计算和格式化功能。
 *
 * 模型对日期计算能力较差 — 原始 ISO 时间戳不会像 "47 days ago" 那样
 * 触发陈旧性推理。
 */
/**
 * 计算记忆距今天数
 *
 * @param mtimeMs 修改时间戳 (ms)
 * @returns 天数（向下取整，0 表示今天，1 表示昨天，2+ 表示更早）
 *          负值输入（未来时间或时钟偏差）会被 clamp 到 0
 */
export declare function memoryAgeDays(mtimeMs: number): number;
/**
 * 人类可读的年龄字符串
 *
 * @param mtimeMs 修改时间戳 (ms)
 * @returns 如 "today", "yesterday", "3 days ago"
 */
export declare function memoryAge(mtimeMs: number): string;
/**
 * 陈旧记忆的警告文本
 *
 * 对于 ≤1 天的记忆（今天或昨天）返回空字符串，≥2 天则返回警告文本。
 *
 * 动机：用户反馈旧的代码状态记忆（如文件:行号引用）被当作事实陈述，
 * 这些引用反而让陈旧声明听起来更权威。
 *
 * @param mtimeMs 修改时间戳 (ms)
 * @returns 警告文本或空字符串
 */
export declare function memoryFreshnessText(mtimeMs: number): string;
/**
 * 带 system-reminder 标签的陈旧提示
 *
 * 对于 ≤1 天的记忆返回空字符串。
 *
 * @param mtimeMs 修改时间戳 (ms)
 * @returns 带标签的提示或空字符串
 */
export declare function memoryFreshnessNote(mtimeMs: number): string;
