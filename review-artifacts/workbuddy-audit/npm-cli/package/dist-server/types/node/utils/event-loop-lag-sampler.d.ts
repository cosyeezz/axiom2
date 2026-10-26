/**
 * 事件循环延迟诊断（#141406）。与 apps/workbuddy-desktop/src/main/system/logging/event-loop-lag-sampler.ts
 * 保持一致（各包各放一份，与 process-cpu-sampler 的做法相同）。
 *
 * 两路互补的观测：
 * - histogram：`perf_hooks.monitorEventLoopDelay` 的窗口 max / p99，随 MemWatch 行一起输出，
 *   回答「这一分钟内最长被挡住多久」；
 * - 心跳：固定间隔的定时器，实际执行比预期晚 ≥ stallThresholdMs 时回调一次，给出
 *   预期执行时间、实际执行时间和调度延迟。只能说明这段时间内事件循环没有轮到定时器，
 *   不能指出阻塞代码，也不承诺精确的阻塞起止。
 *
 * 只读取已有计数，不做任何同步 IO；定时器全部 unref，不影响进程退出。
 */
export interface EventLoopStallEvent {
    /** 定时器预期执行的墙钟时间（ISO，UTC）。 */
    expectedAt: string;
    /** 定时器实际执行的墙钟时间（ISO，UTC）。 */
    actualAt: string;
    /** 调度延迟（毫秒）。 */
    lagMs: number;
}
export interface EventLoopLagWindow {
    /** 窗口内事件循环延迟最大值（毫秒，histogram 口径）；histogram 不可用时为 undefined。 */
    maxMs: number | undefined;
    /** 窗口内事件循环延迟 p99（毫秒，histogram 口径）；histogram 不可用时为 undefined。 */
    p99Ms: number | undefined;
    /** 窗口实际长度（毫秒）。 */
    windowMs: number;
    /** 窗口内心跳检测到的延迟次数（≥ stallThresholdMs）。 */
    stalls: number;
    /** 因限流未单独回调的延迟次数。 */
    suppressedStalls: number;
}
export interface EventLoopLagSampler {
    /** 读取并重置当前窗口。 */
    takeWindow(): EventLoopLagWindow;
    /**
     * 最近 windowMs 内心跳观测到的最大调度延迟（毫秒，不重置窗口）。包含尚未结束的阻塞：
     * 调用时距上一次心跳已超出间隔的部分也计入。只保留最近 RECENT_TICKS 次心跳。
     */
    maxLagWithin(windowMs: number): number;
    /** 将窗口统计格式化为可追加到 MemWatch 行的字段。 */
    formatWindowFields(): string[];
    dispose(): void;
}
interface DelayHistogram {
    enable(): boolean | void;
    disable(): boolean | void;
    reset(): void;
    readonly max: number;
    percentile(percentile: number): number;
}
export interface EventLoopLagSamplerOptions {
    onStall?: (event: EventLoopStallEvent) => void;
    /** 心跳间隔，默认 1000ms。 */
    heartbeatMs?: number;
    /** 判定为延迟的阈值，默认 2000ms。 */
    stallThresholdMs?: number;
    /** 每个窗口最多单独回调的延迟次数，默认 10。 */
    maxStallEventsPerWindow?: number;
    /** 测试注入：单调时钟（毫秒）。 */
    monotonicNow?: () => number;
    /** 测试注入：墙钟（毫秒）。 */
    wallNow?: () => number;
    /** 测试注入：histogram 工厂。 */
    createHistogram?: () => DelayHistogram;
    /** 测试注入：定时器。 */
    setIntervalFn?: (handler: () => void, ms: number) => {
        unref?: () => unknown;
    };
    clearIntervalFn?: (timer: unknown) => void;
}
export declare function createEventLoopLagSampler(options?: EventLoopLagSamplerOptions): EventLoopLagSampler;
export declare function formatEventLoopStall(tag: string, event: EventLoopStallEvent): string;
export {};
