import { Logger } from '@genie/telemetry';
import { ContextCompactSummarizer } from '../context/context-protocol';
import { ModelResponseInterceptor, ModelResponseInterceptorContext, SessionStore } from './session-protocol';
import { SessionResponseTelemetry as TelemetryService } from './session-response-host-protocol';
import { SessionRunStateMachine } from './session-run-state-machine-protocol';
export declare class ContextTruncationInterceptor implements ModelResponseInterceptor {
    protected readonly contextCompactSummarizer: ContextCompactSummarizer;
    protected readonly logger: Logger;
    protected readonly stateMachine: SessionRunStateMachine;
    intercept(ctx: ModelResponseInterceptorContext): Promise<boolean | void>;
    /**
     * Returns true when compact already produced a terminal state and PTL should
     * surface instead of starting another recovery run.
     */
    private shouldSurfacePtlWithoutDeterministicFallback;
    /**
     * Final deterministic PTL recovery when summary-based compaction cannot run.
     * It drops the oldest API-round groups by the parsed token gap, or by a 20%
     * fallback when counts are unavailable. If only one round remains, the
     * truncate helper may drop older tool-call pairs within that round. The retry
     * reminder is marked so MAX_PTL_RETRIES can stop repeated recoveries.
     */
    private truncateAndRetryAfterPtl;
    /** 截取错误 message 的前 200 字符，用于日志诊断而不污染日志行 */
    private extractErrorSnippet;
}
export declare class finishReasonErrorInterceptor implements ModelResponseInterceptor {
    protected readonly logger: Logger;
    protected readonly sessionStore: SessionStore;
    protected readonly telemetryService: TelemetryService;
    intercept(ctx: ModelResponseInterceptorContext): Promise<boolean | void>;
    /**
     * 处理「已经产出实质内容之后才 `finish_reason=error`」：自动续写，最多 3 次、1s 起步 2 倍退避。
     *
     * 没有任何实质输出就 error 的两种形态（仅 reasoning / 零 token）在模型层被转成可重试的
     * EmptyStreamError，走 interruption-service 的流错误恢复；三者认领同一份 error 预算。
     *
     * 能走到这里说明这次 run 已经结束：SDK 只要本轮还有可执行的工具调用就会继续循环，
     * 不会把控制权交回。因此不存在「参数完整但尚未执行」的工具调用；万一出现，每次构造
     * 请求前的 `fillFunctionCallResultHistory` 也会补齐配对，不会因孤儿调用触发上游 400。
     * 本期只统计孤儿数量用于验证这一推论，不改补齐逻辑。
     *
     * 预算用尽、退避期间被取消或发起失败时都**不返回 `true`**：没有重跑在路上，本轮必须
     * 正常收敛给上层，否则 CLI 会一直等一个不存在的 run。
     */
    private handleErrorFinishReason;
    private writeErrorTerminalMessage;
    /** 统计本轮以 error 收尾时残留的无配对结果工具调用，用于验证「此处不应有孤儿」的推论。 */
    private logOrphanToolCallsOnError;
    private shouldSkipExpectedSubagentToolCalls;
    /**
     * 处理 length 类型的完成原因：从断点续写（#119765）。
     *
     * 与改动前的两个关键区别：
     *   1. 注入的提示从「重来一遍但做小一点」改成「从断点接着写」（四个特殊工具仍给
     *      各自的拆分建议，见 `buildRecoveryPrompt`）；
     *   2. 次数不再靠扫描历史里的文本标记来数——换文案后那种扫描恒为 0、上限会静默
     *      失效——改为 `session.meta` 上的连续链计数，依次允许第 1、2、3 次恢复。
     *
     * 预算用尽时不发起恢复 run 且**不返回 `true`**：这一轮就以 `length` 收尾，经
     * `mapFinishReasonToStopReason` 收敛为 ACP `max_tokens` 交给上层，属程序级停止。
     *
     * 注意本方法只覆盖「run 以 length 收尾」这一类。run 内工具参数被截断时 SDK 会
     * 继续循环、本拦截器不会被调用，那条路径仍由 `runner-factory` 的
     * `callModelInputFilter` 原样处理，不在本次改动范围内。
     */
    private handleLengthFinishReason;
    /**
     * 取本次截断响应涉及的工具名，并清掉 `session.meta` 上的旧记录。
     *
     * **直接从最后一次响应的 `function_call` 收集**，不以「参数是不是合法 JSON」为前提：
     * `TruncatedToolCallInterceptor` 写的 `lastTruncatedToolNames` 只收集解析失败的调用，
     * 于是「最后一次响应里的 Write 参数恰好合法、或已被 jsonrepair 修好」时那个字段是空的，
     * 提示会退化成通用续写原文、拿不到 Write 专属建议。
     *
     * 最后一次响应没有任何工具调用（典型的纯文本截断）时返回空，走续写原文。
     *
     * 仍然清理 `lastTruncatedToolNames`：它原先只写不清，残留会污染后续判断；只是不再
     * 用它做提示选择，仅在读不到最后一次响应时作为兜底。
     */
    private takeTruncatedToolNamesOfLastResponse;
    /**
     * `truncation_detected` 日志。
     *
     * token 只取**这一次截断响应**自己的 usage（`_lastTurnResponse.usage`）。不能读 run 级的
     * `ctx.modelResponseMetadata.usage`：那个对象整个 run 复用、只有带 usage 的 chunk 才覆盖，
     * 「先一次带 usage 的 tool_calls、最后一次 length 不带」时会把上一次响应的 token 记到
     * 截断上。取不到就记 `unknown`，**不回退到 run 级数据**。
     * `reasoning` 按提供方字段原样记录，不与 output 相加。
     */
    private logTruncationDetected;
}
/**
 * Marker appended to the reminder injected by {@link TextualToolCallInterceptor}.
 * Used to count prior recoveries in history so we never loop indefinitely.
 */
export declare const TEXTUAL_TOOL_CALL_RETRY_MARKER = "[TEXTUAL_TOOL_CALL_RECOVERY]";
/**
 * Recover from "textualized tool calls": some models, under very long context,
 * emit a tool call as plain assistant text (e.g. `<invoke name="Bash">…</invoke>`)
 * instead of a structured tool call. The CLI then sees a normal text reply with
 * no tool call, so the turn ends and the agent appears to "stop working" — the
 * user must repeatedly nudge it ("继续" / "你是不是执行不了工具了").
 *
 * This interceptor detects that specific degradation and injects a single
 * reminder that makes the model re-emit the call through the real tool channel.
 *
 * Detection requires ALL of the following, to avoid touching any normal turn:
 *   1. finishReason says the model is done or intended to call tools ('stop' / 'end_turn' / 'tool_calls').
 *      (We never touch 'length' / error / empty — each handled elsewhere.)
 *   2. The turn produced ZERO real tool calls (no function_call in result.newItems).
 *      This makes normal 'tool_calls' turns pass through unchanged.
 *   3. The assistant text contains a COMPLETE `<invoke name="...">…</invoke>` block
 *      that is NOT inside a fenced code block (so genuine explanations that quote
 *      the tool-call syntax are not misclassified).
 *
 * On match it injects a system-reminder and returns true to trigger one re-run.
 * A marker-based guard caps recovery at {@link TextualToolCallInterceptor.MAX_RETRIES}
 * so a persistently degraded model hands control back to the user instead of looping.
 */
export declare class TextualToolCallInterceptor implements ModelResponseInterceptor {
    protected readonly logger: Logger;
    protected readonly stateMachine: SessionRunStateMachine;
    /**
     * Max automatic recoveries per degradation streak. Kept as a constant for easy tuning.
     * Set to 1: a single reminder is almost always enough to correct the model; if it
     * fails twice we stop nudging and let the user take over.
     */
    private static readonly MAX_RETRIES;
    /** How many trailing history items to scan when counting prior recoveries. */
    private static readonly RETRY_CHECK_WINDOW;
    /**
     * Matches a complete `<invoke name="ToolName">…</invoke>` block. Non-greedy body,
     * dotall so it spans the multi-line `<parameter>` content these blocks contain.
     */
    private static readonly INVOKE_BLOCK_RE;
    intercept(ctx: ModelResponseInterceptorContext): Promise<boolean | void>;
    /**
     * Return the raw items produced by the current model turn.
     *
     * By the time model-response interceptors run, the assistant message of this turn
     * has already been appended to `session.history` (addHistory completes before the
     * interceptor loop). So we read the latest assistant message group from history,
     * which is the single source of truth for both streaming and non-streaming paths.
     * Falls back to `result.newItems` only when history has no usable messageId.
     */
    private getTurnRawItems;
    /** True if this turn produced at least one structured function_call. */
    private turnHasRealToolCall;
    /** Concatenate the assistant message text produced in this turn. */
    private extractTurnAssistantText;
    /** Mark malformed assistant text so later model input construction skips it. */
    private discardAssistantMessagesFromModelInput;
    /**
     * Detect a complete <invoke> block outside fenced and inline code. We strip ```…```
     * fences and `...` spans first so that a model legitimately explaining/quoting the
     * tool-call syntax is never treated as a degraded call.
     */
    private hasTextualToolCall;
    /** Count prior textual-tool-call recoveries in the current recovery chain. */
    private countRecentRetries;
    private buildReminder;
}
/**
 * Interceptor to handle truncated tool call arguments.
 *
 * The actual retry is handled by callModelInputFilter in runner-factory.ts, which intercepts
 * the SDK's automatic second-round request and turns it into a valid paginated retry.
 *
 * This interceptor only marks truncated tool calls with `providerData.discard` in session
 * history. That flag is a UI/bookkeeping hint, NOT a model-input filter — dropping the calls
 * from the model input is done by callModelInputFilter's truncation branch, which also injects
 * the decomposition hint. (`fillFunctionCallResultHistory` deliberately ignores `discard` on
 * function_call items; see its doc comment.)
 * It does NOT initiate retries or return true, allowing finishReasonErrorInterceptor
 * to serve as fallback if callModelInputFilter doesn't fully resolve the situation.
 */
export declare class TruncatedToolCallInterceptor implements ModelResponseInterceptor {
    protected readonly logger: Logger;
    intercept(ctx: ModelResponseInterceptorContext): Promise<boolean | void>;
    /**
     * Find truncated tool calls (arguments is not valid JSON)
     */
    private findTruncatedToolCalls;
    /**
     * Mark truncated tool calls as discarded in session history.
     * This ensures fillFunctionCallResultHistory skips them when building messages for the model.
     */
    private discardTruncatedToolCallsInHistory;
    private isValidJson;
}
/**
 * Interceptor to clean up queued messages record when session request ends
 * This ensures temporary queued messages are cleared after the session completes normally
 */
export declare class QueuedMessagesCleanupInterceptor implements ModelResponseInterceptor {
    protected readonly logger: Logger;
    intercept(ctx: ModelResponseInterceptorContext): Promise<void>;
}
/**
 * Interceptor to handle media content errors (image size too large, invalid format, too many items)
 * When model returns errors related to media content, this interceptor will intelligently remove
 * media content based on error type and provide context for the agent to handle appropriately
 */
export declare class MediaContentErrorInterceptor implements ModelResponseInterceptor {
    protected readonly sessionStore: SessionStore;
    protected readonly logger: Logger;
    protected readonly stateMachine: SessionRunStateMachine;
    private static readonly MAX_RETRY_ATTEMPTS;
    private static readonly MAX_MIME_MISMATCH_RETRY_ATTEMPTS;
    private static readonly GIF_UNSUPPORTED_ERROR_CODES;
    /**
     * Gateway business codes that mean "the model refused the images in this
     * request" (`11135 InvalidInputImage`).
     *
     * The code is the only stable signal. The gateway folds several unrelated
     * upstream causes into one hard-coded English sentence and overwrites the
     * upstream text, so `ERROR_TYPE_PATTERNS` matching that sentence breaks the
     * moment the wording is changed or localized (`docs/error-codes.md` already
     * ships a Chinese user-facing string for this code). The code is carried on
     * the error object all the way here — `error-analyzer` puts the parsed body
     * code into the response, the SDK surfaces it as `APIError.error.code`, and
     * `ErrorUtils.extractBizCode` recovers it — so key off it and keep the
     * phrasing match only as a fallback for gateways that send no code.
     */
    private static readonly IMAGE_REJECTED_ERROR_CODES;
    private static readonly GIF_UNSUPPORTED_PLACEHOLDER;
    private static readonly ERROR_TYPE_PATTERNS;
    intercept(ctx: ModelResponseInterceptorContext): Promise<boolean | void>;
    /**
     * 兜底：history 里没有媒体可清理时，按 token gap 截掉最老的 API round groups 后重试。
     *
     * 本场景的 error 来自 axios maxBodyLength（client-side 或上游网关回传的 502），
     * 不带 PTL 风格的 actual/limit token 计数，因此 gap 传 undefined，走 truncateHead
     * 的 20% fallback。
     *
     * 与 PTL summary recovery 的差异：
     *   - 不调 compact（compact 自身也可能再次触发 maxBodyLength，且 UI 会重复渲染分隔线）
     *   - 直接走 truncate + 简短 reminder + runDefault
     */
    private truncateHistoryAndRetry;
    /**
     * Classify the error type based on error message
     */
    private classifyError;
    /**
     * Generate an intelligent retry message based on error type and context
     */
    private generateRetryMessage;
    private getErrorTypeDescription;
    /**
     * Remove media based on error type with different strategies
     */
    private removeMediaBasedOnErrorType;
    /**
     * Find all media locations in history
     */
    private findAllMediaLocations;
    private collectMediaLocationsFromArray;
    private collectMediaLocationsFromJsonText;
    /**
     * Extract file path from media content if available
     */
    private extractFilePath;
    /**
     * Remove media at a specific location
     */
    private removeMediaAtLocation;
    /**
     * Replace every GIF in canonical user history with a text placeholder.
     *
     * This intentionally mutates only the in-memory session history.
     * initializeForkHistory is restricted to initializing a new fork's empty file,
     * so it cannot rewrite an existing session here. On resume, an old GIF may trigger one fresh
     * rejection before being sanitized again, matching the existing media
     * recovery persistence policy above.
     */
    private replaceGifUserInputsWithPlaceholder;
    private isGifMediaContent;
    private isGifMimeType;
    private isGifValue;
    private replaceJsonArrayMediaAt;
    private extractErrorMessage;
    private isMediaContent;
    private isFunctionResultItem;
    private getOutputText;
    private setOutputText;
    private getImageBlobRef;
    private parseImageBlobRef;
    private isImageBlobRef;
    private countRecentRetries;
}
/**
 * Interceptor to fallback to a user-specified model in print mode
 * when primary model returns overload/quota-style errors.
 */
export declare class FallbackModelErrorInterceptor implements ModelResponseInterceptor {
    protected readonly logger: Logger;
    intercept(ctx: ModelResponseInterceptorContext): Promise<boolean | void>;
}
//# sourceMappingURL=model-response-interceptors.d.ts.map