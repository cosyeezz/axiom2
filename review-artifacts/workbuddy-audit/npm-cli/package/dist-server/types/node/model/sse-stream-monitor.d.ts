/**
 * SseStreamMonitorImpl — SSE 流全链路监控器实现
 *
 * 每条 SSE 流一个实例，在流生命周期各节点采集数据并上报。
 *
 * logEvent 三种输出各自独立开关：
 *   - 伽利略上报：默认开启
 *   - 写日志文件：默认开启
 *   - 写控制台：默认关闭
 */
import type { SseChunkParseResult, SseMonitorGalileo, SseMonitorLogger, SseMonitorSessionData, SseStreamErrorReason, SseStreamMonitor, SseStreamMonitorOptions, SseStreamState, StreamCloseInfo, StreamEndOptions } from './sse-stream-monitor-protocol';
/** 从 live Session 拷贝监控所需字段。必须在请求发出时拍快照，不能持有原对象。 */
export declare function SseMonitorSessionData(session: {
    id: string;
    promptRequestId?: string;
    traceId?: string;
    agentName?: string;
    isCompressing?: boolean;
    meta?: Record<string, any>;
}, call: {
    agentPurpose?: string;
    conversationRequestId?: string;
    messageId: string;
}): SseMonitorSessionData;
export declare class SseStreamMonitorImpl implements SseStreamMonitor {
    private readonly logger;
    private readonly galileo;
    private readonly sessionData;
    private readonly model;
    private readonly requestType;
    private readonly requestStartTime;
    private connectedTime;
    /** 当前 chunk 到达时间；由 onChunk() 写入，同一次 chunk 的后续回调复用 */
    private currentChunkTime;
    private firstTokenTime;
    private firstTextTime;
    private lastTextTime;
    private firstThinkTime;
    private lastThinkTime;
    private firstToolCallTime;
    private endTime;
    private totalBytes;
    private totalChunks;
    private completionTokens;
    private promptTokens;
    private totalTokens;
    private readonly textStats;
    private readonly thinkStats;
    private lastTokenTime;
    private readonly intervalTimes;
    private readonly intervalTotal;
    private finishFlag;
    private isSensitive;
    private modelError;
    private modelErrorCode;
    private finishReason;
    private isReportedStart;
    private isReportedEnd;
    private httpBeginStatusCode;
    private httpEndStatusCode;
    /** 短标识，用于并发请求时区分日志归属（取 conversationRequestId 前 8 位） */
    private readonly requestTag;
    private userAbortSignal;
    private onUserAbort;
    constructor(options: SseStreamMonitorOptions, galileo: SseMonitorGalileo | undefined, logger: SseMonitorLogger);
    /**
     * chat：conversation / conversation:compact / custom_agent:*
     * compress：压缩过程中的内部请求
     * 其余用 agentPurpose 原文（conversation_topic、subagent:Explore、automation 等）
     * 缺 purpose 才是 other。
     */
    private resolveRequestType;
    private logEnqueue;
    onStreamOpen(traceId: string, httpBeginStatus?: number): void;
    onFirstData(): void;
    /**
     * 流结束统一入口。
     * aborted（仅 userAbortSignal）优先 → manualStop；
     * error + errorReason:'timeout' → timeout；裸 error → interrupt。
     */
    onStreamEnd(state: SseStreamState, options?: StreamEndOptions): void;
    private attachUserAbort;
    private detachUserAbort;
    onStreamClose(state: SseStreamState, info: StreamCloseInfo): void;
    onStreamError(reason?: SseStreamErrorReason): void;
    onChunk(chunk: Buffer): void;
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
    setHttpEndStatus(code: number): void;
    /** 当前 chunk 到达时间；未经过 onChunk 时回退到 Date.now() */
    private chunkTime;
    private calculateConsumeInterval;
    private getIntervalKey;
    private resolveFinishFlag;
    private reportEnd;
    private sessionLogFields;
    /**
     * 事件输出 — 伽利略 / 文件日志 / 控制台 三种通道各自受开关控制。
     * sessionData 公共字段在此展开，调用方只传事件自己的增量。
     */
    private logEvent;
    /** 写日志文件；受 FILE_LOG_ENABLED 控制。 */
    private writeFileLog;
    /**
     * 控制台格式化输出 — 每个字段带中文名，便于调试阅读。
     */
    private printConsoleEvent;
    /**
     * 获取字段中文名 — 先查静态映射，再匹配吐字区间动态字段。
     */
    private getFieldCnName;
}
