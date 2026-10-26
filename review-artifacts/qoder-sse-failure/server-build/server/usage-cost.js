import { costParts, emptyCostTotals } from "../shared/costs.js";
const number = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
/** Recorded prices only: never reprice old requests with today's model configuration. */
export function usageCost(value) {
    const total = emptyCostTotals();
    total.records = 1;
    const usage = value && typeof value === "object" ? value : {};
    const cost = usage.cost && typeof usage.cost === "object" ? usage.cost : {};
    for (const key of costParts) {
        if (number(usage[key]))
            total.tokens[key] = usage[key];
        if (number(cost[key]))
            total.parts[key] = cost[key];
    }
    if (!costParts.every((key) => number(usage[key])))
        total.unknownTokens = 1;
    // Pi uses zero rates for missing prices. Zero cannot establish free billing.
    if (number(cost.total) && cost.total > 0)
        total.knownCost = cost.total;
    else
        total.unknownCost = 1;
    if (total.unknownCost || !costParts.every((key) => number(cost[key])) ||
        Math.abs(costParts.reduce((sum, key) => sum + total.parts[key], 0) - total.knownCost) > 1e-8) {
        total.unknownParts = 1;
        for (const key of costParts)
            total.parts[key] = 0;
    }
    return total;
}
//# sourceMappingURL=usage-cost.js.map