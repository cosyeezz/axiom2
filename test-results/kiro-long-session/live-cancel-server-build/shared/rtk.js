export const rtkLevels = ["conservative", "balanced", "aggressive"];
export const defaultRtkSettings = { enabled: false, level: "balanced", subagents: true };
export const rtkPolicies = {
    conservative: { label: "保守", minimum: 2048, saving: 0.2, description: "测试与检查；至少 2 KiB，净缩减至少 20%。" },
    balanced: { label: "均衡", minimum: 1024, saving: 0.1, description: "增加 Git 状态和文件列表；至少 1 KiB，净缩减至少 10%。" },
    aggressive: { label: "强力", minimum: 512, saving: 0.05, description: "增加搜索结果和 Git diff；至少 512 B，净缩减至少 5%。可能省略匹配项和补丁细节。" },
};
export const rtkReasons = {
    filtered: "已缩减", unsupported: "命令或格式不支持", small: "输出低于门槛", error: "原工具出错", truncated: "原输出已截断",
    nested: "嵌套工具调用", contract: "非标准文本结果", missing: "程序不可用", cancelled: "已取消", failed: "过滤失败或超时",
    unchanged: "净缩减不足", storage: "原文保存失败",
};
export const emptyRtkStats = { days: 7, count: 0, filtered: 0, inputBytes: 0, outputBytes: 0, durationMs: 0, reasons: [], recent: [] };
export const emptyRtkState = { revision: "", settings: defaultRtkSettings, platform: "", supported: false };
//# sourceMappingURL=rtk.js.map