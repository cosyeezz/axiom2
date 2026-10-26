/**
 * Memory Type Taxonomy — 与 Claude Code memoryTypes.ts 对齐
 *
 * 记忆被约束为四种类型，捕获无法从当前项目状态中推导出的上下文。
 * 代码模式、架构、git 历史和文件结构是可推导的（通过 grep/git/CODEBUDDY.md），
 * 不应作为记忆保存。
 */
export declare const MEMORY_SEMANTIC_TYPES: readonly ["user", "feedback", "project", "reference"];
export type MemorySemanticType = (typeof MEMORY_SEMANTIC_TYPES)[number];
/**
 * 解析 frontmatter 中的记忆类型
 */
export declare function parseMemorySemanticType(raw: unknown): MemorySemanticType | undefined;
/**
 * `## Types of memory` — 个人模式（单目录）
 * 无 <scope> 标签，示例使用 `[saves X memory: …]`
 */
export declare const TYPES_SECTION_INDIVIDUAL: readonly string[];
/**
 * `## Before saving a memory`
 *
 * 敏感信息约束单独成节、放在保存流程之前：塞进 `What NOT to save` 的 bullet
 * 里命中率明显更低（Claude 的评测结论：同一条规则放独立小节 3/3、埋进列表 0/3），
 * 而这一条比"不要记文件路径"重要得多——记忆会随每轮上下文外发，也可能随日志离开本机。
 *
 * 措辞对齐 Codex 的 AGENTS.md 风格：短句、祈使、只讲动作，不举例。
 */
export declare const BEFORE_SAVING_SECTION: readonly string[];
/**
 * `## What NOT to save in memory`
 *
 * 改为函数：resolveInstructionBaseName() 读取 customization.json snapshot，
 * 模块级常量会在 import 时固化值，定制版场景下可能拿到错误的 baseName。
 */
export declare function getWhatNotToSaveSection(): readonly string[];
/**
 * 记忆漂移警告
 */
export declare const MEMORY_DRIFT_CAVEAT = "- Memory records can become stale over time. Use memory as context for what was true at a given point in time. Before answering the user or building assumptions based solely on information in memory records, verify that the memory is still correct and up-to-date by reading the current state of the files or resources. If a recalled memory conflicts with current information, trust what you observe now \u2014 and update or remove the stale memory rather than acting on it.";
/**
 * `## When to access memories`
 */
export declare const WHEN_TO_ACCESS_SECTION: readonly string[];
/**
 * `## Before recommending from memory`
 *
 * 验证记忆中的具体声明（文件路径、函数名等）是否仍然存在。
 */
export declare const TRUSTING_RECALL_SECTION: readonly string[];
/**
 * Frontmatter 格式示例
 */
export declare const MEMORY_FRONTMATTER_EXAMPLE: readonly string[];
/**
 * MEMORY.md 入口名称和限制
 */
export declare const ENTRYPOINT_NAME = "MEMORY.md";
export declare const MAX_ENTRYPOINT_LINES = 200;
export declare const MAX_ENTRYPOINT_BYTES = 40000;
