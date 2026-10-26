/**
 * Known purpose values for the X-Agent-Purpose HTTP header.
 *
 * These tags classify different types of LLM requests and are consumed
 * downstream by Langfuse as `purpose:<value>` trace tags for analytics.
 *
 * ## Static vs Dynamic purposes
 *
 * Static purposes (defined below) have a fixed, well-known value.
 * Dynamic purposes are constructed at runtime with a name suffix:
 *   - `subagent:{agentType}`    — built-in subagent (e.g. "subagent:general-purpose")
 *   - `custom_agent:{agentName}` — user-defined custom agent (e.g. "custom_agent:my-bot")
 *
 * Dynamic purposes are set in:
 *   - agent-task.ts (setupPhase) for subagents / custom agents spawned via Agent tool
 *   - telemetry-interceptors.ts for custom agents used as the main conversation agent
 */
export declare enum AgentPurpose {
    /** Main conversation with the user (default agent or built-in agent as primary) */
    Conversation = "conversation",
    /**
     * 紧跟一次纯工程 PreMessage 压缩之后的那一轮对话请求。
     *
     * 由 `PreMessageCompactStrategy` 写入，仅对**压缩当轮**有效：下游 telemetry /
     * agentlog 把该值当作"非用户对话"过滤掉（`shouldReportMessageTelemetry` 不上报、
     * agentlog `ExcludeAgentPurposes` 整段排除），一旦泄漏到后续轮次，该会话之后
     * 所有对话的埋点与会话日志都会静默丢失。
     *
     * 因此它必须是 one-shot：写入方同时在 session.meta 打
     * `SESSION_META_COMPACT_PURPOSE_PENDING`，`TelemetryAgentRunInterceptor`
     * 消费该标记一次后，下一轮就把 purpose 洗回 `Conversation`。
     */
    ConversationCompact = "conversation:compact",
    /** Summary generation (runOneTime: SUMMARY_GENERATOR) */
    Summary = "summary",
    /** Web content analysis via WebFetch (runOneTime: CONTENT_ANALYZER) */
    WebFetch = "webfetch",
    /** Terminal/conversation title generation (runOneTime: TERMINAL_TITLE_GENERATOR) */
    ConversationTopic = "conversation_topic",
    /** Memory file selection (runOneTime: MEMORY_SELECTOR) */
    MemorySelection = "memory_selection",
    /** Insights analysis (runOneTime: INSIGHTS_ANALYZER) */
    Insights = "insights",
    /** Prompt hook evaluation (runOneTime: PROMPT_HOOK_EVALUATOR, or direct runner.run in runWithHistory) */
    PromptHook = "prompt_hook",
    /** Agent instructions generation (runOneTime: AGENT_INSTRUCTIONS) */
    AgentInstructions = "agent_instructions",
    /** Context compaction (runOneTime: COMPACT) */
    ContextCompact = "context_compact",
    /** Context summary for PreMessage compaction (runOneTime: CONTEXT_SUMMARY, scenario=default) */
    ContextSummaryPreMessage = "context_summary_pre_message",
    /** Context summary for MaxToken compaction (runOneTime: CONTEXT_SUMMARY, scenario=maxTokenLimit) */
    ContextSummaryMaxToken = "context_summary_max_token",
    /** Prompt suggestion generation (direct runner.run, post-conversation) */
    PromptSuggestion = "prompt_suggestion",
    /** Memory extraction (direct runner.run, post-conversation) */
    MemoryExtraction = "memory_extraction",
    /** Auto mode permission risk classification (runOneTime: AUTO_MODE_CLASSIFIER) */
    AutoModeClassifier = "auto_mode_classifier",
    /** Isolated security review */
    SecurityReviewer = "security_reviewer",
    ContentSecurityReviewer = "content_security_reviewer",
    /** Automation scheduled task execution */
    Automation = "automation",
    /** `/btw` side question on a forked Session (runForked); Claude Code's `side_question` source */
    SideQuestion = "side_question",
    /** Image description for the ViewImage tool (runOneTime: VIEW_IMAGE_DESCRIBER) */
    ViewImage = "view_image"
}
/**
 * Dynamic purpose prefix for built-in subagents.
 * Format: `subagent:{agentType}` (e.g. "subagent:general-purpose", "subagent:explore")
 * Set in agent-task.ts when the agent config does NOT have CUSTOM_AGENT_TAG.
 */
export declare const SUBAGENT_PURPOSE_PREFIX = "subagent";
/**
 * Dynamic purpose prefix for user-defined custom agents.
 * Format: `custom_agent:{agentName}` (e.g. "custom_agent:my-bot")
 * Set in agent-task.ts (when spawned as subagent) or telemetry-interceptors.ts (when used as main agent).
 */
export declare const CUSTOM_AGENT_PURPOSE_PREFIX = "custom_agent";
/**
 * Maps internal agent names (used in runOneTime calls) to static purpose values.
 */
export declare const AGENT_PURPOSE_MAP: Record<string, string>;
/**
 * Resolve the purpose tag for a given agent name.
 * Falls back to the raw agent name if no mapping exists.
 */
export declare function resolveAgentPurpose(agentName: string): string;
/**
 * 辅助型一次性 LLM 调用的 purpose 集合：这些调用跑在主 session 上（或临时复用主
 * session），但不拥有主 session 的 run 生命周期。
 *
 * 它们经由 AgentService.runOneTime 或裸 runner.run 派发（例如 prompt-suggestion /
 * memory-extraction 这类 post-conversation 路径），绕过了 run() 的 interceptor 流水线，
 * 因此永远不会回喂状态机收口 MODEL_REQUESTING 所需的配对事件 AGENT_STARTED / AGENT_ENDED。
 *
 * runner 的 callModelInputFilter 对这些 purpose 不得推进主 session 状态机：一个没有配对
 * 的 MODEL_REQUEST_STARTED 会把 session 卡在 MODEL_REQUESTING，主任务结束后让
 * “waiting for model” spinner 永不消失（issue #52320）。
 *
 * 刻意排除——以下 purpose 拥有真正的 run 生命周期，必须继续发事件：
 * - Conversation / undefined：面向用户的主对话 run。
 * - Automation：定时任务，走完整 run() 流水线。
 * - subagent:* / custom_agent:*：跑在各自独立的（fork）session。
 * - ContextCompact：blocking-compact-strategy 经 runDefault 派发的顶层 run，
 *   外层 run 已被 skipRun + forceIdle 收尾，compact 本身持有 session 生命周期。
 * - ContextSummaryMaxToken：调摘要前已 abortCurrentStreamAndWait 把旧主 run 收尾，
 *   摘要此刻是 session 上唯一的 run。压缩窗口的 busy 现在由 MaxToken 显式发的
 *   COMPACT_STARTED（→ COMPACTING）表达，COMPACTING 拒收摘要的 AGENT_STARTED /
 *   MODEL_REQUEST_STARTED，状态稳定停在 COMPACTING；这些事件仍不旁路，是为了
 *   COMPACT_STARTED 被转换表拒绝（进不去 COMPACTING）时还有信号维持 queue 语义的
 *   busy——旁路掉会让会话停在 PREPARING（队列视为非 busy）而被抢跑。
 *
 * ContextSummaryPreMessage 相反，必须登记：它跑在 run() 的 interceptor 流水线里，
 * 此刻主 run 已 RUN_ACCEPTED 处于 pending，摘要复用的是主 session。PreMessage 不发
 * COMPACT_STARTED（PENDING 不接该事件，busy 本就由主 run 表达），所以「运行时 session
 * 处于 COMPACTING，该状态会拒绝 MODEL_REQUEST_STARTED」这条防线在这条路径上不存在。
 * 摘要因此能一路推到 MODEL_REQUESTING，把主 run 挤成孤儿。
 *
 * 注意：这是一份 denylist——将来任何新增的 runOneTime / 裸 runner.run purpose 都必须登记
 * 到这里，否则 spinner 卡死的 bug 会复发。
 *
 * multi-session（#44317）回归时，PreMessage 承载应改回临时子 Session（见
 * PreMessageCompactStrategy.runLlmSummaryForPreMessage 的锚点注释）；本条目仍应保留
 * 作冗余防线。
 */
export declare const AUXILIARY_PURPOSES: ReadonlySet<string>;
/**
 * 判断 `purpose` 是否为辅助型一次性调用——这类调用不得驱动主 session 的 run 状态机。
 *
 * 未知 / undefined 的 purpose 一律视为“拥有生命周期”（返回 false），这样首个模型请求触发
 * 时 purpose 可能尚未设置的普通对话仍按原行为发出 MODEL_REQUEST_STARTED。
 */
export declare function isAuxiliaryPurpose(purpose?: string): boolean;
/** Purposes of compaction summary calls (X-Agent-Type `compaction`). */
export declare const COMPACTION_PURPOSES: ReadonlySet<string>;
export declare function isCompactionPurpose(purpose?: string): boolean;
/**
 * 按 purpose 旁路 agent 生命周期事件（agent_start / agent_end / tool / handoff）。
 *
 * 与 `STATE_MACHINE_BYPASS_AGENTS` 的区别是判定粒度：那份名单按 **agent 名**匹配，
 * 一旦收下某个 agent，它在所有调用路径上都被旁路。`contextSummary` 恰恰不能这么处理
 * ——同一个 agent 在三条路径上的身份完全不同：
 *
 * - PreMessage：跑在 run() 的 interceptor 流水线里，主 run 已 RUN_ACCEPTED 处于
 *   pending 且复用主 session。摘要的 agent_start 会把 pending 推到 agent_running，
 *   紧接着 agent_end 把会话打回 idle；主 run 随后真正的 agent_start 被判非法转换
 *   丢弃，主 run 从此成为状态机看不见的孤儿（UI 永久转圈，下一条用户消息又起第二个
 *   并发 run）。必须旁路。
 * - MaxToken：调摘要前已 abortCurrentStreamAndWait 把旧主 run 收尾，摘要是 session
 *   上唯一的 run，需要自己的生命周期把会话保持在 busy。旁路掉会长时间停在 PREPARING。
 * - 用户显式调用 contextSummary 子 agent：本就是顶层 run，旁路掉无法正常收尾。
 *
 * 因此这里只收 PreMessage 这一种 purpose。
 *
 * The purpose is scoped to the summary call (`runOneTime` → `runWithAgentPurpose`), so it
 * cannot leak onto the pending main run.
 *
 * multi-session（#44317）回归时，PreMessage 承载应改回临时子 Session；本名单保留为
 * 冗余防线即可（临时 Session 上旁路是无害的）。
 */
export declare const STATE_MACHINE_BYPASS_PURPOSES: ReadonlySet<string>;
/**
 * 判断当前 `purpose` 下的 agent 生命周期事件是否应旁路主 session 运行态状态机。
 */
export declare function isStateMachineBypassPurpose(purpose?: string): boolean;
//# sourceMappingURL=agent-purpose-protocol.d.ts.map