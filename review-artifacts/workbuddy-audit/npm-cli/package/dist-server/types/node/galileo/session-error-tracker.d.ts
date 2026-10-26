/**
 * SessionErrorTracker — per-prompt 轻量级错误追踪
 *
 * 独立模块，不修改任何已有逻辑。已有 hook 通过插桩调用本模块记录错误事件，
 * prompt 结束时由 acp-agent 读取快照来精细判定 TaskOutcome。
 *
 * 生命周期：prompt() 入口 reset → hook 写入 → prompt() 出口 snapshot + cleanup
 * 内存占用：每个活跃 session 约 32 bytes，cleanup 后释放。
 */
export declare const SessionErrorTracker: unique symbol;
export interface ErrorSnapshot {
    /** 本次 prompt 内模型请求失败次数 */
    modelErrorCount: number;
    /** 本次 prompt 内模型请求成功次数（在错误之后的成功视为"恢复"） */
    modelSuccessAfterErrorCount: number;
    /** 本次 prompt 内工具执行失败次数 */
    toolErrorCount: number;
}
export interface SessionErrorTracker {
    /** prompt 开始时重置计数器 */
    reset(sessionId: string): void;
    /** 记录一次模型请求失败 */
    recordModelError(sessionId: string): void;
    /** 记录一次模型请求成功 */
    recordModelSuccess(sessionId: string): void;
    /** 记录一次工具执行失败 */
    recordToolError(sessionId: string): void;
    /** 取当前快照（不清除） */
    snapshot(sessionId: string): ErrorSnapshot;
    /** 清理该 session 的计数器 */
    cleanup(sessionId: string): void;
}
export declare class SessionErrorTrackerImpl implements SessionErrorTracker {
    private counters;
    reset(sessionId: string): void;
    recordModelError(sessionId: string): void;
    recordModelSuccess(sessionId: string): void;
    recordToolError(sessionId: string): void;
    snapshot(sessionId: string): ErrorSnapshot;
    cleanup(sessionId: string): void;
    private getOrCreate;
    /** 防御性清理：移除超时未活动的 session 计数器 */
    private evictStale;
}
