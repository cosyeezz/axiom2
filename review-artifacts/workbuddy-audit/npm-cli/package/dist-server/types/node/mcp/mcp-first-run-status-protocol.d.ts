import type { Observable } from 'rxjs';
/**
 * The first-run MCP prewait gate deadline (ms) is env-overridable.
 * `CODEBUDDY_FIRST_RUN_MCP_PREWAIT_TIMEOUT_MS=0` disables the wait entirely —
 * the first prompt dispatches immediately with whatever MCP tools have already
 * indexed, and the model is expected to call `WaitForMcpServers` when a
 * currently-connecting server is needed. Live-read because activate() may
 * merge session env after cold start (see CODEBUDDY.md §"env 消费同理").
 * The MCP servers a served session starts in its execution environment wait
 * the value the session's host states first, and this only when it states
 * none (`resolveSessionMcpFirstPromptWaitMs`).
 */
export declare function resolveFirstRunMcpPrewaitTimeoutMs(): number;
/**
 * MCP first-run status service symbol (CellJS DI).
 *
 * 首次会话 MCP prewait 期间的 per-server 连接状态事件源。UI（TUI 顶部状态行）
 * 与 stdio stream-json writer 订阅同一 Observable，避免各自去反向订阅
 * `McpManager.serverCollectionSubject` 派生这份状态。
 *
 * 只由 `AgentManager.runFirstSessionMcpPrewait` 在首个session 的 prewait
 * 期间 emit，与现有 `sessionMcpPrewaitCompleted` 语义一致，后续轮次不再触发。
 */
export declare const McpFirstRunStatusService: unique symbol;
/**
 * Per-server 状态过渡。语义对齐 codex `McpStartupStatus`（rs侧）：
 * - `connecting`：进入等待集合，尚未 settle
 * - `ready`：已成功连接（对齐 `McpServerStatus.CONNECTED`）
 * - `failed`：物理/认证失败（其它非CONNECTED 终态：DISCONNECTED / UNAUTHORIZED
 *   等，或伴随 `McpServerModel.error`）
 * - `timeout`：prewait 超时时仍未 settle 的 server（`finish` 前对齐 codex
 *   `finish_mcp_startup_after_lag`，把未settle 的当作 timedOut 归档）
 */
export type McpFirstRunServerState = 'connecting' | 'ready' | 'failed' | 'timeout';
export type McpFirstRunStatusEvent = {
    readonly kind: 'start';
    /** 目标 server 名（有 tools-search 时是 prewait names，否则是当前 pending 快照）。 */
    readonly servers: readonly string[];
    /** 与 `servers.length` 冗余但方便直接绑定 UI。 */
    readonly totalCount: number;
} | {
    readonly kind: 'server';
    readonly name: string;
    readonly state: McpFirstRunServerState;
    /** failed / timeout 时的原因文本（可能为空）。 */
    readonly error?: string;
    /** 当前已进入终态（ready/failed/timeout）的数量。 */
    readonly completed: number;
    readonly total: number;
} | {
    readonly kind: 'finish';
    readonly failed: readonly string[];
    readonly timedOut: readonly string[];
};
export interface IMcpFirstRunStatusService {
    /** 事件流。冷 Observable —— 订阅时立即返回最新已 emit 的事件（BehaviorSubject 语义）。 */
    readonly events$: Observable<McpFirstRunStatusEvent>;
    /**
     * 由 `AgentManager` 首轮 prewait 调用，声明本次等待覆盖的 server 集合。
     * 幂等；重复调用取最后一次（例：多 owner 场景下若各自触发首轮，仍以最新覆盖为准）。
     */
    emitStart(input: {
        servers: readonly string[];
    }): void;
    /**
     * 由 `AgentManager` 首轮 prewait 调用，更新单个 server 的状态；
     * `state` 是终态时会自动累加 completed。同一 name 重复 emit 同一终态被去重。
     */
    emitServer(input: {
        name: string;
        state: McpFirstRunServerState;
        error?: string;
    }): void;
    /**
     * 由 `AgentManager` 首轮 prewait finally emit；未在 emitServer 中标记终态的
     * `start.servers` 元素会被自动补齐为 `timeout`。
     */
    emitFinish(input?: {
        failed?: readonly string[];
        timedOut?: readonly string[];
    }): void;
    /**
     * 复位内部状态，允许下一轮首轮 prewait 再次 emit。仅供测试或异常路径调用。
     */
    reset(): void;
    /** 最近一次的事件快照（BehaviorSubject 的 value），供同步查询。 */
    getSnapshot(): McpFirstRunStatusEvent | undefined;
}
