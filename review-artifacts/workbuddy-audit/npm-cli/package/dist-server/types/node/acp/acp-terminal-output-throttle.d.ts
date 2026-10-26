/**
 * ACP v2 终端输出的节流与背压。
 *
 * 为什么需要：一次 `yarn build` / `npm test` 能在几秒内产出几 MB，而 poller 单 tick
 * 上限就是 1MB。裸转发会同时打爆三处——wire 帧过大、客户端每帧一次重渲染、客户端
 * store 无上限地累积字节（等于把 agent 的磁盘搬进渲染进程内存）。
 *
 * 三道闸：
 * 1. **时间窗合并**：窗口内的字节在内存里 concat，到点一次发出。
 * 2. **单帧上限**：一帧装不下就切成多帧连续发（顺序由 SDK 的 writeQueue 保证）。
 * 3. **累计上限**：单个终端推够量之后彻底停推，只置位 `truncated`，由调用方决定
 *    是否改推尾部快照。这一道是硬闸，没有它前两道只是把内存爆炸推迟了。
 *
 * 本模块刻意不碰 ACP 连接，只做「字节进、成帧出」的纯逻辑，方便单测直接驱动时间。
 */
export interface TerminalOutputThrottleOptions {
    windowMs?: number;
    maxFrameBytes?: number;
    maxTotalBytes?: number;
    /** 注入定时器便于测试。默认用全局 setTimeout。 */
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
}
/** 解析出本进程生效的节流参数。env 名称对齐仓库既有的回滚开关风格。 */
export declare function resolveTerminalOutputThrottleConfig(options?: TerminalOutputThrottleOptions): {
    windowMs: number;
    maxFrameBytes: number;
    maxTotalBytes: number;
};
/**
 * 按 terminalId 聚合字节并成帧输出。
 *
 * `emit` 由调用方提供，必须**同步**把帧交给传输层：本类不 await 它。这一点是顺序
 * 保证的前提——SDK 的 writeQueue 按 `sendNotification` 的调用顺序串行写，只要 emit
 * 之间不插入 await，wire 顺序就等于 emit 顺序。
 */
export declare class TerminalOutputThrottle {
    private readonly emit;
    private readonly windowMs;
    private readonly maxFrameBytes;
    private readonly maxTotalBytes;
    private readonly setTimer;
    private readonly clearTimer;
    private readonly states;
    constructor(emit: (terminalId: string, bytes: Buffer) => void, options?: TerminalOutputThrottleOptions);
    /**
     * 投递字节。超过累计上限后静默丢弃并返回 false，调用方据此决定是否改推快照。
     *
     * 传入的 Buffer 可能是零拷贝视图（poller 的 subarray），所以这里必须复制一份再
     * 攒起来——攒的内容会跨 tick 存活，而视图底下的缓冲区下一 tick 就被覆写了。
     */
    push(terminalId: string, bytes: Buffer): boolean;
    /** 该终端是否已因累计上限停推。 */
    isTruncated(terminalId: string): boolean;
    /**
     * 把待发字节全部发出。单帧装不下就切多帧，**同步连续 emit**，中间不 await，
     * 以保证 wire 顺序。
     */
    flush(terminalId: string): void;
    /**
     * 丢弃该终端的全部状态。**这是本类唯一的常驻状态**，进程级 Map 里的每一项都要有
     * 明确的删除点，否则长跑会话会一直攒着 emittedBytes 计数与可能的定时器。
     */
    dispose(terminalId: string): void;
    /** 当前跟踪的终端数，仅供测试与诊断断言"状态被清干净了"。 */
    get trackedCount(): number;
    private ensureState;
}
