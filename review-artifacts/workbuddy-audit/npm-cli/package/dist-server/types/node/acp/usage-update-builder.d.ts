/**
 * usage_update 派生构造器。
 *
 * 抽取自 `AcpUsagePublisher.doPublish` 的 `used` / `size` / `usageByCategory`
 * 计算逻辑，供**非 ACP 连接**路径复用（如 `/api/v1/sessions/:id/replay`）：
 * WorkBuddy Desktop 切换历史对话走 CLI HTTP replay，不经过 ACP `loadSession()`，
 * 因此需要在 replay 结果里补一条派生的 `usage_update`（含 `usageByCategory`），
 * 让上下文环 popover 在历史对话恢复后可用。
 *
 * 严格只读：不修改 `session.usage` / `session.history`，与 publisher 红线一致。
 */
import { type ModelContextWindowLike, type Session } from '../../vendor/cbc-core/node/index.js';
import { type ToolLike, type UsageByCategory } from './usage-by-category-calculator';
/** ACP `update._meta` 命名空间：上下文消耗 5 类目细拆（与 publisher 保持一致）。 */
export declare const META_KEY_CONTEXT_USAGE_BY_CATEGORY = "codebuddy.ai/usageByCategory";
/**
 * `usage_update._meta` 下的轮次积分累计快照：`{ [conversationRequestId]: totalCredit }`。
 * 实时帧携带本帧所属轮次的累计值，回放帧携带历史中各轮次的累计值；值为快照语义，
 * 消费方按 requestId 取大合并即可，重复投递不会重复计费。
 */
export declare const META_KEY_REQUEST_CREDITS = "codebuddy.ai/requestCredits";
/** 积分保留两位小数，避免长会话浮点累加误差。 */
export declare function roundCredit(value: number): number;
/**
 * 按 conversationRequestId 汇总历史中已结算的积分：
 * - 主模型调用：输出条目 / `model-usage` 上的 `providerData.rawUsage.credit`，同一次调用拆出的
 *   多个条目共用 messageId，只计一次；
 * - 子代理 / 生成工具：`credit-usage` 条目的 `providerData.credit`，按 stageId 去重。
 * 调用方负责筛出活跃分支（回放视图会剔除自定义条目，需另行补回积分类条目）。
 */
export declare function collectRequestCreditsFromHistory(history: readonly unknown[]): Record<string, number>;
/**
 * `_meta` 命名空间：当前上下文占用 token（= `getLatestUsage().inputTokens`）。
 *
 * 主要给 stream-json `result._meta` 用（ACP 链路的 used 走 `usage_update.used`
 * 顶层字段，无需此键）。CC stream-json 无独立「当前占用」字段——前端靠
 * `modelUsage[model].contextWindow` 反推；cbc 直接给出便于面板作分子。
 */
export declare const META_KEY_CONTEXT_USED = "codebuddy.ai/contextUsed";
/**
 * `_meta` 键：本轮实际生效的上下文预算 token 数（Issue #145200，面板分母）。
 *
 * 与 ACP `usage_update.size` 同一计算（`resolveSessionContextSize`，含会话档位）。
 * `modelUsage[model].contextWindow` 仍是模型物理窗口（对齐 CC），二者不可混用。
 * 算不出时不写该键，与 ACP 跳过推送一致。
 */
export declare const META_KEY_CONTEXT_WINDOW = "codebuddy.ai/contextWindow";
/** calculator 只消费日志的 `info`，此处收敛为最小契约。 */
export interface UsageUpdateBuilderLogger {
    info?: (message: string) => void;
    warn?: (message: string) => void;
}
/** builder 依赖的 AgentManager 子集（仅取模型信息，避免耦合完整实现）。 */
export interface UsageUpdateBuilderAgentManager {
    getDefault(): Promise<{
        name: string;
        instructions?: unknown;
        tools?: unknown;
    }>;
    /**
     * 按 id 在【全量模型目录】解析模型（与 getConfigOptions 的 getCurrentModelLanguageConfig
     * 及 pre-message-compact-interceptor 同源）。用它替代旧的 getModels(agent).find，避免
     * 会话模型不在默认 agent 子集时回退默认模型、算错 ring 分母。
     */
    resolveModel(modelStr: string): Promise<{
        id?: string;
        maxInputTokens?: number;
        contextWindow?: ModelContextWindowLike;
    } | undefined>;
    getModel(agentName: string): Promise<{
        id?: string;
        maxInputTokens?: number;
        contextWindow?: ModelContextWindowLike;
    } | undefined>;
}
/** 构造成功时的派生结果。 */
export interface BuiltSessionUsageUpdate {
    used: number;
    size: number;
    usageByCategory?: UsageByCategory;
}
/**
 * 解析 session 当前选中模型的 context size（= model.maxInputTokens）。
 * 无法确定时返回 undefined，调用方据此跳过派生（避免假分母）。
 */
export declare function resolveSessionContextSize(session: Session, agentManager: UsageUpdateBuilderAgentManager, logger?: UsageUpdateBuilderLogger, overrideContextWindow?: number): Promise<number | undefined>;
/** 把 `agent.instructions`（string 或 lazy 函数）resolve 成纯字符串。 */
export declare function resolveSystemInstructions(agent: unknown, session: Session): Promise<string>;
/** 提取 agent 当前装载的 tool 数组（calculator 仅消费 name/description/schema）。 */
export declare function resolveActiveTools(agent: unknown): ToolLike[];
/**
 * 计算 session 的 5 类目 usageByCategory。任何步骤抛错都吞掉 + warn，返回
 * undefined（调用方据此不写 usageByCategory 字段）。
 */
export declare function computeSessionUsageByCategory(session: Session, agentManager: Pick<UsageUpdateBuilderAgentManager, 'getDefault'>, used: number, logger?: UsageUpdateBuilderLogger): Promise<UsageByCategory | undefined>;
/**
 * 估算「本轮将发给模型的输入总 token」，用于 prompt_start / compacted 占位帧
 * （此刻 getLatestUsage 拿不到 fresh usage / 仍是压缩前旧值）。
 *
 * 用 `TokenUtils.estimateTokensRough`——cbc-core 判断压缩阈值的同一把尺子，比 byCategory
 * 相对权重更贴近系统认知。输入 = systemPrompt + tools + 压缩后 history（逐项剥图片避免
 * base64 爆表）+ 可选 pendingInputText，再乘保守系数。任何步骤抛错则 warn 并返回 0
 * （调用方跳过、不推假值）。
 *
 * @param options.pendingInputText prompt_start 时当前用户输入尚未写入 session.history
 *   （publish 早于 promptEvent.next 触发的 admission），显式计入避免大输入 / 队列 prompt
 *   期间环显示上一轮旧占用。
 * @param options.requireCompactionBoundary compacted 帧专用。blocking 压缩不往运行态
 *   history 写 isCompacted/isSummary 边界（summary 在下一轮 view 层注入），此时
 *   `filterBeforeCompactedMessage` 原样返回全量历史 → 估算读到压缩前历史、偏高。识别到
 *   「无边界」（filter 返回原引用）即返回 0，让调用方跳过占位推送，避免把偏高值推给环
 *   并污染 high-water；环等下一轮真实 usage 回填。有边界的自动压缩（MaxToken/PreMessage）
 *   则正常估算，环压缩后立即下降。
 */
export declare function estimateSessionInputTokens(session: Session, agentManager: UsageUpdateBuilderAgentManager, logger?: UsageUpdateBuilderLogger, options?: {
    pendingInputText?: string;
    requireCompactionBoundary?: boolean;
}): Promise<number>;
/**
 * 基于 session 现有 usage 派生一条 `usage_update` 载荷（used + size + usageByCategory）。
 *
 * - `used` 取 `UsageUtils.getLatestUsage(session)?.inputTokens`；缺失（历史无 usage）时返回 undefined。
 * - `size` 取当前模型 `maxInputTokens`；缺失时返回 undefined（不造假分母）。
 * - `usageByCategory` calculator 降级失败时字段缺省，不影响 used/size。
 */
export declare function buildSessionUsageUpdate(session: Session, agentManager: UsageUpdateBuilderAgentManager, logger?: UsageUpdateBuilderLogger, overrideContextWindow?: number): Promise<BuiltSessionUsageUpdate | undefined>;
