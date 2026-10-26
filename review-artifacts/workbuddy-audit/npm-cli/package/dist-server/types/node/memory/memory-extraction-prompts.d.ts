/**
 * Memory Extraction Prompts — 与 Claude Code extractMemories/prompts.ts 对齐
 *
 * 后台记忆提取 agent 使用的 prompt 模板。
 */
/**
 * 构建提取 prompt（个人记忆模式）
 *
 * 与 Claude Code 的 buildExtractAutoOnlyPrompt 对齐。
 */
export declare function buildExtractPrompt(newMessageCount: number, existingMemories: string): string;
