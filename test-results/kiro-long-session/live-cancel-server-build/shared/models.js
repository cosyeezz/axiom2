export const reasoningLevels = [
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
];
export const modelApis = [
    "openai-completions",
    "openai-responses",
    "anthropic-messages",
    "google-generative-ai",
];
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
];
export const bodyOverrideType = (key) => samplingKeys.includes(key) ? "number" : "string";
export const validBodyOverrideKey = (key) => !!key && key.length <= 100 && !/[\x00-\x20\x7f]/.test(key) &&
    !["__proto__", "prototype", "constructor"].includes(key);
export const editableBodyOverride = (key, value) => validBodyOverrideKey(key) &&
    ((typeof value === "string" && value.length <= 8192) || (typeof value === "number" && Number.isFinite(value)));
export const modelCostKeys = ["input", "output", "cacheRead", "cacheWrite"];
export const emptyModelPricing = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
export function validModelPricing(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    const prices = value;
    return modelCostKeys.every(key => typeof prices[key] === "number" && Number.isFinite(prices[key]) && prices[key] >= 0);
}
// Preserve an existing configuration's identity when new rows share its upstream ID.
export function assignModelConfigIds(models) {
    const owners = new Map();
    const reserved = new Set(models.map(model => model.configId ?? model.id));
    for (const model of models) {
        const identity = model.configId ?? model.id, previous = owners.get(identity);
        if (!previous || (model.configId !== undefined && previous.configId === undefined) ||
            (model.configId === undefined && previous.configId === undefined && model.originalId === identity && previous.originalId !== identity))
            owners.set(identity, model);
    }
    return models.map(model => {
        if (model.configId !== undefined || owners.get(model.id) === model)
            return model;
        let configId = model.originalId;
        if (!configId || reserved.has(configId)) {
            do {
                configId = `axiom-model-${crypto.randomUUID()}`;
            } while (reserved.has(configId));
        }
        reserved.add(configId);
        return { ...model, configId };
    });
}
//# sourceMappingURL=models.js.map