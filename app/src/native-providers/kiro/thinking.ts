import type { NativeThinkingCapabilities, NativeThinkingLevel, NativeThinkingLevelMap } from "../contracts.js";

export class KiroThinkingError extends Error {}
type Profile = { mode: "budget" | "adaptive" | "reasoning"; efforts?: readonly string[] };
// Explicit backend compatibility profiles, not upstream catalog declarations or a
// model-name heuristic. Sources and policy differences: docs/kiro-thinking.md.
const profiles = new Map<string, Profile>();
for (const id of ["claude-sonnet-3.7", "claude-sonnet-4", "claude-opus-4", "claude-opus-4.1", "claude-sonnet-4.5", "claude-haiku-4.5", "claude-opus-4.5", "claude-sonnet-4.8"])
  profiles.set(id, { mode: "budget" });
profiles.set("claude-sonnet-4.6", { mode: "adaptive", efforts: ["low", "medium", "high"] });
profiles.set("claude-opus-4.6", { mode: "adaptive", efforts: ["low", "medium", "high", "max"] });
for (const id of ["claude-opus-4.7", "claude-opus-4.8", "claude-sonnet-5", "claude-sonnet-5.5", "claude-opus-5", "claude-opus-5.5", "claude-fable-5", "claude-mythos-5"])
  profiles.set(id, { mode: "adaptive", efforts: ["low", "medium", "high", "xhigh", "max"] });
for (const id of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"])
  profiles.set(id, { mode: "reasoning", efforts: ["low", "medium", "high", "xhigh", "max"] });
// Catalog default output_config.effort for exact Responses Claude models whose
// thinking.type enum lacks disabled (catalog-metadata-01/02).
const responsesClaudeDefaults = new Map([["claude-sonnet-5.5", "high"], ["claude-opus-5.5", "medium"]]);
export const kiroResponsesClaudeDefaultEffort = (id: string) => responsesClaudeDefaults.get(id);
const budgets = { minimal: 1024, low: 4000, medium: 16000, high: 20000 };
const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export function kiroThinkingCapabilities(id: string): NativeThinkingCapabilities {
  const profile = profiles.get(id);
  if (!profile) return { supported: false };
  const thinkingLevelMap: NativeThinkingLevelMap = { off: "none" };
  for (const level of levels.slice(1)) {
    const budget = budgets[level as keyof typeof budgets];
    thinkingLevelMap[level] = profile.mode === "budget" ? budget === undefined ? null : String(budget)
      : profile.efforts!.includes(level) ? level : null;
  }
  return { supported: true, levels: thinkingLevelMap };
}
export type KiroThinking = { enabled: boolean; providerLevel: string; prefix?: string; additional?: Record<string, unknown> };
export type KiroThinkingModelInput = { id: string; enabledThinkingLevels: readonly NativeThinkingLevel[]; thinkingLevelMap?: NativeThinkingLevelMap };
export function kiroThinkingRequest(model: KiroThinkingModelInput, options: { reasoning?: unknown; thinkingBudgets?: unknown }): KiroThinking | undefined {
  const profile = profiles.get(model.id), requested = options.reasoning;
  // catalog-metadata-01: Sonnet 5.5 lacks disabled in thinking.type.enum, so
  // official KAS puc/EEt omit type entirely; output_config.effort defaults to high.
  // This exact compatibility profile is not a dynamic schema resolver for all models.
  // catalog-metadata-02: Opus 5.5 has the same adaptive-only shape, default medium.
  const responsesClaudeDefault = kiroResponsesClaudeDefaultEffort(model.id), responsesClaude = responsesClaudeDefault !== undefined;
  let overrides: Record<string, unknown> = {};
  if (options.thinkingBudgets !== undefined) {
    if (!options.thinkingBudgets || typeof options.thinkingBudgets !== "object" || Array.isArray(options.thinkingBudgets))
      throw new KiroThinkingError("Kiro 思考预算必须是有效的等级预算对象。");
    overrides = options.thinkingBudgets as Record<string, unknown>;
    for (const [level, value] of Object.entries(overrides)) {
      if (!Object.hasOwn(budgets, level) || typeof value !== "number" || !Number.isSafeInteger(value) || value < 1024 || value > 24576)
        throw new KiroThinkingError("Kiro 兼容思考预算必须是 1024 至 24576 的整数，且仅支持 minimal/low/medium/high。");
    }
  }
  if (requested === undefined) {
    // Agent initial/default off also arrives as own undefined. Accept that SDK
    // representation, but report the actual effort; this does not disable thinking.
    if (responsesClaude) {
      if (Object.keys(overrides).length) throw new KiroThinkingError("当前 Kiro 模型使用 effort 等级，不支持 token 预算覆盖。");
      return { enabled: true, providerLevel: responsesClaudeDefault!, additional: { output_config: { effort: responsesClaudeDefault } } };
    }
    return profile?.mode === "reasoning" && Object.hasOwn(options, "reasoning")
      ? { enabled: false, providerLevel: "none", additional: { reasoning: { effort: "none" } } } : undefined;
  }
  if (typeof requested !== "string" || !levels.slice(1).some(level => level === requested))
    throw new KiroThinkingError("Kiro 思考等级无效；不会回退成高等级或忽略配置。");
  const level = requested as Exclude<typeof levels[number], "off">;
  if (!model.enabledThinkingLevels.includes(level))
    throw new KiroThinkingError("当前 Kiro 模型未启用该思考等级，请检查模型能力与等级配置。");
  const mapped = model.thinkingLevelMap?.[level];
  // Unknown IDs are never auto-enabled. Explicit user model capability overrides
  // may opt in to the budget/tag path, without inventing native effort support.
  if (!profile || profile.mode === "budget") {
    if (!Object.hasOwn(budgets, level)) throw new KiroThinkingError("Kiro 预算模式不支持该思考等级；不会静默降级。");
    const base = mapped === undefined || mapped === level ? budgets[level as keyof typeof budgets]
      : typeof mapped === "string" && /^\d+$/.test(mapped) ? Number(mapped) : NaN;
    const budget = overrides[level] ?? base;
    if (typeof budget !== "number" || !Number.isSafeInteger(budget) || budget < 1024 || budget > 24576)
      throw new KiroThinkingError("Kiro 兼容思考预算必须是 1024 至 24576 的整数。");
    return { enabled: true, providerLevel: String(budget), prefix: `<thinking_mode>enabled</thinking_mode><max_thinking_length>${budget}</max_thinking_length>` };
  }
  if (Object.keys(overrides).length) throw new KiroThinkingError("当前 Kiro 模型使用 effort 等级，不支持 token 预算覆盖；不会将预算伪装成精确生效。");
  const effort = mapped ?? level;
  if (!profile.efforts!.includes(effort)) throw new KiroThinkingError("当前 Kiro 协议配置不支持该 effort；不会静默替换等级。");
  if (responsesClaude) return { enabled: true, providerLevel: effort, additional: { output_config: { effort } } };
  return profile.mode === "reasoning"
    ? { enabled: true, providerLevel: effort, additional: { reasoning: { effort } } }
    : { enabled: true, providerLevel: effort, prefix: `<thinking_mode>adaptive</thinking_mode><thinking_effort>${effort}</thinking_effort>`, additional: { output_config: { effort } } };
}
