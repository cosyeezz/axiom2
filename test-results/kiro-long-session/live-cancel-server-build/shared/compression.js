export const defaultAutoCompression = { enabled: true, tokens: 100_000, percent: 80 };
export function autoCompressionThreshold(settings, contextWindow) {
    return contextWindow != null && Number.isFinite(contextWindow) && contextWindow > 0
        ? Math.min(settings.tokens, Math.ceil(contextWindow * settings.percent / 100))
        : settings.tokens;
}
export const compressionPreferencesScope = "compression-preferences";
export const emptyCompressionPreferences = { selection: null, auto: defaultAutoCompression };
export const compressionScope = (s) => `compression:${s.workspaceId}:${s.sessionId}`;
export const compressionLabels = {
    running: "进行中",
    completed: "已完成",
    cancelled: "已取消",
    failed: "失败",
    interrupted: "已中断",
};
//# sourceMappingURL=compression.js.map