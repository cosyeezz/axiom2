import { costParts, emptyCostTotals, type CostTotals } from "../shared/costs.js";
import { hasKiroUsage, kiroUsageInfo } from "../shared/kiro-usage.js";
import { publicModelPrice } from "./public-model-pricing.js";

const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
/** Preserve recorded charges. Only missing prices may use a labelled public reference estimate. */
export function usageCost(value: unknown, model?: unknown): CostTotals {
  const total = emptyCostTotals();
  total.records = 1;
  const usage = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const cost = usage.cost && typeof usage.cost === "object" ? usage.cost as Record<string, unknown> : {};
  for (const key of costParts) {
    if (number(usage[key])) total.tokens[key] = usage[key];
    if (number(cost[key])) total.parts[key] = cost[key];
  }
  const kiro = hasKiroUsage(usage), measurement = kiroUsageInfo(usage);
  const complete = !kiro || measurement?.state === "complete";
  if (usage.axiomUsageUnknown === true || !complete || !costParts.every((key) => number(usage[key]))) total.unknownTokens = 1;
  // Kiro estimates are request-time recorded prices, not a service bill. Complete
  // measured zero is valid, but default all-zero rates cannot establish free usage.
  const priced = !kiro || complete && !total.unknownTokens && measurement?.pricing.kind === "configured-estimate";
  if (priced && number(cost.total) && (kiro || cost.total > 0)) total.knownCost = cost.total;
  else total.unknownCost = 1;
  // Kiro prices belong to the physical request snapshot: a later model ID must
  // not turn unknown Kiro history into a public-price estimate. Other providers
  // retain reference estimates, excluding unknown tokens and empty failures.
  if (!kiro && total.unknownCost && !total.unknownTokens && costParts.some(key => total.tokens[key] > 0)) {
    const price = publicModelPrice(model, total.tokens.input + total.tokens.cacheRead + total.tokens.cacheWrite);
    if (price && costParts.every(key => total.tokens[key] === 0 || number(price.prices[key]))) {
      for (const key of costParts) total.parts[key] = total.tokens[key] * (price.prices[key] ?? 0) / 1_000_000;
      const amount = costParts.reduce((sum, key) => sum + total.parts[key], 0);
      if (Number.isFinite(amount)) {
        total.knownCost = amount;
        total.unknownCost = 0;
        total.estimatedCost = amount;
        total.estimatedRecords = 1;
        total.estimateSources = [price.source];
      }
    }
  }
  if (total.unknownCost || (!total.estimatedRecords && !costParts.every((key) => number(cost[key]))) ||
      Math.abs(costParts.reduce((sum, key) => sum + total.parts[key], 0) - total.knownCost) > 1e-8) {
    total.unknownParts = 1;
    for (const key of costParts) total.parts[key] = 0;
  }
  return total;
}
