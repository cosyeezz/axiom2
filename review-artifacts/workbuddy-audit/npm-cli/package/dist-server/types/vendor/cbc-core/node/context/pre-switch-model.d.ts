import type { AgentInputItem } from '../../../cbc-shared/node/index.js';
import { type ModelContextWindowLike } from './context-protocol';
/** 摘要请求用切换前模型执行，inputTokens 是它预留输出后的可用输入。 */
export interface CompactSummaryModel {
    id: string;
    maxOutputTokens?: number;
    inputTokens?: number;
}
/** 比较上下文窗口时需要的模型字段。不含会话档位 override。 */
export interface PreSwitchModelLike {
    id: string;
    maxInputTokens?: number;
    maxOutputTokens?: number;
    contextWindow?: ModelContextWindowLike;
}
/**
 * 从会话历史推导切换前真正执行过的模型。
 *
 * 只有它能解析出来，且有效窗口大于当前模型时才返回。窗口不更大时不当作切换：
 * Auto 路由可能让 requestModelId 和会话模型不一致，换到更大窗口也不需要强制压缩。
 * 预算用模型自己的窗口，不用会话上的档位 override。
 */
export declare function resolveEligiblePreSwitchModel(input: {
    session: {
        history?: AgentInputItem[];
    };
    currentModel: PreSwitchModelLike;
    resolveModel: (modelId: string) => Promise<PreSwitchModelLike | undefined>;
    logger?: {
        warn: (message: string) => void;
    };
}): Promise<PreSwitchModelLike | undefined>;
/** 按切换前模型的物理窗口计算摘要预算，不用当前模型的档位 override。 */
export declare function buildPreSwitchSummaryModel(model: PreSwitchModelLike): CompactSummaryModel;
//# sourceMappingURL=pre-switch-model.d.ts.map