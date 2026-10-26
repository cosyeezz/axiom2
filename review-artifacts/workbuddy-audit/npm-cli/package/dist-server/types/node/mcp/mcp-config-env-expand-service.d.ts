import { Logger } from '@celljs/core';
import { McpConfig, McpConfigEnvExpandOptions, McpConfigEnvExpandResult, McpConfigEnvExpandService, McpScope } from './mcp-protocol';
/**
 * Service for expanding environment variables in MCP configurations.
 *
 * Handles `${VAR_NAME}` and `${VAR_NAME:-default}` placeholders in:
 * - McpConfigStdio: `command`, `args[]`, `env` values
 * - McpConfigSSE/HTTP/Remote: `url`, `headers` values
 *
 * Variables with default values (e.g., `${VAR:-default}`) always succeed.
 * Missing variables without defaults are preserved as-is and reported as diagnostics.
 *
 * @example
 * // Variables with defaults always succeed:
 * "${API_URL:-https://api.example.com}" → uses default if API_URL is not set
 *
 * // Variables without defaults report warnings:
 * "${API_KEY}" → reported as missing if API_KEY is not set
 */
export declare class McpConfigEnvExpandServiceImpl implements McpConfigEnvExpandService {
    protected readonly logger: Logger;
    expandConfig(name: string, config: McpConfig, scope: McpScope, options?: McpConfigEnvExpandOptions): McpConfigEnvExpandResult;
    /**
     * 脱敏诊断日志：汇总 URL 类 config 里原始含 `${VAR}` 占位符的 header / url，
     * 打出插值后的**状态**而非明文。
     *
     * 每个 header 状态取值：
     * - `missing` —— 解析后仍是 `${...}` 占位符（env 未注入，会导致指纹与"注入后"不一致）
     * - `empty`   —— 解析成空串
     * - `<前4字符>…(len=N)` —— 成功解析（脱敏预览，绝不打完整值）
     *
     * 只有当原始 url/headers 里出现过 `${` 时才打日志（避免无插值 config 刷屏）。
     */
    private logEnvExpansion;
    /**
     * Expand environment variables in a stdio config.
     * Returns a new config object, does not modify the original.
     */
    private expandStdioConfig;
    /**
     * Expand environment variables in a URL-based config (SSE, HTTP, Remote).
     * Returns a new config object, does not modify the original.
     */
    private expandUrlConfig;
}
