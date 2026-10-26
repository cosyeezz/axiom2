import { type StdioChannel } from '../utils/stdio-persistence';
export declare const StdoutWriter: unique symbol;
export type StdoutWriteOutcome = 'written' | 'failed';
export interface StdoutWriter {
    /** Serialize `data` as one JSON line. Never throws. */
    write(data: unknown): void;
    /** Enqueue a line (appending a missing newline); optional callback reports physical write outcome. Never throws. */
    writeLine(line: string, onWritten?: (outcome: StdoutWriteOutcome) => void): void;
    /** Resolves once every enqueued line has been handed to the fd (or dropped on error). */
    flush(): Promise<void>;
    /**
     * Wait for the queue to drain with a STALL bound rather than an absolute one:
     * as long as the consumer keeps accepting writes (progress), keep waiting —
     * a slow-but-alive consumer is never cut off. Give up only after
     * `stallTimeoutMs` of ZERO progress (consumer provably stuck/gone).
     * Never rejects.
     */
    flushOrStall(stallTimeoutMs: number): Promise<{
        complete: boolean;
        remainingBytes: number;
    }>;
    /** Characters currently retained by the stdout queue and active write. */
    readonly bufferedCharacters: number;
    /** Serialized string characters waiting in the optional stdio persistence channel. */
    readonly persistenceBufferedCharacters: number;
    /** Number of lines dropped because the physical write failed. */
    readonly failedWrites: number;
    /**
     * Attach（or 替换）stdio 持久化通道；未 attach 时 tap 是 no-op。
     * 由 stream-json 模式的驱动逻辑在拿到 sessionId 后调用；调用前累积的
     * 消息通过 attach 时可选传入的 `backlog` 一次性回放到通道。
     *
     * 传 null 显式清除。
     */
    attachPersistChannel(channel: StdioChannel | null, backlog?: unknown[]): void;
    /**
     * 打开 pre-attach 输出缓冲。开启后 `writeLine` 会把每条消息同时压进内部
     * 缓冲区（cap 4096），直到 `attachPersistChannel` 时统一回放到通道并清空。
     * 未 arm 时不缓冲，热路径零额外开销。
     *
     * 由 stream-json 驱动逻辑在 executeStreamMode 入口调用，因为此时 sessionId
     * 尚未拿到但 stdout 已经会发出 initialize control_response / system init
     * 等消息 —— 不预缓冲这些消息就永远无法落盘。
     */
    armPersistPrebuffer(): void;
    /**
     * CLI 退出前 flush 已 attach 的持久化通道。未 attach 时立即 resolve。
     * 永不 reject —— 落盘失败在 append 阶段已被静默计数。
     */
    flushPersistChannel(): Promise<void>;
}
export declare class StdoutWriterImpl implements StdoutWriter {
    private queue;
    private queuedBytes;
    private inFlightBytes;
    private pumping;
    private idleWaiters;
    /** Invoked after each physical write settles — the stall detector's progress signal. */
    private progressListeners;
    private _failedWrites;
    private loggedFailures;
    /**
     * stdio 持久化通道。由 stream-json 驱动逻辑在拿到 sessionId 后 attach。
     * 未 attach 时 `tapPersist` 是 no-op，热路径无额外开销。
     */
    private persistChannel;
    /**
     * attach 之前所有 stdout 消息的 pre-attach 缓冲。sessionId 在首个 HTTP
     * response 之后才知道；response 到手时 CLI 通常已经 stdout 推过 initialize
     * control_response / system init / status / file-history-snapshot / 甚至
     * error result 等消息 —— 不缓冲就永远拿不到这些"session 生成前"的 stdout。
     * cap 防内存爆炸；启用 stdio 持久化时才积累（`_persistArmed` 门控）。
     */
    private outputPrebuffer;
    private _persistArmed;
    private static readonly PREBUFFER_CAP;
    get bufferedCharacters(): number;
    get persistenceBufferedCharacters(): number;
    get failedWrites(): number;
    attachPersistChannel(channel: StdioChannel | null, backlog?: unknown[]): void;
    armPersistPrebuffer(): void;
    flushPersistChannel(): Promise<void>;
    private tapPersist;
    private appendChunkToChannel;
    write(data: unknown): void;
    writeLine(line: string, onWritten?: (outcome: StdoutWriteOutcome) => void): void;
    flush(): Promise<void>;
    flushOrStall(stallTimeoutMs: number): Promise<{
        complete: boolean;
        remainingBytes: number;
    }>;
    private kickPump;
    private pump;
    /**
     * One physical write. Resolves when the runtime reports the chunk as
     * handled (callback fired) — success or failure alike; failures are
     * counted and logged, never thrown.
     */
    private writeChunk;
    /**
     * Log to the file logger only — stdout itself is the failing component,
     * so no console fallback. Throttled: the first failure and then every
     * 100th, to avoid log storms while keeping the signal.
     */
    private reportFailure;
}
