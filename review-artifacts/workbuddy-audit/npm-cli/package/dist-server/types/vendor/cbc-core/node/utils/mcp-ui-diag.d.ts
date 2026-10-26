/**
 * MCP App 反向 tools/call（mcp-ui intercept）专用诊断埋点。
 *
 * 用途：排查"弹窗一闪而过 / display_pdf 卡 loading / 分片每片都弹"等
 * mcp-ui 反向调用链路问题。串联事件按 `toolCallId` 对齐：
 *   enqueue → approval-enter → race-winner / catch-reject →
 *   sandbox-reject / cancel-sweep → sandbox-resolve
 *
 * 默认**常开**（不依赖环境变量）：
 *   - 这条链路低频（只在 mcp-app widget 反向调用时触发），不会刷量。
 *   - 排查问题时可以直接 `grep '[McpUiDiag]' ~/.codebuddy/logs/<date>/agent-cli__*.log`
 *     无需重启或额外配置。
 *
 * 等级：使用 logger.info（不是 warn），避免无故污染告警通道。
 *
 * 客户端对应埋点在 `web-ui/src/utils/mcp-ui-diag.ts`，使用 `console.debug`
 * 输出，浏览器 Console 默认折叠 debug 级，不影响日常使用，需要时 DevTools
 * 调到 Verbose 即可看到。
 */
interface MinimalLogger {
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
}
interface DiagFields {
    /** 事件名（必填）：enqueue / approval-enter / race-winner / catch-reject / sandbox-reject / cancel-sweep / sandbox-resolve */
    event: string;
    /** 串联同一审批链路的主键 */
    toolCallId?: string;
    sessionId?: string;
    /** 任意补充字段，会按 key=value 拼到行尾 */
    [key: string]: string | number | boolean | undefined;
}
/**
 * 打一条 mcp-ui 诊断日志。
 *
 * @param logger 任何带 info?(string) 方法的 logger（CellJS Logger 兼容）
 * @param fields 事件字段，必含 event；其余 key=value 拼接
 * @param includeStack 是否附带调用栈（用于"谁拍掉了弹窗"类追溯，默认 false）
 */
export declare function logMcpUiDiag(logger: MinimalLogger | undefined, fields: DiagFields, includeStack?: boolean): void;
export {};
//# sourceMappingURL=mcp-ui-diag.d.ts.map