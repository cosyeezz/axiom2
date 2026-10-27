export const reasoningLevels = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ReasoningLevel = (typeof reasoningLevels)[number];
export const modelApis = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
] as const;
export const samplingKeys = [
  "temperature",
  "top_p",
  "top_k",
  "min_p",
  "seed",
  "presence_penalty",
  "frequency_penalty",
  "max_tokens",
  "max_completion_tokens",
  "max_output_tokens",
] as const;
export type BodyOverrideType = "string" | "number";
export const bodyOverrideType = (key: string): BodyOverrideType =>
  samplingKeys.includes(key as (typeof samplingKeys)[number]) ? "number" : "string";
export const validBodyOverrideKey = (key: string) =>
  !!key && key.length <= 100 && !/[\x00-\x20\x7f]/.test(key) &&
  !["__proto__", "prototype", "constructor"].includes(key);
export const editableBodyOverride = (key: string, value: unknown) =>
  validBodyOverrideKey(key) &&
  ((typeof value === "string" && value.length <= 8192) || (typeof value === "number" && Number.isFinite(value)));
export interface OverrideRow {
  id: string;
  key: string;
  value: string;
  valueType?: BodyOverrideType;
  // Saved header values are never returned. This reference preserves an unchanged value on the server.
  source?: string;
  keep?: boolean;
}
export type ModelInput = "text" | "image";
export const modelCostKeys = ["input", "output", "cacheRead", "cacheWrite"] as const;
/** USD per million tokens, as used by the model runtime. */
export type ModelPricing = Record<(typeof modelCostKeys)[number], number>;
export const emptyModelPricing = (): ModelPricing => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
export function validModelPricing(value: unknown): value is ModelPricing {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prices = value as Record<string, unknown>;
  return modelCostKeys.every(key => typeof prices[key] === "number" && Number.isFinite(prices[key]) && prices[key] >= 0);
}
export interface ModelDraft {
  key: string;
  originalId?: string;
  // Configurations may share an upstream id while retaining distinct local identities.
  configId?: string;
  copyFromId?: string;
  id: string;
  name: string;
  levels: ReasoningLevel[];
  // Omitted by older clients: preserve the model's native input capabilities.
  input?: ModelInput[];
  // Effective base rates; omitted by older clients to preserve existing pricing.
  cost?: ModelPricing;
  costTiered?: boolean;
  headers: OverrideRow[];
  body: OverrideRow[];
  // Version 2 exposes all editable strings/numbers; omitted by legacy clients.
  bodyVersion?: 2;
}
// Preserve an existing configuration's identity when new rows share its upstream ID.
export function assignModelConfigIds<T extends { id: string; configId?: string; originalId?: string }>(models: T[]): T[] {
  const owners = new Map<string, T>();
  const reserved = new Set(models.map(model => model.configId ?? model.id));
  for (const model of models) {
    const identity = model.configId ?? model.id, previous = owners.get(identity);
    if (!previous || (model.configId !== undefined && previous.configId === undefined) ||
        (model.configId === undefined && previous.configId === undefined && model.originalId === identity && previous.originalId !== identity)) owners.set(identity, model);
  }
  return models.map(model => {
    if (model.configId !== undefined || owners.get(model.id) === model) return model;
    let configId = model.originalId;
    if (!configId || reserved.has(configId)) {
      do { configId = `axiom-model-${crypto.randomUUID()}`; } while (reserved.has(configId));
    }
    reserved.add(configId);
    return { ...model, configId };
  });
}
export type ProviderProxy = { mode: "direct" } | { mode: "external"; url: string; keepUrl?: boolean } | { mode: "builtin"; profileId: string };
export interface ProviderDraft {
  id: string;
  originalId?: string;
  connectionType?: "custom" | "oauth";
  hasConnectionOverrides?: boolean;
  /** Read-only connection/catalog diagnostics; never persisted as configuration. */
  notices?: string[];
  providerId: string;
  name: string;
  api: string;
  url: string;
  keepUrl?: boolean;
  proxy?: ProviderProxy;
  key: string;
  clearKey?: boolean;
  headers: OverrideRow[];
  body: OverrideRow[];
  models: ModelDraft[];
  auth?: {
    configured: boolean;
    error?: string;
    source?: string;
    type?: "api_key" | "oauth";
    methods: ("api_key" | "oauth")[];
  };
}
export interface ModelConfiguration {
  revision: string;
  providers: ProviderDraft[];
  storage?: { modelsPath: string; authPath: string };
  templates: { id: string; name: string; api: string; url: string; methods?: ("api_key" | "oauth")[] }[];
}
export interface ModelCatalog {
  providerId: string;
  revision: string;
  source: "endpoint" | "native" | "refreshed" | "local";
  message: string;
  models: { id: string; name: string; api: string; levels?: ReasoningLevel[]; input?: ModelInput[]; contextWindow?: number }[];
}
export interface AuthState {
  id: string;
  providerId: string;
  status: "running" | "completed" | "failed";
  message: string;
  url?: string;
  userCode?: string;
  prompt?: {
    id: string;
    type: "secret" | "text" | "manual_code" | "select";
    message: string;
    placeholder?: string;
    options?: { id: string; label: string }[];
  };
}
export interface ConfigurationSave {
  revision: string;
  providers: ProviderDraft[];
  confirmLogout?: boolean;
  allowCommands?: boolean;
}
