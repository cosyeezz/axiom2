import type { Model } from "@earendil-works/pi-ai";
import type { NativeModel } from "../../native-providers/contracts.js";
import { codeBuddyBuiltinModels } from "../../native-providers/codebuddy/models.js";
import { codeBuddyId, codeBuddyBaseUrl, codeBuddyHeaders } from "../../native-providers/codebuddy/identity.js";
export { codeBuddyId, codeBuddyBaseUrl, codeBuddyCliVersion, codeBuddyHeaders } from "../../native-providers/codebuddy/identity.js";

// Pure SDK metadata mapping; protocol facts and their MIT notice live in the native core.
export function codeBuddyModels(models: readonly NativeModel[] = codeBuddyBuiltinModels()): Model<"openai-completions">[] {
  return models.map(model => {
    if (!model.contextWindow || !model.maxOutputTokens) throw new Error("CodeBuddy 模型缺少已知上下文限制。");
    return {
      id: model.id, name: model.name, provider: codeBuddyId, api: "openai-completions", baseUrl: codeBuddyBaseUrl,
      headers: { ...codeBuddyHeaders }, input: [...model.input], reasoning: model.thinking.supported,
      contextWindow: model.contextWindow, maxTokens: model.maxOutputTokens,
      // Runtime unset-cost baseline, not a free-tier claim. Never trust remote price claims here.
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      thinkingLevelMap: model.thinking.levels ? { ...model.thinking.levels } : undefined,
      compat: {
        supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: true,
        supportsLongCacheRetention: false, maxTokensField: "max_tokens", thinkingFormat: "openai",
      },
    };
  });
}
