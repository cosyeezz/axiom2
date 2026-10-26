import type { AgentInputItem } from '../../../cbc-shared/node/index.js';
import type { CompactionTrigger } from '@genie/telemetry';
import { Session } from '../session/session-protocol';
export declare const PromptContextProvider: unique symbol;
export declare const PromptContextInitializer: unique symbol;
export declare const ContextCompactSummarizer: unique symbol;
export declare const ManualCompactRequestHandler: unique symbol;
export declare const PromptRenderer: unique symbol;
/** Marks only the physical stream aborted by compaction, even after its controller is replaced. */
export declare class CompactionAbortError extends Error {
    constructor();
}
export declare const COMPACT_PROMPT = "compact-prompt";
export declare const DEFAULT_TOKEN_THRESHOLD = 0.7;
export declare const DEFAULT_WARNING_THRESHOLD = 0.5;
/**
 * Parse CODEBUDDY_AUTOCOMPACT_PCT_OVERRIDE environment variable.
 * Accepts an integer 1-100 representing a percentage of max input tokens.
 * Returns the value as a ratio (0.01-1.0) or undefined if not set / invalid.
 *
 * When set, this override takes priority over all product-config thresholds
 * (emergency) for auto-compaction triggers.
 *
 * Example: CODEBUDDY_AUTOCOMPACT_PCT_OVERRIDE=30 → triggers compaction at 30% token usage
 */
export declare function getAutocompactThresholdOverride(): number | undefined;
/**
 * Parse CODEBUDDY_PRE_MESSAGE_COMPACT_PCT environment variable.
 * Accepts an integer 1-100 representing a percentage of max input tokens.
 * Returns the value as a ratio (0.01-1.0) or undefined if not set / invalid.
 *
 * When set, this override takes priority over product-config preMessage threshold
 * and also activates the pre-message compact strategy (even if product.json has no preMessage).
 *
 * Example: CODEBUDDY_PRE_MESSAGE_COMPACT_PCT=50 → triggers pre-message compaction at 50% token usage
 */
export declare function getPreMessageCompactThresholdOverride(): number | undefined;
/**
 * Returns the engineering-compact sufficiency ratio from the environment variable
 * `CODEBUDDY_ENGINEERING_COMPACT_SUFFICIENCY_PCT`, or the default value 0.15.
 *
 * After engineering compact, if estimated tokens still exceed maxInputTokens * this ratio,
 * an LLM summary will be triggered as a second pass.
 *
 * Example: CODEBUDDY_ENGINEERING_COMPACT_SUFFICIENCY_PCT=7 → ratio = 0.07
 */
export declare function getEngineeringCompactSufficiencyRatio(): number;
/**
 * Resolve the rollout gate for pre-message compaction.
 *
 * Priority (highest → lowest):
 * 1. Environment variable `CODEBUDDY_PRE_MESSAGE_COMPACT` ('true'/'1' → enable, 'false'/'0' → disable)
 * 2. Product feature key `enablePreMessageCompact` (explicit boolean)
 * 3. Legacy product feature key `ContextSummaryAgent`
 */
export declare function resolvePreMessageCompactEnabled(productFeatures?: Partial<Record<string, boolean>>): boolean;
export declare const AUTO_COMPACT_WINDOW_MIN = 100000;
export declare const AUTO_COMPACT_WINDOW_MAX = 1000000;
/**
 * 解析用户输入的 auto-compact window 值（对齐 Claude Code `--autocompact` / `/autocompact`）。
 * 供 CLI 参数 `--autocompact` 与斜杠命令 `/autocompact` 共用，保证两个入口口径一致。
 *
 * 接受：
 * - `auto`（不区分大小写）→ `{ isAuto: true }`，语义为「跟随模型窗口」（清空 autoCompactWindow）
 * - 纯数字 `400000` / 带 1000 进制后缀 `400k` / `1m`（不区分大小写）→ `{ value: number }`，
 *   clamp 到 [100k, 1M]（与 {@link getAutoCompactWindow} 的兜底范围一致）
 * - 其它 → `{ error }`
 *
 * k/m 用 1000 进制，与 `formatToken` 的展示口径一致。
 */
export declare function parseAutoCompactWindowInput(raw: string): {
    value?: number;
    isAuto?: boolean;
    error?: string;
};
/**
 * 解析自动压缩窗口基准值（绝对值），仅用于 `model.maxInputTokens` 未配置的兜底场景
 * （典型：用户自定义 OpenAI 兼容模型）；已配 maxInputTokens 的模型走百分比路径。
 * 缺省 200k，最终 clamp 到 [100k, 1M]。
 */
export declare function getAutoCompactWindow(autoCompactWindowSetting?: number): number;
/**
 * 自动压缩触发点解析（pre-message-compact-interceptor / context-compact-summarizer
 * / runner-factory / model-based-token-calculator 共用）。
 *
 * 对齐 Claude Code `CLAUDE_CODE_AUTO_COMPACT_WINDOW`：autoCompactWindow 是「压缩计算的
 * 上下文窗口基准值」（不是上下文窗口本身），触发点 = `min(autoCompactWindow, 模型有效预算)
 * × percentThreshold`。`modelMaxInputTokens` 应传入 `resolveEffectiveContextBudget` 的会话
 * 有效预算（已含 ACP context_window override），因此 window 只能进一步收窄、不会超过它。
 *
 * window 未配时退化为 `有效预算 × percentThreshold`（与改造前逐字节等价）；有效预算未配时
 * 退回 {@link getAutoCompactWindow} 绝对值兜底（与 percentThreshold 解耦）。
 */
export declare function resolveCompactTriggerAt(modelMaxInputTokens: number | undefined, percentThreshold: number, autoCompactWindowSetting?: number): number;
export interface ModelContextWindowLike {
    readonly supportedLengths?: readonly number[];
    readonly defaultLength?: number;
}
export declare function normalizeSupportedContextWindows(supportedLengths: readonly number[] | undefined, maxInputTokens?: number): number[];
/**
 * Resolve the effective session context budget for Issue #57413.
 *
 * `maxInputTokens` remains the physical model limit. `contextWindow` declares
 * optional user-selectable budgets such as 200K / 1M. Runtime consumers should
 * use this effective value as the compression / usage denominator instead of
 * mutating the model object.
 *
 * Priority:
 *   valid session override
 *   > valid contextWindow.defaultLength
 *   > min supported length for multi-budget models (fail-closed)
 *   > physical maxInputTokens for single-budget / legacy models
 *   > undefined.
 *
 * 档位是**进程内会话级内存 override**（对齐 thought_level），不落盘：因此不存在
 * "历史会话带旧档位"的兼容问题，无需 grandfather 分支。会话在同一进程内切走/切回时
 * `SessionCtx` 全程存活（SessionManager.setCurrent 的焦点切换不 release 资源），
 * override 天然保持；进程重启 / evict 后 resume 回落默认档。
 *
 * ⚠️ MIRROR: the cloud/sandbox topology keeps a byte-aligned copy of this rule in
 * `packages/agent-client-protocol/src/node/acp/agent-session.ts`
 * (`resolveEffectiveContextSizeFromRawModel`). The two packages share no common
 * lower-level package (per #57413 §6.7), so the dedup/filter/priority logic is
 * intentionally duplicated — change one, sync the other.
 */
export declare function resolveEffectiveContextBudget(input: {
    overrideContextWindow?: number;
    contextWindow?: ModelContextWindowLike;
    maxInputTokens?: number;
}): number | undefined;
/**
 * 取一个 session 当前生效的上下文预算（Issue #57413），供压缩阈值 / usage 分母共用。
 *
 * 这是所有"曾经直接读 `model.maxInputTokens`"的阈值消费点应改用的入口：
 * pre-message-compact-interceptor / context-compact-summarizer / runner-factory /
 * model-based-token-calculator / status-manager / token-usage-thresholds-service。
 *
 * 传入的 model 应当已由 `ModelUtils.resolveModelForTokenLimits` 解析（即会话运行时
 * 真实模型，而非 defaultAgent 兜底），否则档位集合可能与用户所选模型分叉。
 *
 * `sessionManager` 用最小结构约束而非 import SessionManager 接口，避免 context 层
 * 反向依赖 session 层实现。
 */
export declare function resolveSessionContextBudget(session: Session, model: {
    maxInputTokens?: number;
    contextWindow?: ModelContextWindowLike;
} | undefined, sessionManager: {
    getOverrideContextWindow(sessionId: string): number | undefined;
} | undefined): number | undefined;
export interface PromptContext {
    session?: Session;
    [key: string]: unknown;
}
export interface PromptContextProvider {
    get(seed?: PromptContext): Promise<PromptContext>;
}
export interface PromptContextInitializer {
    initialize(context: PromptContext): Promise<void>;
}
/**
 * 压缩类型（同时隐含前端默认 UI 策略）。
 *
 * 后端通过此枚举告诉前端"这次压缩是哪一种"，前端据此选择是否展示 divider / progress，
 * 后续新增类型（例如 PTL 恢复、emergency 自动压缩独立 UI 等）时在此扩展即可，
 * 避免再叠加 `isXxx` 布尔字段。
 *
 * - `USER_COMMAND`：用户主动 `/compact`（或等价的斜杠命令入口）。
 *   前端展示"正在压缩 → 上下文已压缩"分隔线 + progress。
 * - `PRE_MESSAGE_AUTO`：`PreMessageCompactInterceptor` 在发用户消息前触发的
 *   自动预压缩。前端完全静默，用户无感知。
 *
 * 未显式声明时按 `USER_COMMAND` 处理（向后兼容 /compact、runner-factory 后台
 * 压缩、PTL 恢复等现存调用者）。
 *
 * 注：此枚举的字符串值是 ACP 协议的一部分（会写入 sessionUpdate 的 _meta
 * 以及 history 里的 providerData），workbuddy-desktop adapter 端有对齐的枚举
 * `CompactType`（见 workbuddy-agent-adapter-next.ts），两端值必须保持一致。
 */
export declare enum CompactType {
    USER_COMMAND = "user-command",
    PRE_MESSAGE_AUTO = "pre-message-auto",
    /** Emergency auto-compact triggered by runner-factory when token usage exceeds emergency threshold (>90%). */
    EMERGENCY_AUTO = "emergency-auto"
}
export interface ContextCompactSummarizeOptions {
    tokenThreshold?: number;
    force?: boolean;
    customInstructions?: string;
    /** Skip sending continue message after compaction. Used when the caller already has a pending user message. */
    skipContinue?: boolean;
    /** Replace the default continue message with custom input items (e.g. user's original message for preMessage compact). */
    continueInput?: import('../../../cbc-shared/node/index.js').AgentInputItem[];
    /**
     * 压缩类型；未声明按 `CompactType.USER_COMMAND` 处理（保持原有 UI）。
     * 后端会把它透传到 ACP meta，desktop adapter 按类型选择展示策略。
     */
    type?: CompactType;
    /** Stable identity shared by live updates and the durable compact boundary. */
    compactionId?: string;
    /** Why this compaction runs; defaults from `type` (manual / pre_message_threshold / emergency_threshold). */
    trigger?: CompactionTrigger;
}
export type ContextCompactSkipReason = 'already_compacting' | 'pending_interruption' | 'auto_disabled' | 'empty_history' | 'already_compacted' | 'non_default_agent' | 'below_threshold';
export type ContextCompactFailureReason = 'strategy_failed' | 'strategy_unavailable';
export type ContextCompactResult = {
    status: 'completed';
    compactionId: string;
    strategy: string;
} | {
    status: 'skipped';
    reason: ContextCompactSkipReason;
} | {
    status: 'failed';
    compactionId: string;
    reason: ContextCompactFailureReason;
    strategy?: string;
};
export declare function createCompactionId(): string;
/**
 * 压缩类型在 session.meta 上的键。集中定义以防拼写漂移。
 * 所有读写方统一引用该常量。
 */
export declare const SESSION_META_COMPACT_TYPE: 'compactType';
/** Current stable compaction identity, persisted onto the boundary item. */
export declare const SESSION_META_COMPACTION_ID: 'compactionId';
/** Trigger of the compaction the summarizer is running; unset for a typed `/compact`. */
export declare const SESSION_META_COMPACTION_TRIGGER: 'compactionTrigger';
/**
 * session.meta 上标记当前 compact 成功后会继续执行一次真实 agent run。
 *
 * ACP 只能在这个标记存在时把 compact agent 自己的 result 视为内部中间态；
 * `skipContinue:true` 的手动 compact 没有后续 run，compact result 本身就是终态。
 */
export declare const SESSION_META_COMPACT_EXPECTS_CONTINUE: 'compactExpectsContinue';
/**
 * session.meta 上标记 compact 已产出摘要、正在执行后续 continue run。
 *
 * `session.isCompressing` 会覆盖 compact + post-compact continue 的完整生命周期，
 * 用于阻止 ACP / AgentTask 在 compact result 后过早收口；本标记用于区分
 * "真正的 compact 内部流" 和 "压缩后的用户请求继续执行"。
 */
export declare const SESSION_META_COMPACT_CONTINUE_IN_PROGRESS: 'compactContinueInProgress';
/**
 * session.meta 上标记 `AgentPurpose.ConversationCompact` 尚未被消费。
 *
 * 纯工程 PreMessage 压缩会把 `session.agentPurpose` 置为 `conversation:compact`，
 * 用来标记紧随其后的那一轮对话请求。该 purpose 在下游被当作"非用户对话"过滤
 * （telemetry 不上报、agentlog 整段排除），所以只能作用一轮——本标记就是那"一轮"
 * 的凭据：`TelemetryAgentRunInterceptor` 消费掉标记时保留 purpose，之后再遇到同一
 * purpose 且无标记，即判定为遗留值并洗回 `AgentPurpose.Conversation`。
 */
export declare const SESSION_META_COMPACT_PURPOSE_PENDING: 'compactPurposePending';
/**
 * pre-message compact 失败后，原始用户消息已恢复给 history 持久化，当前 prompt 应直接收口。
 */
export declare const SESSION_META_PRE_MESSAGE_COMPACT_ENDED: 'preMessageCompactEnded';
/**
 * pre-message compact 失败时给 ACP prompt response 透传的用户可见错误文案。
 */
export declare const SESSION_META_PRE_MESSAGE_COMPACT_ERROR_MESSAGE: 'preMessageCompactErrorMessage';
/**
 * ACP sessionUpdate `_meta` 中透传压缩类型的键，供 desktop adapter
 * 按类型选择 UI 展示策略。值域与 {@link CompactType} 对齐。
 */
export declare const ACP_META_COMPACT_TYPE: 'codebuddy.ai/compactType';
/**
 * ACP sessionUpdate `_meta` 中透传"该事件来源于 sub-agent session"的键。
 * 由 AcpBroadcastService 在 compact 起止帧填写（issue #44075）。desktop adapter
 * 据此过滤 sub-agent compact transcript，避免它出现在主时间线 / Task 视图。
 *
 * 注意：这条 meta 与 `codebuddy.ai/parentToolCallId` 互补——
 *   - parentToolCallId：父会话转发的 sub-agent 事件（带 toolUseId 关联）；
 *   - isSubAgent / parentSessionId：sub-agent 自身 session 直接广播的事件
 *     （后端 broadcastCompactStarted/Completed 走这条，没有 toolUseId）。
 */
export declare const ACP_META_IS_SUB_AGENT: 'codebuddy.ai/isSubAgent';
/**
 * ACP sessionUpdate `_meta` 中透传 sub-agent session 的 parentSessionId 的键，
 * 用于 desktop adapter 在过滤 compact transcript 时识别 sub-agent 身份。
 *
 * 与 {@link ACP_META_IS_SUB_AGENT} 同源写入；adapter 任一命中即视为 sub-agent。
 */
export declare const ACP_META_PARENT_SESSION_ID: 'codebuddy.ai/parentSessionId';
/**
 * ACP sessionUpdate `_meta` 中标记 "这是 content_filter 安全审查占位消息" 的键。
 * 重放历史时占位消息内容存的是英文兜底文案，前端（agent-ui）据此 marker 在渲染时按当前语言
 * 用 t('message.contentFilter.notice') 本地化展示。
 */
export declare const ACP_META_CONTENT_FILTER_NOTICE: 'codebuddy.ai/contentFilterNotice';
/**
 * session.meta 上记录"最后一次压缩被用户取消"的键。
 *
 * 只在 `doBlockingCompaction` 的 cancel 分支（`session.abortSignal.aborted` 时）写入 true。
 * 用于让 ACP/UI 层区分"成功完成"vs"被取消"——前者由 `<summary>` 闭合标签判定，
 * 后者必须显式 marker，因为 cancel 时 LLM 已 stream 出的 `<summary>` chunks
 * 仍然在 desktop messageCache 里，单凭内容判据会误判为 completed。
 *
 * 写入后由 ACP 层（acp-agent / acp-broadcast-service）透传给 client。
 * 由 `cancelSessionRuntimeState` 编排器或下一轮 prompt 的 finally 块清理。
 */
export declare const SESSION_META_COMPACT_CANCELLED: 'compactCancelled';
/**
 * ACP `session_info_update._meta` 上透传"最后一次压缩被取消"的键。
 *
 * Payload 结构（轻量级，只携带必要的 disambiguation 字段）：
 *   {
 *     cancelled: true,
 *     cancelledMessageId?: string,  // 可选：被取消的 compact assistant messageId
 *                                    // desktop adapter 用它精确匹配 messageCache 里那条
 *   }
 *
 * UI 三端消费方（desktop adapter / agent-cli web-ui / cb-chat-ui CompactDivider）
 * 据此把 compact 显示卡从默认"已完成 ✓"切换到"已取消"视觉，覆盖纯内容判据
 * （`<summary>` 闭合标签）的误判。
 */
export declare const ACP_META_COMPACT_CANCELLED: 'codebuddy.ai/compact-cancelled';
/**
 * ACP meta key：单次 request 内 compact 次数达到上限信号。
 *
 * 当 EMERGENCY_AUTO compact 在单次 request 中连续触发超过阈值（默认 5 次），
 * 通过 session_info_update 广播此信号，通知 UI 展示警告提示。
 */
export declare const ACP_META_COMPACT_LIMIT_REACHED: 'codebuddy.ai/compact-limit-reached';
/**
 * 单次 request 内 doMaxTokenCompaction 连续触发的默认最大次数。
 * 可通过 product 配置 tokenUsageThresholds.maxConsecutiveTokenLimitSummary 覆盖。
 */
export declare const DEFAULT_MAX_CONSECUTIVE_COMPACT = 5;
export interface ContextCompactSummarizer {
    /** Typed API for protocol and lifecycle callers. */
    compactWithResult(session: Session, options?: ContextCompactSummarizeOptions): Promise<ContextCompactResult>;
    /** Compatibility wrapper for existing automatic-compaction callers. */
    compactAndSummarize(session: Session, options?: ContextCompactSummarizeOptions): Promise<boolean>;
}
/**
 * Host-owned boundary for external `/compact` requests.
 *
 * AgentService invokes this before creating a normal run lifecycle when an
 * interactive host opts in. Implementations must return false for internal compact
 * inputs so strategy-owned internal runs cannot recursively re-enter this boundary.
 */
export interface ManualCompactRequestHandler {
    tryHandle(input: string | AgentInputItem[], session: Session): Promise<boolean>;
    /**
     * Runs the same built-in `/compact` orchestration without reparsing a
     * command. Callers may fail fast instead of waiting for a busy session.
     */
    compact(session: Session, options?: {
        customInstructions?: string;
        waitForIdle?: boolean;
    }): Promise<boolean>;
}
export interface PromptRenderer {
    render(template: string, context?: PromptContext): Promise<string>;
}
/**
 * Summary 场景类型，用于区分不同压缩场景下使用的 prompt 模板。
 *
 * - `default`: PreMessage 两阶段压缩中的 LLM summary（pre-message 阈值触发后工程压缩不够时）
 * - `maxTokenLimit`: MaxInputToken 场景（emergency 阈值 / 模型报 PTL 错误时的智能裁剪 + summary）
 */
export type SummaryScenario = 'default' | 'maxTokenLimit';
/**
 * 压缩策略接口。每个策略只关心"如何压缩"，
 * 准入判断和路由由 ContextCompactSummarizer 统一管理。
 *
 * 策略通过 CellJS 多实例注入注册，路由器按 `priority` 排序后依次匹配。
 */
export declare const CompactStrategy: unique symbol;
export interface CompactStrategy {
    /** 策略名称，用于日志和 telemetry */
    readonly name: string;
    /** 优先级，数值越大越优先匹配（与 AgentRunInterceptor 一致） */
    readonly priority: number;
    /**
     * 判断此策略是否能处理当前压缩请求。
     * 由路由器在所有候选策略上依次调用。
     */
    canHandle(context: CompactStrategyContext): boolean;
    /**
     * 执行压缩。调用时 canHandle 已返回 true。
     * @returns true 表示压缩成功
     */
    execute(session: import('../session/session-protocol.js').Session, options: ContextCompactSummarizeOptions, context: CompactStrategyContext): Promise<boolean>;
}
/** 策略执行时共享的上下文（由路由器在准入判断阶段计算好） */
export interface CompactStrategyContext {
    readonly compactType: CompactType;
    readonly tokenCount: number;
    readonly model: Readonly<{
        maxInputTokens?: number;
        name?: string;
    }>;
    readonly isSubAgent: boolean;
    readonly force: boolean;
    readonly triggerAt: number;
    readonly emergencyThreshold: number;
}
//# sourceMappingURL=context-protocol.d.ts.map