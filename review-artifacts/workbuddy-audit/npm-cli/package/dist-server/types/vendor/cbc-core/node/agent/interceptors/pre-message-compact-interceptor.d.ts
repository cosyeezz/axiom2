import { ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import { SessionManager } from '../../session/session-protocol';
import { AgentManager, AgentRunInterceptor, AgentRunInterceptorPriority, AgentRunRequest } from '../agent-protocol';
import { AgentRunSettings } from '../agent-runtime-protocol';
/**
 * Pre-message compact interceptor.
 *
 * Checks token usage ratio before processing a new user message.
 * If usage exceeds the configured `preMessage` threshold:
 * 1. Saves user messages and compacts session history in-place
 * 2. Calls compactAndSummarize with skipContinue=true
 * 3. On success, keeps the original input so the current run continues normally
 * 4. On failure (compactAndSummarize returned false / threw): also keeps the
 *    original input so the LLM request actually goes out. If that request still
 *    hits PTL, ContextTruncationInterceptor will run the current PTL recovery
 *    path. Only user-cancel (abortSignal.aborted) keeps the original "surface
 *    error to user" behavior, since the user has explicitly given up on this turn.
 *
 * Threshold resolution: env var > product config > hardcoded default (0.8).
 */
export declare class PreMessageCompactInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    protected readonly productManager: ProductManager;
    protected readonly agentManager: AgentManager;
    protected readonly logger: Logger;
    protected readonly sessionManager: SessionManager;
    protected readonly settingsManager?: AgentRunSettings;
    intercept(request: AgentRunRequest): Promise<void>;
    private markCompactEndedWithUserVisibleError;
    /** 把异常对象/字符串转成给用户看的简短文案,避免硬编码丢失诊断信息。 */
    private formatErrorMessage;
    /**
     * 用本地粗略估算扫 history，返回大致的 input token 数。
     *
     * 仅在读不到 API 返回的精确 usage 时作为兜底使用。精度比 API usage 差，但能保证
     * history 体积已经超过模型上限时**一定**能触发压缩，而不是因为"读不到 usage"
     * 而无限累积直到请求 400 PTL。
     *
     * 重要：先根据 `providerData` 上明确的 compact 边界标识过滤旧 items。
     * append-only 压缩结果标记为 `isCompacted`，LLM summary 结果可能只标记为
     * `isSummary`；本地估算信任这些显式标识，但不按内容结构猜边界。
     *
     * 与 HistoryTruncateUtils 内部的 estimateTokens 对齐，都用 TokenUtils.estimateTokensRough
     * 对 JSON 序列化后的 item 做粗略 token 估算。
     */
    private estimateHistoryTokens;
    /**
     * Keep only the latest explicitly marked compact boundary and newer items.
     */
    private filterBeforeCompactBoundary;
}
//# sourceMappingURL=pre-message-compact-interceptor.d.ts.map