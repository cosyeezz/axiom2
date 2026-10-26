/**
 * SseStreamMonitor — SSE 流全链路监控器接口
 *
 * 每条 SSE 流对应一个监控器实例，
 * 在流的生命周期各节点（入队→连接→首包→逐包→结束）采集数据并上报。
 *
 * logEvent 三种输出各自独立开关：伽利略上报 / 写日志文件默认开启，写控制台默认关闭。
 */
/**
 * SSE 流结束状态。
 * - closed: 正常关闭
 * - canceled: 用户手动取消
 * - error: 异常中断
 */
export type SseStreamState = 'closed' | 'canceled' | 'error';
/** 流异常关闭的原因，用于区分 finish_flag。 */
export type SseStreamErrorReason = 'timeout' | 'modelError' | 'streamError';
/**
 * 流关闭时携带的统计信息。
 */
export interface StreamCloseInfo {
    /** 解压前（接收）字节数 */
    recvLength: number;
    /** 解压后（原始）字节数 */
    originLength: number;
}
/** onStreamEnd 可选参数。recv/origin 未传时用监控器内部累计字节数。 */
export interface StreamEndOptions {
    /** 用户停止：AbortSignal 已 aborted。覆盖 state，finish_flag 报 manualStop。 */
    aborted?: boolean;
    /** state 为 error 且未被 abort 覆盖时，区分 timeout / modelError / interrupt。 */
    errorReason?: SseStreamErrorReason;
    recvLength?: number;
    originLength?: number;
}
/**
 * 解析后的 SSE chunk 内容。空字段表示本包不含该类内容，由监控器自行忽略。
 */
export interface SseChunkParseResult {
    deltaContent?: string;
    deltaReasoning?: string;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
    };
    finishReason?: string | null;
    /** 本包含非空 tool_calls，用来抬纯工具流的 TTFT。 */
    hasToolCall?: boolean;
}
/**
 * parseSSEChunk 返回值中 SSE 监控器专用字段（与 GenAI 字段隔离）。
 */
export interface SseMonitorChunkData {
    monitorDelta?: string;
    monitorReasoning?: string;
    monitorUsage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
    };
    monitorHasToolCall?: boolean;
}
/**
 * SSE 流监控器接口。
 *
 * 生命周期：
 * 1. (构造函数)        — 请求发出前（入队打点，构造时自动触发）
 * 2. onStreamOpen()       — 连接建立（收到响应头）
 * 3. onChunk()            — 每个 SSE chunk（热路径，首包自动触发 onFirstData）
 * 4. onParsedChunk()      — 解析后的内容分发（空字段内部忽略）
 * 5. onTextDelta()        — 解析出正文 delta
 * 7. onThinkDelta()       — 解析出思考 delta
 * 8. onToolCall()         — 解析出 tool_call
 * 9. onFinishReason()     — 收到 finish_reason
 * 10. onUsage()           — 收到 usage
 * 11. onModelError()      — 收到模型错误
 * 12. onSensitiveHit()    — 敏感拦截
 * 13. onStreamEnd()       — 流结束（abort 优先，汇总上报）
 *     onStreamClose()     — 按给定 state 上报（无 abort 覆盖）
 *     onStreamError()     — 流异常关闭（timeout / modelError / interrupt）
 */
export interface SseStreamMonitor {
    onStreamOpen(traceId: string, httpBeginStatus?: number): void;
    /**
     * 流结束统一入口。
     * - onStreamEnd('error', { errorReason: 'timeout' }) → finish_flag=timeout
     * - onStreamEnd('error', { aborted: true }) → finish_flag=manualStop
     * - onStreamEnd('error') → finish_flag=interrupt
     */
    onStreamEnd(state: SseStreamState, options?: StreamEndOptions): void;
    onStreamClose(state: SseStreamState, info: StreamCloseInfo): void;
    /** 流异常关闭。reason 用于区分 finish_flag（timeout / modelError / interrupt）。 */
    onStreamError(reason?: SseStreamErrorReason): void;
    onChunk(chunk: Buffer): void;
    /** 内容分发入口：空字段内部忽略，调用方无需再做 if 判断。 */
    onParsedChunk(info: SseChunkParseResult): void;
    onTextDelta(text: string): void;
    onThinkDelta(text: string): void;
    onToolCall(): void;
    onFinishReason(reason: string): void;
    onUsage(usage: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
    }): void;
    onModelError(error: string, errorCode: string): void;
    onSensitiveHit(): void;
    /** 写入 HTTP 结束状态码：200–599，或无响应哨兵 -2 / 0；其它值忽略。 */
    setHttpEndStatus(code: number): void;
}
/**
 * SSE 监控器用的 session 快照。构造时从 live Session 拷贝，之后不再读原对象。
 * 不要传入 live Session：runOneTime 会还原 agentPurpose，流结束时再读会把 other 误判成 chat。
 */
export interface SseMonitorSessionData {
    id: string;
    conversationRequestId?: string;
    promptRequestId?: string;
    messageId?: string;
    traceId?: string;
    agentName?: string;
    agentPurpose?: string;
    isCompressing?: boolean;
    scene?: string;
}
export interface SseStreamMonitorOptions {
    sessionData: SseMonitorSessionData;
    model: string;
    /** 用户停止信号。Monitor 在构造时注册，在 onStreamClose/onStreamError 显式摘掉。 */
    abortSignal?: AbortSignal;
}
/** 伽利略上报服务接口（由监控器内部使用，始终可用）。请求级明细只走 logInfo。 */
export interface SseMonitorGalileo {
    logInfo: (message: string, attributes?: Record<string, string | number | boolean>) => void;
}
/** 日志器接口（由监控器内部使用）。 */
export interface SseMonitorLogger {
    info: (msg: string, ...args: any[]) => void;
    warn: (msg: string, ...args: any[]) => void;
    error: (msg: string, ...args: any[]) => void;
}
