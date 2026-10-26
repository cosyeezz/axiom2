"use strict";
/**
 * /server 出口的具名错误类（claude agent sdk 惯例：AbortError 同款「导出特定
 * Error」形）。零依赖纪律：本文件进 lite 产物（facade 直供、无需装载 bundle），
 * bundle 内联同源副本——跨副本 instanceof 不可靠，宿主判别一律走 isXxxError
 * guard（name 判别兜双副本）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionRewindError = exports.AgentOptionError = exports.ToolsOptionError = void 0;
exports.isToolsOptionError = isToolsOptionError;
exports.isAgentOptionError = isAgentOptionError;
exports.isSessionRewindError = isSessionRewindError;
/**
 * QueryOptions.tools / mcpServers 装配错误：tools[] 混合形里的 tool() 定义
 * 重名、与内置名冲突、无法识别的数组项、custom_tools 保留名冲突等。
 */
class ToolsOptionError extends Error {
    name = 'ToolsOptionError';
}
exports.ToolsOptionError = ToolsOptionError;
function isToolsOptionError(error) {
    return error instanceof ToolsOptionError
        || (typeof error === 'object' && error !== null && error.name === 'ToolsOptionError');
}
/**
 * QueryOptions.agent 错误：指定的主 agent 在本进程 agent 目录里不存在。
 * 刻意 fail-loud（边界规则）：静默回落默认 agent 就是「expert 语义被无声丢弃」
 * ——lamp skills 事故同类失败形。会话档插件 agent 的装载缺口见 issue #108461。
 */
class AgentOptionError extends Error {
    name = 'AgentOptionError';
}
exports.AgentOptionError = AgentOptionError;
function isAgentOptionError(error) {
    return error instanceof AgentOptionError
        || (typeof error === 'object' && error !== null && error.name === 'AgentOptionError');
}
/** Rewind failed before the durable branch commit. */
class SessionRewindError extends Error {
    code;
    name = 'SessionRewindError';
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
exports.SessionRewindError = SessionRewindError;
function isSessionRewindError(error) {
    return error instanceof SessionRewindError
        || (typeof error === 'object' && error !== null && error.name === 'SessionRewindError');
}
