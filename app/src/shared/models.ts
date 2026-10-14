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
export interface ModelDraft {
  key: string;
  originalId?: string;
  id: string;
  name: string;
  levels: ReasoningLevel[];
  headers: OverrideRow[];
  body: OverrideRow[];
}
export interface ProviderDraft {
  id: string;
  originalId?: string;
  providerId: string;
  name: string;
  api: string;
  url: string;
  keepUrl?: boolean;
  key: string;
  clearKey?: boolean;
  headers: OverrideRow[];
  body: OverrideRow[];
  models: ModelDraft[];
  auth?: {
    configured: boolean;
    source?: string;
    type?: "api_key" | "oauth";
    methods: ("api_key" | "oauth")[];
  };
}
export interface ModelConfiguration {
  revision: string;
  providers: ProviderDraft[];
  storage?: { modelsPath: string; authPath: string };
  templates: { id: string; name: string; api: string; url: string }[];
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
    options?: { id: string; label: string }[];
  };
}
export interface ConfigurationSave {
  revision: string;
  providers: ProviderDraft[];
  confirmLogout?: boolean;
  allowCommands?: boolean;
}
