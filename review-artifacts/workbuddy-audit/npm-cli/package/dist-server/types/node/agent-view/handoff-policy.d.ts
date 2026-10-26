/**
 * 会话转后台的策略判定 —— 纯函数，无 I/O。
 *
 * 对照 Claude Code v2.1.216 bundle：
 * - `jA_` / `qA_`（策略）
 * - `nTo` / `GA_`（betweenCalls）
 * - `DXe` 拒绝文案
 */
/** 成功交接时选用的路径 */
export type HandoffVia = 'idle-fork' | 'defer-then-fork' | 'abort-then-fork' | 'detach';
/** 拒绝转后台的原因 */
export type HandoffRefusal = 'fleet-disabled' | 'remote' | 'persistence' | 'loading' | 'queued-commands' | 'ended-by-model';
export type HandoffDecision = {
    ok: true;
    via: HandoffVia;
} | {
    ok: false;
    reason: HandoffRefusal;
};
/** `resolveHandoffStrategy` 的输入快照 */
export interface HandoffStrategyState {
    /** 当前已是后台会话（attach 中）→ 只 detach */
    isBg: boolean;
    /** agent view / fleet 是否开启 */
    fleetEnabled: boolean;
    /** 远端会话 */
    isRemote: boolean;
    /** 会话持久化关闭 */
    persistenceDisabled: boolean;
    /** 外部加载态（例如正在恢复）—— 不可转后台 */
    isExternalLoading: boolean;
    /** 当前轮次是否在跑（模型/工具活跃） */
    isLoading: boolean;
    /** 上一轮已收尾、只是在等工具（见 `isBetweenCalls`） */
    betweenCalls: boolean;
}
/** 判定 betweenCalls 用的最小消息形状 */
export interface HandoffTranscriptMessage {
    type?: string;
    /** Native session history uses `type: 'message'`; direction lives here. */
    role?: string;
    /** Persistent turn status; only `completed` means the turn is closed. */
    status?: string;
    message?: {
        stop_reason?: string | null;
    };
}
/** 等工具降级 / flush 超时常量（与 Claude `tengu_defer_cap_ms` / `TxS` / flush 超时对齐） */
export declare const DEFER_CAP_MS = 10000;
export declare const DEFER_PRESS_DEBOUNCE_MS = 1000;
export declare const FLUSH_TIMEOUT_MS = 2000;
/** 在跑工作条目（adopt 清单的元素，见 session-handoff 的 carryTasks） */
export interface InFlightTask {
    kind: string;
    id: string;
    label: string;
    /** 显式标记是否可搬走；未给时由消费侧按 kind 自行判定 */
    canCarry?: boolean;
    /** subagent：子会话 UUID，adopt 后可按 transcript 找回 */
    sessionId?: string;
    /** subagent：agent 类型 */
    agentType?: string;
    /** shell：stdout 落盘路径（file-fd 模式），worker 侧重挂输出用 */
    outputFilePath?: string;
    /** shell：stderr 落盘路径 */
    outputStderrPath?: string;
}
export interface RefusalMessageContext {
    /** `queued-commands` 时必填 */
    queuedCommandCount?: number;
}
/**
 * 从会话状态选出转后台策略。
 * 判定顺序与 Claude `jA_` 一致。
 */
export declare function resolveHandoffStrategy(state: HandoffStrategyState): HandoffDecision;
/**
 * 「上一轮已收尾、现在只是在等工具」：
 * 输入缓冲为空，且从末尾看，助手尚未处于 `stop_reason === null` 的未收尾态。
 * （对照 Claude `nTo` / `GA_`）
 */
export declare function isBetweenCalls(messages: readonly HandoffTranscriptMessage[], hasPartialInput: boolean): boolean;
/**
 * Whether the transcript stops inside a user-initiated, unfinished turn.
 *
 * Skip reasoning/tool frames from the tail and inspect the last user/assistant
 * record. A final user record means output has not started; an assistant record
 * is unfinished when its persisted status is incomplete (or its stop reason is
 * still null). A completed assistant record closes the turn.
 */
export declare function hasUnfinishedTurn(messages: readonly HandoffTranscriptMessage[]): boolean;
/** 每个拒绝原因产出一条用户可见文案 */
export declare function refusalMessage(reason: HandoffRefusal, context?: RefusalMessageContext): string;
