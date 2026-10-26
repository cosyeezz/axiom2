export const codeBuddyId = "codebuddy-cn";
export const codeBuddyBaseUrl = "https://copilot.tencent.com/v2";
// Protocol fingerprint checked against the official npm CLI 2.173.0 artifact.
export const codeBuddyCliVersion = "2.173.0";
export const codeBuddyHeaders = {
    "User-Agent": `CLI/${codeBuddyCliVersion} CodeBuddy/${codeBuddyCliVersion}`,
    "X-Product": "SaaS",
    "X-IDE-Type": "CLI",
    "X-IDE-Name": "CLI",
    "X-IDE-Version": codeBuddyCliVersion,
    "x-requested-with": "XMLHttpRequest",
    "x-codebuddy-request": "1",
};
// Static snapshot from 9Router registry/codebuddy-cn.js, capabilities.js and thinkingLevels.js at
// 87a74e1bda3677193c6f71a7e2100c90311f0689. See codebuddy-cn.ts for the MIT notice.
// Conservative output/image limits for matching IDs are checked against CLI 2.173.0
// product.internal.json. Model IDs/other effort sets remain the 9Router snapshot;
// shipped product defaults can differ from account-specific remote configuration.
// No model-discovery API is implemented. Account availability may differ.
// Models without published supportedEfforts use the reference's OpenAI defaults.
const defaultEfforts = ["minimal", "low", "medium", "high", "xhigh"];
const catalog = [
    ["glm-5.2", "GLM-5.2", 1000000, 64000, true, ["high", "xhigh"]],
    ["glm-5.1", "GLM-5.1", 200000, 48000, false, defaultEfforts],
    ["minimax-m3", "MiniMax-M3", 512000, 524288, false, defaultEfforts],
    ["hy3", "Hy3", 192000, 64000, false, ["low", "high"]],
    ["hy4-preview", "Hy4-Preview", 1000000, 64000, false, ["high"]],
    ["glm-5.3", "GLM-5.3", 1000000, 64000, true, ["low", "high", "max"]],
    ["glm-5.3-flash", "GLM-5.3-Flash", 1000000, 131072, true, ["low", "high", "max"]],
    ["kimi-k3-1", "Kimi-K3", 1000000, 1048576, false, defaultEfforts],
    ["kimi-k2.8-preview", "Kimi-K2.8-Preview", 300000, 64000, true, ["low", "high", "max"]],
    ["deepseek-v4-pro", "DeepSeek-V4-Pro", 1000000, 128000, true, ["low", "high", "xhigh"]],
    ["deepseek-v4.1-flash", "DeepSeek-V4.1-Flash", 1000000, 128000, true, ["low", "high", "max"]],
];
export function codeBuddyModels() {
    return catalog.map(([id, name, contextWindow, maxTokens, canDisable, efforts]) => ({
        id, name, provider: codeBuddyId, api: "openai-completions", baseUrl: codeBuddyBaseUrl,
        headers: { ...codeBuddyHeaders },
        input: id === "glm-5.2" || id === "glm-5.1" ? ["text"] : ["text", "image"], reasoning: true,
        contextWindow, maxTokens,
        // No verified per-token pricing. Zero is the runtime's unset-cost baseline, not a free-tier claim.
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        thinkingLevelMap: {
            off: canDisable ? "none" : null,
            minimal: null, low: null, medium: null, high: null, xhigh: null, max: null,
            ...Object.fromEntries(efforts.map(level => [level, level])),
        },
        compat: {
            supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: true,
            supportsLongCacheRetention: false, maxTokensField: "max_tokens", thinkingFormat: "openai",
        },
    }));
}
//# sourceMappingURL=codebuddy-models.js.map