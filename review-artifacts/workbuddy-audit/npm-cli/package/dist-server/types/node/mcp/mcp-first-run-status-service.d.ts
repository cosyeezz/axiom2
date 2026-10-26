import { type Observable } from 'rxjs';
import { type IMcpFirstRunStatusService, McpFirstRunServerState, McpFirstRunStatusEvent } from './mcp-first-run-status-protocol';
/**
 * 首轮 MCP prewait 状态事件源。见 `mcp-first-run-status-protocol.ts` 的说明。
 *
 * 事件流用 BehaviorSubject 实现，晚订阅者（如 TUI 首次挂载滞后于 agent-manager
 * 首个 emit 的场景）能立即拿到最新一条事件而不错过 start / finish。
 *
 * 内部维护每 server 的终态哈希，用于：
 *1. 去重（同一 name 重复 emit 同一终态时不重复通知）。
 * 2. emitFinish 时自动补齐未 settle 的 server为 timeout（对齐 codex
 *`finish_mcp_startup_after_lag`）。
 */
export declare class McpFirstRunStatusServiceImpl implements IMcpFirstRunStatusService {
    private readonly subject;
    /** start 事件声明的目标 server 集合，用于 completed / total 计算与 finish 补齐。 */
    private startedServers;
    /** 已 emit 过终态的 server → 终态 state 缓存。 */
    private serverTerminalStates;
    /** finish 是否已 emit —— 若已 finish，后续 server 事件被丢弃，避免二轮串味。 */
    private finished;
    get events$(): Observable<McpFirstRunStatusEvent>;
    emitStart(input: {
        servers: readonly string[];
    }): void;
    emitServer(input: {
        name: string;
        state: McpFirstRunServerState;
        error?: string;
    }): void;
    emitFinish(input?: {
        failed?: readonly string[];
        timedOut?: readonly string[];
    }): void;
    reset(): void;
    getSnapshot(): McpFirstRunStatusEvent | undefined;
}
