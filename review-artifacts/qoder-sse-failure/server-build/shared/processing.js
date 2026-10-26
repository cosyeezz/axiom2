export const processingScope = (workspaceId) => `processing:${workspaceId}`;
export const processingActive = (state) => state === "running" || state === "cancelling";
/** Cancellation and superseded results are explanations, not processing failures. */
export const processingFailed = (state) => state === "failed" || state === "interrupted";
export const processingReasonLabels = { running: "处理状态说明", cancelling: "取消状态说明", completed: "处理结果说明", failed: "处理失败原因", cancelled: "取消原因", interrupted: "中断原因", invalidated: "结果失效原因" };
export const processingOutcomes = { applied: "已生效", not_applied: "未应用", no_match: "无匹配目的", no_evidence: "无有效依据", incomplete: "结果不完整" };
export const processingKinds = { "memory.organize": "记忆整理", "memory.query": "记忆查询", compression: "上下文压缩", "session.title": "标题生成" };
export const processingStates = { running: "进行中", cancelling: "取消中", completed: "成功", failed: "失败", cancelled: "已取消", interrupted: "已中断", invalidated: "结果已失效" };
//# sourceMappingURL=processing.js.map