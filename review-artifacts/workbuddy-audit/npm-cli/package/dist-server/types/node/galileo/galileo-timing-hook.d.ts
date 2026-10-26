/**
 * GalileoTimingHook — 模型级耗时打点
 *
 * 通过监听 session.modelSubject 上的事件，计算并上报：
 *   - agent.ttfb: 首个有意义 token 延迟
 *   - agent.model.streaming: 模型流式输出耗时（首 token → 流结束）
 *   - agent.task_total: 端到端耗时（sendTime → prompt 完成）
 *
 * 此 hook 不修改 model-provider.ts，而是通过 session 上的 observable 被动监听。
 * 如需更精确的计时（如 prompt build），需要在 model-provider 中直接插入打点。
 */
export declare class GalileoTimingHook {
    private readonly galileo;
    private readonly aggregator;
    private readonly sessionErrorTracker;
    /**
     * 上报 TTFB（首 token 延迟）。
     * 调用时机：model-provider.ts 中 firstMeaningfulTokenReceived 后。
     */
    reportTTFB(ttfbMs: number, dimensions?: {
        model?: string;
        requestId?: string;
        agentName?: string;
        conversationRequestId?: string;
        messageId?: string;
        promptRequestId?: string;
    }): void;
    /**
     * 上报 message 维度用户视角 TTFT（用户点击发送 → 本轮首个 meaningful token）。
     * 起点为 renderer 透传的 clientSendTime，含 IPC 传输 + prompt build 全链路开销。
     * 每条用户消息上报 1 次（由 messageTtfbReported flag 控制）。
     */
    reportMessageTTFBUser(ttfbMs: number, dimensions?: {
        messageId?: string;
        promptRequestId?: string;
        conversationRequestId?: string;
        model?: string;
        agentName?: string;
        scene?: string;
    }): void;
    /**
     * 上报 message 维度模型视角 TTFT（CLI 进入 prompt → 本轮首个 meaningful token）。
     * 起点为 promptStartTime，含 prompt build 但不含跨进程 IPC。
     * 每条用户消息上报 1 次（由 messageTtfbReported flag 控制）。
     */
    reportMessageTTFBModel(ttfbMs: number, dimensions?: {
        messageId?: string;
        promptRequestId?: string;
        conversationRequestId?: string;
        model?: string;
        agentName?: string;
        scene?: string;
    }): void;
    /**
     * 上报模型流式生成耗时（首 token → 流结束）。
     * 调用时机：model-provider.ts stream completed 后。
     */
    reportModelStreaming(streamingMs: number, dimensions?: {
        model?: string;
        agentName?: string;
        conversationRequestId?: string;
    }): void;
    /**
     * 上报 Task 端到端耗时。
     * 调用时机：ACP prompt 完成时，从 _meta['codebuddy.ai/sendTime'] 计算。
     */
    reportTaskTotal(taskTotalMs: number, dimensions?: {
        taskId?: string;
        modelCalls?: number;
        toolCalls?: number;
        model?: string;
        agentName?: string;
        agentPurpose?: string;
    }): void;
    /**
     * 上报 Prompt Build 耗时（组装 prompt → 发出 HTTP 请求之间的时间）。
     * 调用时机：model-provider.ts 中 HTTP 请求发出前。
     */
    reportPromptBuild(promptBuildMs: number, dimensions?: {
        model?: string;
        agentName?: string;
    }): void;
    /**
     * 上报 Tool 等用户确认耗时。
     * 调用时机：permission 确认/拒绝后。
     */
    reportToolUserWait(waitMs: number, dimensions?: {
        toolName?: string;
        permissionType?: string;
        model?: string;
    }): void;
    /**
     * 上报上下文压缩耗时。
     * 调用时机：compact 操作完成后。
     */
    reportContextCompact(compactMs: number, dimensions?: {
        compactType?: string;
        model?: string;
    }): void;
    /**
     * 记录模型生成的 tool_calls 数量。
     * 调用时机：model response 解析到 tool_calls 后。
     */
    reportToolCallsGenerated(count: number): void;
    /**
     * 上报模型请求结果到 aggregator。
     * 调用时机：model response 完成或错误后。
     */
    reportRequestResult(statusCode: number, errorCode?: string, model?: string, msg?: string, conversationRequestId?: string, modelName?: string, sessionId?: string): void;
    /**
     * 记录单次 LLM call 的 token 消耗。
     * 调用时机：model response 完成后（usage 数据可用时）。
     */
    reportTokenUsage(input: number, output: number, cached: number, model: string, conversationRequestId?: string, modelName?: string): void;
}
