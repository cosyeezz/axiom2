import { LanguageModel } from '@genie/product';
import { AgentManager } from '../agent/agent-protocol';
import type { Session } from '../session/session-protocol';
interface MaxOutputTokensOptions {
    /** Whether a missing product value may fall back to catalog maxTokens. */
    useCatalogFallback?: boolean;
}
export declare abstract class ModelUtils {
    /**
     * 获取当前会话使用的模型
     * @param session 会话对象（可选）
     * @returns 当前使用的语言模型
     */
    static getCurrentModel(session?: Session): Promise<LanguageModel>;
    /**
     * 补齐当前 model 的 effort 能力字段，供 `/effort` 命令与 EffortPanel 同源解析档位。
     *
     * `getCurrentModel` 直接返回 product config 的 raw model：内置模型的
     * `thinkingLevelMap` 只在打包目录（model-catalog）里、config 不带，会让
     * `resolveSupportedEfforts` 恒 undefined、picker 回落到不含 `max` 的安全档位——
     * 即便当前模型在 catalog 里明确支持 `max`。config / models.json 未显式声明能力时，
     * 按 `model.id` 回查内置 catalog 补 `thinkingLevelMap`，与发送侧 model-compatibility 的
     * `resolveModelCapabilities` 口径一致。
     */
    static withCatalogEffortCapability(model: LanguageModel): Pick<LanguageModel, 'reasoning' | 'thinkingLevelMap'>;
    /**
     * 验证 max tokens 环境变量的有效性
     * @param value 环境变量值
     * @returns 验证结果,包含状态和有效值
     */
    private static validateMaxTokens;
    /**
     * 获取最大输出 tokens 配置
     * 优先级: 环境变量 < 模型配置的默认值 < 内置 model catalog
     * 最终值会取 min(环境变量, 模型最大值)
     *
     * Issue #62255：当解析出来的模型配置缺少 maxOutputTokens（企业后台 / 云端下发的模型条目、
     * 改名后未按 id 与本地条目合并的模型、或 AgentManager 构造的裸 `{id, name}` 兜底对象）时，
     * 若直接返回 undefined，ModelConfigAgentRunInterceptor 就不会写 agent.modelSettings.maxTokens，
     * SDK 序列化时也不带 max_tokens，最终由模型侧填一个保守兜底值。这里在配置缺省时回退到内置
     * model catalog 中该模型 id 的 maxTokens，避免请求"丢失" max_tokens。
     * 自定义端点可通过 options 关闭该 fallback，避免把模型能力上限误当作安全的单请求默认值。
     *
     * @param modelId 模型标识
     * @param modelDefaultMaxTokens 模型配置中的默认最大 token 数
     * @param options catalog fallback 控制项
     * @returns 最终的最大输出 token 数
     */
    static getMaxOutputTokens(modelId: string, modelDefaultMaxTokens?: number, options?: MaxOutputTokensOptions): number | undefined;
    /**
     * 从内置 model catalog 解析模型 id 的最大输出 token 数（catalog 的 maxTokens 映射为 maxOutputTokens）。
     * catalog 未收录该模型时返回 undefined。仅用于配置缺省时的兜底，见 getMaxOutputTokens。
     */
    private static getCatalogMaxOutputTokens;
    /**
     * 解析 session 运行时实际 model，用于 token 上限阈值计算
     * （compact triggerAt、usage level 分子）。
     *
     * 优先级（对齐 ModelConfigInterceptor）：
     *   requestOptions.model > options.model > agentManager.getModel(agentName)
     *
     * `resolveModel` miss（外部未知 id）时回退 agent 默认 model 完整配置，保证返回
     * 的 LanguageModel 一定含 maxInputTokens——与 `getCurrentModel` 关键区别。
     */
    static resolveModelForTokenLimits(agentManager: AgentManager, session: Session, agentName: string): Promise<LanguageModel>;
    /**
     * 读取 session 运行时切换后的 model id（不解析成 LanguageModel）。
     * 内部共享给 `getCurrentModel` / `resolveModelForTokenLimits` 使用，避免两处
     * 各写一份 `||` 顺序漂移。
     */
    private static readRuntimeModelId;
    /**
     * 从模型配置的 credits 字段解析计费倍率；未配置或无法解析时返回 undefined。
     * 兼容 `x0.00` / `0.00x` / `x2.20 credits` 等格式，取首个数字。
     */
    private static parseCreditsValue;
    /**
     * 当前会话模型是否为免费模型。
     *
     * 判据是模型计费（credits）：明确收费（> 0）不算免费；计费为 0、未配置或
     * 无法解析时按免费处理。免费模型会话下生图、语音转写会额外消耗积分，需要前置提醒。
     */
    static isFreeModel(session: Session): Promise<boolean>;
    static isMandatoryApprovalTarget(session: Session, targetToolName: string): Promise<boolean>;
}
export {};
//# sourceMappingURL=model-utils.d.ts.map