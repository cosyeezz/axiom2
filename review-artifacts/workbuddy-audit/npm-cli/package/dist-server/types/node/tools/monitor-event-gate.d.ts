/**
 * Monitor 事件闸门：合并 → 截断 → 限流，决定一段增量输出要不要、以什么形态唤醒模型（issue #144413）。
 *
 * 每条 `<monitor-event>` 都会在主 agent 空闲时起一轮完整上下文的模型调用，所以"推多少条"
 * 直接就是成本。机制与参数对齐 Claude Code Monitor（2.1.296 实测）：
 *
 * 1. **合并**：command 源 200ms 窗口内的输出合并成一个事件。ws 源不合并——一条消息一个事件
 *    是协议语义（`batchWindowMs: 0`）。
 * 2. **截断**：单行超 500 字符、单个事件超 3000 字符截断，保留开头（与 CC 一致）。完整输出
 *    仍在 TruncateBuffer 里，模型需要时用 TaskOutput 取，事件只负责"告诉模型发生了什么"。
 * 3. **限流**：令牌桶，容量 10、每 2s 回 1 个。没令牌的事件不推（计数），下一次拿到令牌时
 *    把"有 N 个事件被丢弃"随同这次事件一起交出去——同一条消息、只唤醒一次。
 * 4. **刷屏熔断**：持续被限流超过 30s 视为刷屏，调用 `onFlood` 让宿主停掉这个 watch。
 *    "持续"指相邻两次丢弃间隔不超过 3 个回填周期：稳定高于 1 个/2s 的源即使仍有一半事件
 *    送达也会被熔断——这是有意的（与 CC 一致），这样的源本身就在持续唤醒模型。
 *
 * 与 CC 的一处有意差异：CC 只在"推丢弃提示"那一刻判断是否重置刷屏起点，若限流结束后再
 * 没有被丢弃的事件，起点永不重置，很久以后的一次偶发限流会被误判为持续刷屏而立即熔断。
 * 这里在任何一次成功投递时，只要距上次被丢弃已超过 3 个回填周期就重置起点。
 */
export declare const MONITOR_BATCH_WINDOW_MS = 200;
export declare const MONITOR_MAX_LINE_CHARS = 500;
export declare const MONITOR_MAX_EVENT_CHARS = 3000;
export declare const MONITOR_RATE_CAPACITY = 10;
export declare const MONITOR_RATE_REFILL_MS = 2000;
export declare const MONITOR_FLOOD_STOP_MS = 30000;
/**
 * 把一段原始输出整理成事件文本：去掉空白行与行尾空白（含 CRLF 的 `\r`），超长行 / 超长事件截断。
 * 全是空白时返回空串，调用方据此不推事件。行首空白保留（堆栈缩进有信息量）。
 */
export declare function truncateMonitorEventText(raw: string): string;
export interface MonitorFloodStats {
    /** 本次刷屏期间被丢弃的事件数。 */
    suppressed: number;
    /** 从第一次被丢弃到熔断的时长。 */
    durationMs: number;
}
export interface MonitorEventGateOptions {
    /**
     * 推一个输出事件（已截断）。`suppressedBefore` > 0 表示在它之前有这么多事件因限流
     * 被丢弃，宿主应把这条提示与输出放进同一条通知里。
     */
    deliver: (text: string, suppressedBefore: number) => void;
    /** 持续刷屏，闸门已关闭；宿主负责停掉 watch 并发收尾事件。 */
    onFlood: (stats: MonitorFloodStats) => void;
    /** 合并窗口；0 = 不合并，每次 push 立即判定。默认 {@link MONITOR_BATCH_WINDOW_MS}。 */
    batchWindowMs?: number;
    /** 单测注入时钟。 */
    now?: () => number;
}
export declare class MonitorEventGate {
    private readonly options;
    private readonly batchWindowMs;
    private readonly now;
    private pending;
    private batchTimer;
    private closed;
    private delivered;
    private tokens;
    private lastRefillAt;
    /** 自上次随事件告知以来被丢弃的事件数。 */
    private suppressedSinceNotice;
    /** 本轮刷屏（从 floodStartedAt 起）累计被丢弃的事件数。 */
    private suppressedInFlood;
    private floodStartedAt;
    private lastSuppressedAt;
    constructor(options: MonitorEventGateOptions);
    /** 已投递的输出事件数，用于到期收尾事件里告诉模型这个 watch 的产出。 */
    get eventCount(): number;
    /** 被丢弃、且还没随任何事件告知模型的事件数；watch 结束时由收尾事件告知。 */
    get undeliveredSuppressed(): number;
    get isClosed(): boolean;
    push(chunk: string): void;
    /**
     * watch 正常结束（自然退出 / 到期）前调用：立即交出窗口里攒着的尾巴，**不受限流约束**、
     * 也不会触发熔断。尾巴往往就是模型在等的结果行，且收尾事件本来就会唤醒模型一次，
     * 尾巴与它同一 tick 入队，不额外增加唤醒。
     */
    flushFinal(): void;
    /** 关闭闸门并丢弃未判定的输出；之后的 push / flush 都是空操作。 */
    close(): void;
    private clearBatchTimer;
    private flushPending;
    private offer;
    private tryConsume;
}
