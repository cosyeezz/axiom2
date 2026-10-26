import type { Model, ThinkingLevelMap } from "@earendil-works/pi-ai";
import { qoderSites, type QoderRegion } from "./qoder-protocol.js";

// Protocol behavior verified against CLI 1.1.78 (qJo/jwl/sK/mF/G2e/w_l).
// Raw catalog entries, including BYOK secrets, stay in provider memory only.
export const qoderEfforts = ["none", "low", "medium", "high", "xhigh", "max"] as const;
export type QoderEffort = typeof qoderEfforts[number];
export type QoderConfig = Record<string, unknown> & { key: string };
export const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
export const positiveInteger = (value: unknown): number | undefined => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
export function qoderLimit(value: unknown, fallback = 32000): number {
  return positiveInteger(typeof value === "string" && value.trim() ? Number(value) : value) ?? fallback;
}
export function qoderEffort(value: unknown): QoderEffort | undefined {
  if (typeof value !== "string") return;
  const name = value.trim().toLowerCase(), normalized = name === "off" || name === "disabled" ? "none" : name;
  return qoderEfforts.includes(normalized as QoderEffort) ? normalized as QoderEffort : undefined;
}
const effortFields = ["efforts", "reasoning_efforts", "reasoningEfforts", "reasoning_effort_levels", "reasoningEffortLevels", "effort_level", "effortLevel", "effort_levels", "effortLevels", "supported_efforts", "supportedEfforts", "supported_effort_levels", "supportedEffortLevels", "levels"];
function effortList(value: unknown): { efforts: QoderEffort[]; defaultEffort?: QoderEffort } | undefined {
  const object = record(value), keys = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\s]+/) : object ? Object.keys(object) : [];
  const efforts = [...new Set(keys.map(qoderEffort).filter((effort): effort is QoderEffort => !!effort))];
  if (!efforts.length) return;
  const defaultKey = object && Object.keys(object).find(key => qoderEffort(key) && (record(object[key])?.is_default === true || record(object[key])?.isDefault === true));
  return { efforts, ...(defaultKey ? { defaultEffort: qoderEffort(defaultKey) } : {}) };
}
export function qoderReasoning(config: Record<string, unknown>) {
  const thinking = [record(config.thinking_config), record(config.thinkingConfig)].filter((item): item is Record<string, unknown> => !!item);
  const supportsDisabled = config.supports_disabled === true || config.supportsDisabled === true || thinking.some(item => Object.hasOwn(item, "disabled") && item.disabled !== null && item.disabled !== false);
  const candidates = [config, ...thinking.flatMap(item => [item, record(item.enabled), record(item.enabledConfig)]).filter((item): item is Record<string, unknown> => !!item)];
  let capability: ReturnType<typeof effortList>;
  for (const item of candidates) {
    for (const field of effortFields) { capability = effortList(item[field]); if (capability) break; }
    if (capability) break;
  }
  // Some remote model catalogs expose the same table under this name.
  capability ??= effortList(config.available_reasoning_effort ?? config.availableReasoningEffort);
  const efforts = capability?.efforts;
  const rawDefault = qoderEffort(config.default_effort ?? config.defaultEffort);
  const defaultEffort = capability?.defaultEffort ?? (rawDefault && (efforts?.includes(rawDefault) || rawDefault === "none" && supportsDisabled) ? rawDefault : undefined);
  return { efforts, supportsDisabled, defaultEffort };
}
export function qoderContext(config: Record<string, unknown>) {
  const windows: number[] = [];
  let defaultWindow: number | undefined;
  for (const table of [record(config.available_context_tokens ?? config.availableContextTokens), record(config.context_config ?? config.contextConfig)]) {
    if (!table) continue;
    for (const raw of Object.values(table)) {
      const item = record(raw), tokens = positiveInteger(item?.token_count);
      if (!tokens) continue;
      if (!windows.includes(tokens)) windows.push(tokens);
      if (item?.is_default === true || item?.is_default === 1 || item?.is_default === "1") defaultWindow = tokens;
    }
    if (windows.length) break;
  }
  if (!windows.length) {
    const values = config.available_context_windows ?? config.availableContextWindows;
    if (Array.isArray(values)) for (const item of values) { const tokens = positiveInteger(item); if (tokens && !windows.includes(tokens)) windows.push(tokens); }
  }
  windows.sort((a, b) => a - b);
  const declared = positiveInteger(config.default_context_window ?? config.defaultContextWindow);
  defaultWindow ??= declared && (!windows.length || windows.includes(declared)) ? declared : undefined;
  return { windows, defaultWindow };
}
export function qoderSupportsContext(config: Record<string, unknown>, value: unknown): value is number {
  const tokens = positiveInteger(value);
  if (!tokens) return false;
  const { windows } = qoderContext(config), max = positiveInteger(config.max_input_tokens ?? config.maxInputTokens);
  return windows.length ? windows.includes(tokens) : max === undefined || tokens <= max;
}
export interface QoderFunctionSwitch { key: string; type: string; options: Record<string, { is_default?: true }> }
export function qoderFunctionSwitches(config: Record<string, unknown>): QoderFunctionSwitch[] {
  const items = config.function_switches ?? config.feature_switches;
  if (!Array.isArray(items)) return [];
  const result: QoderFunctionSwitch[] = [];
  for (const raw of items) {
    const item = record(raw), options = record(item?.options);
    if (typeof item?.key !== "string" || !item.key || typeof item.type !== "string" || !item.type || !options) continue;
    const entries = Object.entries(options).filter(([, option]) => !!record(option)).map(([key, option]) => [key, record(option)?.is_default === true ? { is_default: true as const } : {}] as const);
    if (entries.length) result.push({ key: item.key, type: item.type, options: Object.fromEntries(entries) });
  }
  return result;
}
export function qoderFeatureSelections(config: Record<string, unknown>, selections: unknown): Record<string, string> | undefined {
  const requested = record(selections);
  if (!requested) return;
  const result: [string, string][] = [];
  for (const item of qoderFunctionSwitches(config)) {
    const value = requested[item.key];
    const selected = typeof value === "string" && Object.hasOwn(item.options, value) ? value : Object.keys(item.options).find(key => item.options[key].is_default === true);
    if (selected !== undefined) result.push([item.key, selected]);
  }
  return result.length ? Object.fromEntries(result) : undefined;
}
export function normalizeQoderConfig(value: unknown): QoderConfig | undefined {
  const config = record(value);
  if (!config || config.enable === false || config.enable === 0) return;
  const key = config.key ?? config.model_key;
  if (typeof key !== "string" || !key.trim()) return;
  const reasoning = qoderReasoning(config), context = qoderContext(config);
  return { ...config, key, display_name: typeof config.display_name === "string" && config.display_name ? config.display_name : typeof config.name === "string" && config.name ? config.name : key,
    ...(reasoning.efforts ? { efforts: reasoning.efforts } : {}), ...(reasoning.supportsDisabled ? { supports_disabled: true } : {}),
    ...(reasoning.defaultEffort ? { default_effort: reasoning.defaultEffort } : {}),
    ...(context.windows.length ? { available_context_windows: context.windows } : {}), ...(context.defaultWindow ? { default_context_window: context.defaultWindow } : {}),
    max_output_tokens: qoderLimit(config.max_output_tokens), source: typeof config.source === "string" ? config.source : "system" };
}
export function qoderDescriptor(region: QoderRegion, config: QoderConfig): Model<"openai-completions"> {
  const { efforts, supportsDisabled } = qoderReasoning(config), { defaultWindow } = qoderContext(config);
  const reasoning = !!config.is_reasoning || !!efforts?.some(value => value !== "none");
  const legacy = !efforts && !supportsDisabled;
  const allowed = efforts ? [...efforts, ...(supportsDisabled ? ["none" as const] : [])] : legacy ? [...qoderEfforts] : ["none"];
  const thinkingLevelMap: ThinkingLevelMap = { off: allowed.includes("none") ? "none" : null, minimal: null };
  for (const effort of qoderEfforts) if (effort !== "none") thinkingLevelMap[effort] = allowed.includes(effort) ? effort : null;
  return {
    id: config.key, name: String(config.display_name ?? config.key), provider: qoderSites[region].id, api: "openai-completions", baseUrl: qoderSites[region].device,
    reasoning, thinkingLevelMap, input: config.is_vl ? ["text", "image"] : ["text"],
    contextWindow: defaultWindow ?? qoderLimit(config.max_input_tokens, 200000), maxTokens: qoderLimit(config.max_output_tokens),
    // Unknown account credit multipliers must never be interpreted as token prices.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: true, supportsUsageInStreaming: true, maxTokensField: "max_tokens", supportsStrictMode: false },
  };
}
