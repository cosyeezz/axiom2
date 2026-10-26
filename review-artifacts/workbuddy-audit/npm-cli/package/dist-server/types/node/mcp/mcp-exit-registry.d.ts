/**
 * MCP Streamable HTTP 会话的进程级退出注册表。
 *
 * transport 的创建方负责注册、正常关闭后注销；这里不依赖 DI 或 transport cache，
 * 因而也能覆盖 isolated transport，并在进程退出时统一执行 DELETE。
 */
/** 退出注册表只依赖 MCP HTTP 会话终止所需的最小能力。 */
export interface McpSessionTerminator {
    readonly sessionId?: string;
    terminateSession(): Promise<void>;
}
/** 注册一个 HTTP 会话，并返回幂等注销函数。 */
export declare function registerMcpSessionTerminator(terminator: McpSessionTerminator): () => void;
/** 正常关闭与退出兜底共享同一个终止请求，避免并发发送重复 DELETE。 */
export declare function terminateMcpSession(terminator: McpSessionTerminator): Promise<void>;
/** 有活跃会话时返回全部 DELETE 的完成 Promise；无会话时保持同步退出路径。 */
export declare function terminateAllMcpSessions(): Promise<void> | undefined;
