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
export interface OverrideRow {
  id: string;
  key: string;
  value: string;
  // Saved values are never returned. This reference preserves an unchanged value on the server.
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
}
export type ProviderProxy = { mode: "direct" } | { mode: "external"; url: string; keepUrl?: boolean } | { mode: "builtin"; profileId: string };
export interface ProviderDraft {
  id: string;
  originalId?: string;
  connectionType?: "custom" | "oauth";
  hasConnectionOverrides?: boolean;
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
