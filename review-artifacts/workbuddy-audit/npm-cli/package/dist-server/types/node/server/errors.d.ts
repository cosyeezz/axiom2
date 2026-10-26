/**
 * /server 出口的具名错误类（claude agent sdk 惯例：AbortError 同款「导出特定
 * Error」形）。零依赖纪律：本文件进 lite 产物（facade 直供、无需装载 bundle），
 * bundle 内联同源副本——跨副本 instanceof 不可靠，宿主判别一律走 isXxxError
 * guard（name 判别兜双副本）。
 */
/**
 * QueryOptions.tools / mcpServers 装配错误：tools[] 混合形里的 tool() 定义
 * 重名、与内置名冲突、无法识别的数组项、custom_tools 保留名冲突等。
 */
export declare class ToolsOptionError extends Error {
    readonly name: string;
}
export declare function isToolsOptionError(error: unknown): error is ToolsOptionError;
/**
 * QueryOptions.agent 错误：指定的主 agent 在本进程 agent 目录里不存在。
 * 刻意 fail-loud（边界规则）：静默回落默认 agent 就是「expert 语义被无声丢弃」
 * ——lamp skills 事故同类失败形。会话档插件 agent 的装载缺口见 issue #108461。
 */
export declare class AgentOptionError extends Error {
    readonly name: string;
}
export declare function isAgentOptionError(error: unknown): error is AgentOptionError;
/** Rewind failed before the durable branch commit. */
export declare class SessionRewindError extends Error {
    readonly code: 'busy' | 'not_found' | 'invalid_target' | 'unsupported_store';
    readonly name = "SessionRewindError";
    constructor(code: 'busy' | 'not_found' | 'invalid_target' | 'unsupported_store', message: string);
}
export declare function isSessionRewindError(error: unknown): error is SessionRewindError;
