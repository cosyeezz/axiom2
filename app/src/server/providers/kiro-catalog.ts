import type { Api, Credential, Model } from "@earendil-works/pi-ai";
import { describeKiroModel, fetchKiroCatalog as nativeCatalog, type KiroCatalogModel as NativeKiroModel } from "../../native-providers/kiro/catalog.js";
export { validateKiroCredential, kiroServiceRegion, kiroCatalogScope } from "../../native-providers/kiro/catalog.js";

type KiroCatalogModel = Model<Api> & { kiroSupportedInputTypes?: string[] };
/** Missing/unknown declarations are not an upstream denial of vision support. */
export function kiroCatalogInput(model: Model<Api>): Model<Api>["input"] | undefined {
  const declared = (model as KiroCatalogModel).kiroSupportedInputTypes;
  return declared?.some(value => value === "TEXT" || value === "IMAGE") ? [...model.input] : undefined;
}
function toPi(model: NativeKiroModel): KiroCatalogModel {
  return { id: model.id, name: model.name, provider: "kiro", api: "kiro-chat", baseUrl: `https://q.${model.serviceRegion}.amazonaws.com`,
    input: [...model.input], reasoning: model.thinking.supported,
    ...(model.thinking.levels ? { thinkingLevelMap: { ...model.thinking.levels } } : {}),
    ...(model.declaredInputTypes ? { kiroSupportedInputTypes: [...model.declaredInputTypes] } : {}),
    contextWindow: model.contextWindow ?? 0, maxTokens: model.maxOutputTokens ?? 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
}
/** Only Pi's persisted V1/V2 model shape is decoded here; upstream facts use the component. */
export function restoreKiroCatalog(models: unknown, legacy = false): Model<Api>[] | undefined {
  const text = (value: unknown, limit: number): value is string => typeof value === "string" && !!value.trim() && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value);
  try {
    if (!Array.isArray(models) || models.length > 1000) return undefined;
    const seen = new Set<string>();
    return models.map(value => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
      const item = value as Record<string, unknown>;
      if (item.provider !== "kiro" || !["kiro-chat", "kiro-auth-only"].includes(String(item.api)) ||
          !["https://q.us-east-1.amazonaws.com", "https://q.eu-central-1.amazonaws.com"].includes(String(item.baseUrl)) ||
          !text(item.id, 512) || !text(item.name, 1024) || seen.has(item.id) ||
          !Array.isArray(item.input) || !item.input.includes("text") || new Set(item.input).size !== item.input.length ||
          !item.input.every(value => value === "text" || value === "image")) throw Error();
      seen.add(item.id);
      const region = item.baseUrl === "https://q.eu-central-1.amazonaws.com" ? "eu-central-1" : "us-east-1";
      const model = toPi(describeKiroModel({ modelId: item.id, modelName: item.name, supportedInputTypes: legacy ? undefined : item.kiroSupportedInputTypes,
        tokenLimits: { maxInputTokens: item.contextWindow || undefined, maxOutputTokens: item.maxTokens || undefined } }, region));
      if (item.contextWindow !== model.contextWindow || item.maxTokens !== model.maxTokens || JSON.stringify(item.input) !== JSON.stringify(model.input)) throw Error();
      return model;
    });
  } catch { return undefined; }
}
export async function fetchKiroCatalog(credential: Credential | undefined, signal: AbortSignal, transport: typeof fetch = globalThis.fetch): Promise<Model<Api>[]> {
  return (await nativeCatalog(credential, signal, transport)).map(toPi);
}
