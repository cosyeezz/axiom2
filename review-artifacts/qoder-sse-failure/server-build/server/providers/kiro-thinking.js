import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
export class KiroThinkingError extends Error {
}
// Explicit backend compatibility profiles, not upstream catalog declarations or a
// model-name heuristic. Sources and policy differences: docs/kiro-thinking.md.
const profiles = new Map();
for (const id of ["claude-sonnet-3.7", "claude-sonnet-4", "claude-opus-4", "claude-opus-4.1", "claude-sonnet-4.5", "claude-haiku-4.5", "claude-opus-4.5", "claude-sonnet-4.8"])
    profiles.set(id, { mode: "budget" });
profiles.set("claude-sonnet-4.6", { mode: "adaptive", efforts: ["low", "medium", "high"] });
profiles.set("claude-opus-4.6", { mode: "adaptive", efforts: ["low", "medium", "high", "max"] });
for (const id of ["claude-opus-4.7", "claude-opus-4.8", "claude-sonnet-5", "claude-sonnet-5.5", "claude-opus-5", "claude-opus-5.5", "claude-fable-5", "claude-mythos-5"])
    profiles.set(id, { mode: "adaptive", efforts: ["low", "medium", "high", "xhigh", "max"] });
for (const id of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"])
    profiles.set(id, { mode: "reasoning", efforts: ["low", "medium", "high", "xhigh", "max"] });
const budgets = { minimal: 1024, low: 4000, medium: 16000, high: 20000 };
const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
export function kiroThinkingModel(id) {
    const profile = profiles.get(id);
    if (!profile)
        return { reasoning: false };
    const thinkingLevelMap = { off: "none" };
    for (const level of levels.slice(1)) {
        const budget = budgets[level];
        thinkingLevelMap[level] = profile.mode === "budget" ? budget === undefined ? null : String(budget)
            : profile.efforts.includes(level) ? level : null;
    }
    return { reasoning: true, thinkingLevelMap };
}
export function kiroThinkingRequest(model, options) {
    const profile = profiles.get(model.id), requested = options.reasoning;
    let overrides = {};
    if (options.thinkingBudgets !== undefined) {
        if (!options.thinkingBudgets || typeof options.thinkingBudgets !== "object" || Array.isArray(options.thinkingBudgets))
            throw new KiroThinkingError("Kiro 思考预算必须是有效的等级预算对象。");
        overrides = options.thinkingBudgets;
        for (const [level, value] of Object.entries(overrides)) {
            if (!Object.hasOwn(budgets, level) || typeof value !== "number" || !Number.isSafeInteger(value) || value < 1024 || value > 24576)
                throw new KiroThinkingError("Kiro 兼容思考预算必须是 1024 至 24576 的整数，且仅支持 minimal/low/medium/high。");
        }
    }
    if (requested === undefined) {
        // The agent sends an own undefined reasoning property for an explicit off.
        // Do not confuse it with a bare SDK request that asks for service defaults.
        return profile?.mode === "reasoning" && Object.hasOwn(options, "reasoning")
            ? { enabled: false, providerLevel: "none", additional: { reasoning: { effort: "none" } } } : undefined;
    }
    if (typeof requested !== "string" || !levels.slice(1).some(level => level === requested))
        throw new KiroThinkingError("Kiro 思考等级无效；不会回退成高等级或忽略配置。");
    const level = requested;
    if (!getSupportedThinkingLevels(model).includes(level))
        throw new KiroThinkingError("当前 Kiro 模型未启用该思考等级，请检查模型能力与等级配置。");
    const mapped = model.thinkingLevelMap?.[level];
    // Unknown IDs are never auto-enabled. Explicit user model capability overrides
    // may opt in to the budget/tag path, without inventing native effort support.
    if (!profile || profile.mode === "budget") {
        if (!Object.hasOwn(budgets, level))
            throw new KiroThinkingError("Kiro 预算模式不支持该思考等级；不会静默降级。");
        const base = mapped === undefined || mapped === level ? budgets[level]
            : typeof mapped === "string" && /^\d+$/.test(mapped) ? Number(mapped) : NaN;
        const budget = overrides[level] ?? base;
        if (typeof budget !== "number" || !Number.isSafeInteger(budget) || budget < 1024 || budget > 24576)
            throw new KiroThinkingError("Kiro 兼容思考预算必须是 1024 至 24576 的整数。");
        return { enabled: true, providerLevel: String(budget), prefix: `<thinking_mode>enabled</thinking_mode><max_thinking_length>${budget}</max_thinking_length>` };
    }
    if (Object.keys(overrides).length)
        throw new KiroThinkingError("当前 Kiro 模型使用 effort 等级，不支持 token 预算覆盖；不会将预算伪装成精确生效。");
    const effort = mapped ?? level;
    if (!profile.efforts.includes(effort))
        throw new KiroThinkingError("当前 Kiro 协议配置不支持该 effort；不会静默替换等级。");
    return profile.mode === "reasoning"
        ? { enabled: true, providerLevel: effort, additional: { reasoning: { effort } } }
        : { enabled: true, providerLevel: effort, prefix: `<thinking_mode>adaptive</thinking_mode><thinking_effort>${effort}</thinking_effort>`, additional: { output_config: { effort } } };
}
//# sourceMappingURL=kiro-thinking.js.map