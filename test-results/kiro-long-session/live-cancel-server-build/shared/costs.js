export const costCategories = ["main", "subagent", "compression", "tool", "other"];
export const costLabels = {
    main: "主 Agent", subagent: "子 Agent", compression: "压缩", tool: "工具内部调用", other: "其他模型调用",
};
export const costParts = ["input", "output", "cacheRead", "cacheWrite"];
export const costPartLabels = {
    input: "输入", output: "输出", cacheRead: "缓存读取", cacheWrite: "缓存写入",
};
export const costsScope = (scope) => `costs:${scope.workspaceId}:${scope.sessionId}`;
export function emptyCostTotals() {
    return { records: 0, knownCost: 0, unknownCost: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        unknownTokens: 0, parts: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, unknownParts: 0 };
}
export function sumCosts(rows) {
    const total = emptyCostTotals();
    for (const row of rows) {
        total.records += row.records;
        total.knownCost += row.knownCost;
        total.unknownCost += row.unknownCost;
        total.unknownTokens += row.unknownTokens;
        total.unknownParts += row.unknownParts;
        for (const part of costParts) {
            total.tokens[part] += row.tokens[part];
            total.parts[part] += row.parts[part];
        }
    }
    return total;
}
export function costTokens(total) {
    if (!total.records)
        return "—";
    const known = costParts.reduce((sum, part) => sum + total.tokens[part], 0);
    if (total.unknownTokens && !known)
        return "未知";
    return `${known.toLocaleString("zh-CN")}${total.unknownTokens ? " + 未知" : ""}`;
}
export function costAmount(total) {
    if (!total.records)
        return "—";
    if (total.unknownCost && !total.knownCost)
        return "未知";
    return `$${total.knownCost.toFixed(4)}${total.unknownCost ? " + 未知" : ""}`;
}
//# sourceMappingURL=costs.js.map