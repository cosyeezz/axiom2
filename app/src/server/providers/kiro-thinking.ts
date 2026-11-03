import { getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
import { kiroThinkingCapabilities, kiroThinkingRequest as nativeThinkingRequest } from "../../native-providers/kiro/thinking.js";
export { KiroThinkingError, type KiroThinking } from "../../native-providers/kiro/thinking.js";

export function kiroThinkingModel(id: string) {
  const capabilities = kiroThinkingCapabilities(id);
  return { reasoning: capabilities.supported, ...(capabilities.levels ? { thinkingLevelMap: capabilities.levels } : {}) };
}
/** SDK-specific enabled levels are explicit input, never a component dependency. */
export function kiroThinkingInput(model: Model<Api>) {
  return { id: model.id, enabledThinkingLevels: getSupportedThinkingLevels(model), thinkingLevelMap: model.thinkingLevelMap };
}
export function kiroThinkingRequest(model: Model<Api>, options: { reasoning?: unknown; thinkingBudgets?: unknown }) {
  return nativeThinkingRequest(kiroThinkingInput(model), options);
}
