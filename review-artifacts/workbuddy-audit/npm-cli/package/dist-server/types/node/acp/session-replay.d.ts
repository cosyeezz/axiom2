import { type SessionNotification } from '@genie/agent-client-protocol';
import { type Session } from '../../vendor/cbc-core/node/index.js';
import type { AgentSideConnection } from './acp-protocol';
export interface SessionReplaySessionUpdateEvent {
    type: 'sessionUpdate';
    sessionId: string;
    update: SessionNotification['update'];
    _meta?: Record<string, unknown>;
}
export interface SessionReplayExtNotificationEvent {
    type: 'extNotification';
    sessionId: string;
    method: string;
    params: Record<string, unknown>;
}
export type SessionReplayEvent = SessionReplaySessionUpdateEvent | SessionReplayExtNotificationEvent;
export interface SessionReplaySnapshot {
    busy: boolean;
    activeGoal: {
        condition: string;
        createdAt: number;
        paused?: boolean;
        pausedAt?: number;
    } | null;
}
/**
 * 刷新 / session/load 回放结束时的权威快照。
 * Web UI 用它恢复 isAgentRunning、goal 条、暂停按钮，而不是从历史事件猜。
 */
export declare function buildSessionReplaySnapshot(session: Session): SessionReplaySnapshot;
interface ReplayLogger {
    debug?: (message: string) => void;
    info?: (message: string) => void;
    warn?: (message: string) => void;
}
/**
 * Replay 行为选项。不同宿主产品对"历史展示语义"有不同期望，
 * 通过该选项由调用方显式声明，避免在共享代码里硬编码产品差异。
 */
export interface SessionReplayOptions {
    /**
     * Optional MCP UI resource reader used to enrich URI-only replay payloads
     * with prefetched HTML, avoiding first-paint resource pull from the browser.
     */
    mcpUiResourceReader?: (serverName: string, uri: string) => Promise<Array<{
        mimeType?: string;
        text?: string;
    }>>;
    /** Maximum time to spend prefetching each MCP UI HTML payload during replay. */
    mcpUiPrefetchTimeoutMs?: number;
    /**
     * 是否让前端看到压缩点（compact）之前的完整历史。
     *
     * - `true`：回溯时跨越 parentId 链断裂点，通过 `logicalParentId` 继续向前，
     *           展示压缩之前的所有消息。适用于有完整聊天视图的宿主
     *           （用户期望往上滚能看到压缩前的对话）。
     * - `false`（默认）：严格沿 `parentId` 链回溯，压缩点之前的历史对前端不可见。
     *           保持老行为，适用于仅展示"当前有效对话链"的宿主（CLI、HTTP API 等）。
     *
     * 注意：此选项只影响 replay（给前端展示），不影响发送给模型的上下文。
     * 模型侧历史仍由 history-interceptors / agent-service 独立组装，压缩效果不受影响。
     */
    showPreCompactHistory?: boolean;
    /**
     * Optional mutable timing bucket filled by replay collection. This keeps
     * instrumentation out of the hot event shape while still letting HTTP
     * callers report where replay time went.
     */
    timing?: SessionReplayTiming;
    /**
     * 目标客户端是否声明了 ACP v2 terminal-output 能力
     * （`_meta['codebuddy.ai'].terminalOutput`）。
     *
     * 与实时推送同一道门禁：`terminal_update` 不在 v1 的 SessionUpdate union 里，未声明的
     * 客户端不该在重放里收到它。缺省 false —— 保守方向，宁可少发也不给不认识它的客户端
     * 塞非标准帧。
     */
    terminalOutputEnabled?: boolean;
    /**
     * 是否在终端状态快照里带上**输出字节**（`terminal_update.output`）。
     *
     * 与 {@link terminalOutputEnabled} 分开的理由和实时推送一致：只声明
     * `terminalOutput` 的存量客户端不渲染输出，给它们塞一份可能上兆的 base64 纯属
     * 浪费带宽。门禁对应客户端能力位 `terminalOutputChunk`。
     *
     * 缺省 false。
     */
    terminalOutputChunkEnabled?: boolean;
    /**
     * Web UI 刷新需要 busy/goal 快照，以及 busy 时不要把进行中工具标成 cancelled。
     * 缺省 false：WorkBuddy 等 --acp 客户端保持旧回放。
     */
    webUiClient?: boolean;
    /**
     * 非 Web UI 宿主（如 WorkBuddy）声明 `_meta['codebuddy.ai'].goalSnapshotReplay` 后，
     * 回放结束时同样带上 `sessionSnapshot`（busy + activeGoal），让宿主能把「目标进行中」
     * 的状态条恢复出来——否则刷新 / 切走再回来状态条就没了。
     *
     * 与 {@link webUiClient} 分开的理由：**回放**阶段的 goal 转录项
     * （{@link isWebUiOnlyReplayUpdate}）仍只发给 Web UI —— 回放是按 history item 逐条重放的，
     * 宿主只需最后一张快照收敛，不必在转录里重放 goal-status 项。
     *
     * 注意与**实时**通道的分工：声明了本能力位的宿主在实时通道里会收到 goalStatus /
     * goalResult 状态帧（AcpBroadcastService.broadcastGoalHistoryItem，收件人同为
     * getSessionFrameRecipients），宿主（workbuddy-core）把它们消费成目标投影而不是聊天正文。
     * 缺省 false，opt-in。
     */
    goalSnapshotReplay?: boolean;
}
/** 客户端能力位：`_meta['codebuddy.ai'].goalSnapshotReplay`。 */
export declare function clientSupportsGoalSnapshotReplay(capabilities: unknown): boolean;
export interface SessionReplayTiming {
    /** History items selected for replay after compact/revert filtering. */
    activeItems?: number;
    /** Time spent converting history items to ACP updates. */
    convertMs?: number;
    /** Number of replay events returned to the caller. */
    events?: number;
    /** Time spent restoring checkpoint metadata. */
    checkpointMs?: number;
}
/**
 * 宿主通过环境变量声明 replay 展示能力的环境变量名。
 *
 * 设计原则：agent-cli 不识别具体宿主产品，只响应宿主声明的"能力开关"，
 * 避免共享代码反向依赖具体产品。支持的值：`'1'` / `'true'`（不区分大小写）。
 */
export declare const REPLAY_SHOW_PRE_COMPACT_ENV = "CODEBUDDY_REPLAY_SHOW_PRE_COMPACT";
/**
 * 读取宿主声明的"展示压缩前历史"能力开关。
 */
export declare function isReplayShowPreCompactEnabled(): boolean;
export declare function collectSessionReplayEvents(session: Session, logger?: ReplayLogger, options?: SessionReplayOptions): Promise<SessionReplayEvent[]>;
export declare function emitSessionReplayEvents(connection: Pick<AgentSideConnection, 'sessionUpdate' | 'extNotification'>, events: SessionReplayEvent[], latestSnapshot?: () => SessionReplaySnapshot): Promise<void>;
export {};
