/** 记录方向：`out` = CLI 发出（stdout）；预留 `in` 便于后续扩展 stdin 记录。 */
export type StdioDirection = 'in' | 'out';
/**
 * 每次调用都 live 读 env，避免在容器装配阶段冻结值，导致 prewarm 命中的进程
 * 拿不到 daemon 后来透传的开关。
 */
export declare function isStdioPersistenceEnabled(): boolean;
/**
 * 一个通道：一条落盘管线，对应磁盘上的一个 .jsonl 文件。写入串行 await 避免
 * 交织；append 失败静默计数。调用侧永远不 await 返回值。
 */
export interface StdioChannel {
    append(direction: StdioDirection, message: unknown): void;
    /** Append an already serialized JSON value without parsing and serializing it again. */
    appendSerialized?(direction: StdioDirection, json: string): void;
    /**
     * 等所有已排队的 append 真正落到磁盘。CLI 退出前调用，避免进程先于
     * `appendFile` microtask 结束造成落盘丢失。永不 reject。
     */
    flush(): Promise<void>;
    /** 尚未完成落盘的序列化字符串字符数。 */
    readonly bufferedCharacters?: number;
    /** 累计静默丢弃的记录条数（排障 / 测试用）。 */
    readonly failedWrites: number;
}
/**
 * 打开 stream-json 落盘通道。**只在 env 启用时才调用**——调用侧先判 flag，
 * 避免这里内部再判导致误开无用文件。
 *
 * @param sessionId session id（写盘目录用）
 * @param projectId 可选；默认取 `PathUtils.getCompressedWorkDir()`（对齐现有 session 目录约定）
 */
/**
 * 打开 stream-json 落盘通道。**只在 env 启用时才调用**——调用侧先判 flag，
 * 避免这里内部再判导致误开无用文件。
 *
 * 每次调用产生独立的 run 子目录（`{ISO-timestamp}-{pid}`），因此同一 sessionId
 * 反复启动不会互相覆盖。
 *
 * @param sessionId session id
 * @param projectId 可选；默认取 `PathUtils.getCompressedWorkDir()`（对齐现有 session 目录约定）
 */
export declare function openStreamJsonChannel(sessionId: string, projectId?: string): StdioChannel;
