/** 序列化并（按策略）加密一条旧格式 trace，返回落盘字节。 */
export declare function encodeTraceFileBytes(traceId: string, data: unknown): Buffer;
/** 把单条 JSONL record 编码为一行（末尾包含换行符）。 */
export declare function encodeTraceJsonlLine(traceId: string, record: unknown): string;
/** 解码单条 JSONL 行；空行由调用方忽略。 */
export declare function decodeTraceJsonlLine<T = unknown>(traceId: string, line: string): T;
/** 读取旧格式整文件 trace。 */
export declare function readTraceFile<T = unknown>(filePath: string): Promise<T>;
/**
 * Remove only a crash-torn final line before appending more records. Without
 * this repair, new bytes would join the partial JSON/base64 token and make all
 * later records unreadable. Complete lines, including corrupt ones, are kept so
 * readers still surface integrity/decryption failures.
 */
export declare function prepareTraceJsonlAppend(filePath: string): Promise<void>;
/** 流式 replay JSONL，避免先把整个文件读成一个大字符串。 */
export declare function readTraceJsonl<T = unknown>(filePath: string): Promise<T[]>;
/**
 * 仅保留最后一个匹配 record。listTraces 用它读取 footer，不构造 spans 数组。
 */
export declare function readTraceJsonlLast<T = unknown>(filePath: string, predicate: (record: T) => boolean): Promise<T | undefined>;
