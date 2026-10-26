import type { TruncateBuffer } from '../shell';
/**
 * 把后台任务的 stdout/stderr 落盘文件按增量同步到内存 TruncateBuffer。
 *
 * 后台任务路径下，子进程的 stdout/stderr 直接写文件 fd（不通过父进程 pipe），
 * 这样孙进程（nohup/守护脚本等）即使继承 fd 也不会卡父进程的 EOF。但 codebuddy
 * 现有的 UI（bash-output-section.tsx）和 TaskOutput 工具都消费 BackgroundTask
 * 上的 TruncateBuffer，所以需要这个 poller 把文件增量回填到 buffer，保持契约不变。
 *
 * 实现要点：
 *  - 500ms 一次 stat + 增量 read，offset 单调递增
 *  - 单次 tick 最多读 1MB，超过则下次 tick 继续追，不阻塞
 *  - {@link drain} 在子进程退出后调用一次，把最后的尾巴读完
 *  - {@link stop} 仅停定时器，不删文件（清理由 tool-manager 在 session 结束时统一做）
 */
export interface BackgroundOutputTailPollerOptions {
    /** 每次 stat + read 间隔，默认 500ms。 */
    intervalMs?: number;
    /** 单次 tick 读取上限，默认 1MB。文件超大时分多次 tick 追上来。 */
    readChunkLimit?: number;
    /** poller 内部 stat/read 失败的日志钩子（可选）。 */
    onError?: (where: 'stat' | 'read', error: unknown) => void;
    /**
     * 每次成功读到新增内容时的回调（增量文本，与 `buffer.push` 同一份数据）。
     *
     * 仅用于需要"增量触发响应"的场景（如 MonitorTool 的反应式推送，issue #74426）；
     * BashTool/PowerShellTool 的常规后台任务不传，行为不变——buffer 仍是唯一契约。
     */
    onChunk?: (chunk: string) => void;
    /**
     * 同 {@link onChunk}，但交出的是**未经解码的原始字节**。
     *
     * 为什么必须单独开一条回调而不复用 `onChunk`：`onChunk` 拿到的是本 tick 按 utf-8
     * 解码后的字符串，而读取边界落在任意字节位置，跨 tick 的多字节字符会被切坏成
     * U+FFFD（见 tickOnce 里的说明）。把那个字符串再编码回字节，等于把损坏**固化**下来，
     * 接收端无论怎么保留解析状态都救不回来。
     *
     * ACP v2 的 `terminal_output_chunk` 要求 base64 的是原始字节流，正是为了容纳
     * 「分片切断 UTF-8 码点」这种情况——由客户端的终端模拟器跨 chunk 保留解析状态去还原。
     * 所以推送链路必须消费本回调，不能走 `onChunk`。
     *
     * 传入的 Buffer 是本次读取缓冲区的 subarray（零拷贝视图），**回调必须同步消费完**：
     * 本方法返回后 poller 不再持有它，但调用方若要跨 tick 留存必须自己复制。
     */
    onChunkBytes?: (chunk: Buffer) => void;
}
export interface BackgroundOutputTailPoller {
    /** 立即触发一次同步（用于子进程退出后的最终 drain）。 */
    drain(): Promise<void>;
    /** 停止定时器；幂等，重复调用安全。 */
    stop(): void;
}
/**
 * 启动一个文件 tail poller，把 `filePath` 的新内容追加到 `buffer`。
 *
 * @param filePath 要追踪的文件路径（可能尚未创建，poller 会容忍 ENOENT）
 * @param buffer   接收增量数据的 buffer
 * @param options  可选配置
 */
export declare function startBackgroundOutputTailPoller(filePath: string, buffer: TruncateBuffer, options?: BackgroundOutputTailPollerOptions): BackgroundOutputTailPoller;
