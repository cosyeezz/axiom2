/**
 * AgentMetricsAggregator — Agent SLA 指标聚合器
 *
 * 在 CLI 进程内存中维护滑动窗口计数器，定时 flush 到伽利略。
 *
 * 聚合维度：
 *   - Task outcome（按 model/scene 分维度）
 *   - Request 成功/失败（按 error_code 分维度）
 *   - Tool 成功/失败（按 tool_name/error_type 分维度）
 *   - Cache 命中率（按 model 分维度）
 *   - Tool 回调率（模型生成的 tool_calls 数 vs 实际执行数）
 *
 * 模型双通道字段约定（与 galileo-chat-reporter 对齐）：
 *   - `model`      : LLM 模型 id（如 "claude-opus-4.6-1m"、"auto"），用于技术分析与切片
 *   - `model_name` : 给人看的展示名（如 "Claude Opus 4.6 1M"），用于业务面板展示
 *   两者一对一伴随上报；调用方不传 modelName 时聚合器会兜底到窗口内最近一次 record 的值。
 *
 * Flush 间隔：固定 30 秒。短对话（cli 子进程 <30s 就退）在退出钩子里会走
 * flushAndShutdown 兜底把窗口数据推走，不依赖定时器。
 *
 * 内存占用 < 10KB，每个窗口清零一次。
 */
import { Application, ApplicationLifecycle } from '@celljs/core';
import { TaskOutcome } from './task-outcome';
export declare const AgentMetricsAggregator: unique symbol;
export interface TaskOutcomeRecordMeta {
    model?: string;
    modelName?: string;
    scene?: string;
    agentName?: string;
    promptRequestId?: string;
    conversationRequestId?: string;
    traceId?: string;
    stopReason?: string;
    errorCategory?: string;
    /** 本轮 expert 会话的 expertId（无 expert 时为空），用于 prompt 级结果按 expert 切片，与工具级 expert_id 归因对齐 */
    expertId?: string;
}
export interface AgentMetricsAggregator {
    /** 记录一次模型请求结果 */
    recordRequestResult(statusCode: number, errorCode?: string, model?: string, msg?: string, conversationRequestId?: string, modelName?: string): void;
    /**
     * 记录一次工具执行结果。
     * @param mcpServer 来源 MCP server 名称（builtin tool 传 'builtin'）。用于按 server 切片 agent.tool.* 计数。
     * @param toolErrorCode 稳定错误码（纯数字字符串，如 '1001'），值来自 ToolErrorCode 枚举
     */
    recordToolResult(toolName: string, success: boolean, errorType?: string, errorMessage?: string, callId?: string, mcpServer?: string, toolErrorCode?: string): void;
    /** 记录 Task 最终结果 */
    recordTaskOutcome(outcome: TaskOutcome, meta?: TaskOutcomeRecordMeta): void;
    /** 记录 Cache 命中情况 */
    recordCacheRate(cachedTokens: number, inputTokens: number, model: string, modelName?: string): void;
    /** 记录模型生成的 tool_calls 数量（用于计算回调率） */
    recordToolCallsGenerated(count: number): void;
    /** 记录单次 LLM call 的 token 消耗（message 粒度） */
    recordTokenUsage(input: number, output: number, cached: number, model: string, conversationRequestId?: string, modelName?: string): void;
    /**
     * 只做 flush（窗口数据灌入 OTel + forceFlush OTel buffer），不 shutdown provider。
     *
     * 适用"两阶段退出"的第一阶段 —— flush 后 cleanup 逻辑仍可继续上报。
     */
    flushOnly(timeoutMs?: number): Promise<void>;
    /**
     * 进程退出前调用 —— 先 flush 当前窗口到 OTel，再触发 GalileoService.shutdown 把 OTel buffer 推到伽利略。
     *
     * 适用"两阶段退出"的最终阶段 —— 所有 cleanup 结束后最后关门。
     *
     * 不依赖 ApplicationLifecycle.onStop —— cell 框架的 onStop 是同步调用且不 await 返回值，
     * 无法等待异步 forceFlush 完成。
     */
    flushAndShutdown(timeoutMs?: number): Promise<void>;
}
export declare class AgentMetricsAggregatorImpl implements AgentMetricsAggregator, ApplicationLifecycle<Application> {
    private readonly galileo;
    private readonly logger;
    private window;
    private timer?;
    /** Flush 间隔：固定 30 秒。 */
    private static readonly FLUSH_INTERVAL_MS;
    onStart(): void;
    onStop(): void;
    /**
     * 只做 flush（窗口数据灌入 OTel + forceFlush OTel buffer 到网络），不 shutdown provider。
     *
     * 适用"两阶段退出"的第一阶段 —— flush 后 cleanup 逻辑（如 SessionEnd hook）仍可继续上报。
     */
    flushOnly(timeoutMs?: number): Promise<void>;
    /**
     * 进程退出前的最终清场。**必须由 CLI 退出钩子（process.ts#exit）await 调用**。
     *
     * 顺序：
     *   1. clearInterval —— 防止 flush 期间再触发定时 flush 互相打架
     *   2. flush() —— 把窗口内累积值（addCounter / recordDuration）灌进 OTel
     *   3. galileo.shutdown() —— forceFlush OTel BatchProcessor 内 buffer + 关闭 provider
     *
     * 幂等：重复调用直接 noop（this.timer === undefined 时跳过 flush）。
     */
    flushAndShutdown(timeoutMs?: number): Promise<void>;
    recordRequestResult(statusCode: number, errorCode?: string, model?: string, msg?: string, conversationRequestId?: string, modelName?: string): void;
    recordToolResult(toolName: string, success: boolean, errorType?: string, errorMessage?: string, callId?: string, mcpServer?: string, toolErrorCode?: string): void;
    recordTaskOutcome(outcome: TaskOutcome, meta?: TaskOutcomeRecordMeta): void;
    private resolveTaskFailureStage;
    private resolveTaskFailureCategory;
    recordCacheRate(cachedTokens: number, inputTokens: number, _model: string, _modelName?: string): void;
    recordToolCallsGenerated(count: number): void;
    recordTokenUsage(input: number, output: number, cached: number, model: string, _conversationRequestId?: string, modelName?: string): void;
    private flush;
    private flushTaskMetrics;
    private flushRequestMetrics;
    private flushToolMetrics;
    private flushCacheMetrics;
    private flushToolCallbackRate;
    /** Token 消耗上报 — 按 model 分维度，分别上报 input/output/cached */
    private flushTokenUsageMetrics;
    private createEmptyWindow;
}
