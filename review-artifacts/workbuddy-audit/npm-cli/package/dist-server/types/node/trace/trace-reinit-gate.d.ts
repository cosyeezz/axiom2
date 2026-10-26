/** 标记一轮 turn 的 root span 已打开；返回幂等的 release（关闭时调用一次）。 */
export declare function markTraceTurnOpen(): () => void;
/** 当前是否有 turn 的 root span 开着。 */
export declare function isTraceTurnOpen(): boolean;
/**
 * 无 turn 开着时立即执行 reinit；否则挂起，等所有 turn 关闭后执行最新一次。
 * 「最新覆盖」：turn 期间多次 config 变化只在收尾时应用最后一版。
 */
export declare function deferReinitUntilTurnsClose(reinit: () => void): void;
/** 仅测试用：重置内部状态。 */
export declare function __resetTraceReinitGateForTest(): void;
