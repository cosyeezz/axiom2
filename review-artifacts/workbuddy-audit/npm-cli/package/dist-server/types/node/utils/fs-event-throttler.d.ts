/**
 * 原生文件监听事件的有界合并与节流。
 *
 * 原生递归 watcher（FSEvents / ReadDirectoryChangesW / inotify）在 `git checkout`、
 * `git worktree add`、`pnpm install` 这类批量写盘时，会在几百毫秒内回调数十万次。
 * 如果每次回调都立即做异步工作（lstat、执行 hook、序列化推送），挂起的 Promise 和
 * 对象数量随事件数线性增长，足以把 daemon 的内存和事件循环拖垮。
 *
 * 这里对齐 VS Code 文件监听（`parcelWatcher.ts` 的 `ThrottledWorker` +
 * `common/watcher.ts` 的 `EventCoalescer`）的做法：
 *   - 入口只做 O(1) 的按路径合并，不做任何 I/O；
 *   - 按 `throttleMs` 节流，每次最多交付 `maxChunkSize` 条，上一批处理完（含异步）
 *     才调度下一批，形成天然背压；
 *   - 缓冲超过 `maxBuffered` 即丢弃全部明细并进入溢出态，等风暴平息后只发一次
 *     `onOverflow`，由消费方做全量重新同步（与 inotify `IN_Q_OVERFLOW`、watchman
 *     `is_fresh_instance` 的语义一致），保证内存有界且最终状态正确。
 */
export type RawFsEventType = 'rename' | 'change';
export interface CoalescedFsEvent {
    readonly path: string;
    /** 同一窗口内出现过 rename 即为 rename（存在性可能变化），否则为 change。 */
    readonly type: RawFsEventType;
}
export interface FsEventThrottlerOptions {
    /** 每批交付之间的间隔。默认 200ms。 */
    throttleMs?: number;
    /** 每批最多交付的事件数。默认 500。 */
    maxChunkSize?: number;
    /** 合并缓冲的上限，超过即进入溢出态。默认 10000。 */
    maxBuffered?: number;
    /** 溢出后持续有事件时，最长等待多久也要发出一次溢出通知。默认 2000ms。 */
    maxOverflowWaitMs?: number;
}
export interface FsEventThrottlerCallbacks {
    onBatch(events: CoalescedFsEvent[]): void | Promise<void>;
    /** `dropped` 为溢出期间丢弃的原始事件数（含已合并在缓冲里的部分）。 */
    onOverflow(dropped: number): void;
    onError?(err: unknown): void;
}
export interface FsEventThrottler {
    push(type: RawFsEventType, absPath: string): void;
    /** 当前缓冲中待交付的路径数。 */
    readonly pending: number;
    readonly overflowed: boolean;
    dispose(): void;
}
export declare const DEFAULT_FS_EVENT_THROTTLE_MS = 200;
export declare const DEFAULT_FS_EVENT_MAX_CHUNK = 500;
export declare const DEFAULT_FS_EVENT_MAX_BUFFERED = 10000;
export declare const DEFAULT_FS_EVENT_MAX_OVERFLOW_WAIT_MS = 2000;
export declare function createFsEventThrottler(callbacks: FsEventThrottlerCallbacks, options?: FsEventThrottlerOptions): FsEventThrottler;
