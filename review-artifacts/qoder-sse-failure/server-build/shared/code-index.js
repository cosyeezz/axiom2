export const defaultIndexSettings = {
    mode: "off", automaticMaintenance: true, backgroundSelection: null,
    locateBudget: { workMs: 60_000, maxModelRequests: 4, maxInputTokens: 48_000, maxOutputTokens: 8_000 },
    jobBudget: { workMs: 120_000, maxModelRequests: 3, maxInputTokens: 48_000, maxOutputTokens: 8_000 },
};
export const indexBrowseScope = (viewId) => `index-view:${viewId}`;
export const indexProgressLabels = {
    queued: "等待索引资源", querying: "检索已有索引", reading: "读取证据", analyzing: "分析关系",
    validating: "校验提案", committing: "提交索引", completed: "定位完成", failed: "定位失败",
    cancelled: "定位已停止", interrupted: "定位中断",
};
export function indexProgressSummary(progress) {
    return `${indexProgressLabels[progress.phase]} · ${progress.modelRequestsStarted}次模型请求 · ${progress.evidencePages}页证据`;
}
//# sourceMappingURL=code-index.js.map