/**
 * Liveness Watchdog
 *
 * 定期检查"最近一次活动时间"是否陈旧，陈旧即触发 onStuck 让调用方自定义恢复。
 *
 * 主要场景：macOS 屏幕锁屏 / App Nap 会冻结进程的定时器和网络栈：
 * - HTTP 长轮询：fetch 卡在 await，调用方 abort 当前请求让 catch 路径恢复
 * - WebSocket 心跳：ping 没回 pong，调用方 ws.close() 触发 onclose → 重连
 *
 * 关键：watchdog 定时器**不能 unref()**。unref 的定时器在 App Nap 下会被冻结
 * 而且不会"补发"——保留 ref 后系统才会在解冻瞬间触发回调，这才是恢复的核心机制。
 */
import type { Logger } from '@genie/telemetry';
/** watchdog 默认检查间隔（30s）。 */
export declare const DEFAULT_LIVENESS_CHECK_INTERVAL_MS = 30000;
/**
 * 默认卡死阈值（90s）。
 * HTTP 长轮询：35s 长轮询 + 10s timeout = 45s，给一倍 buffer 应付正常网络抖动。
 * WebSocket：30s 心跳 + 30s 等待 = 60s，加 30s buffer。
 */
export declare const DEFAULT_LIVENESS_STUCK_MS = 90000;
export interface LivenessWatchdogDeps {
    /** 是否仍应继续监测。watchdog 在 false 时跳过检查（如 disconnected 状态）。 */
    isActive(): boolean;
    /** 取得最近一次活动时间戳（ms since epoch）。 */
    getLastActivityAt(): number;
    /**
     * 卡死时由调用方决定如何恢复：
     * - HTTP 长轮询场景：abort 当前请求
     * - WebSocket 场景：ws.close() 触发 onclose 重连
     * 实现内**应当**自己刷新 lastActivityAt 或确保短期不会再被 stuck 触发。
     * elapsedMs 是当前 stuck 持续时间，便于日志和打点。
     */
    onStuck(elapsedMs: number): void;
    /** 日志输出（stuck 触发时打 warn）。 */
    logger: Logger;
    /** 日志 / 异常打印用的标签，例如 'wechat-poll' / 'wecom-ws'。 */
    label: string;
}
export interface LivenessWatchdogOptions {
    /** 检查间隔，默认 DEFAULT_LIVENESS_CHECK_INTERVAL_MS */
    intervalMs?: number;
    /** 卡死阈值，默认 DEFAULT_LIVENESS_STUCK_MS */
    stuckMs?: number;
}
export declare class LivenessWatchdog {
    private readonly deps;
    private timer;
    private readonly intervalMs;
    private readonly stuckMs;
    constructor(deps: LivenessWatchdogDeps, options?: LivenessWatchdogOptions);
    start(): void;
    stop(): void;
    /** 单次检查（暴露用于单测，不需要等真实定时器） */
    tick(): void;
}
