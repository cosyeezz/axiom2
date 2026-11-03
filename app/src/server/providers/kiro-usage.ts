import { calculateCost, type Api, type AssistantMessage, type Model, type Usage } from "@earendil-works/pi-ai";
import { kiroUsageInfo, validKiroPriceSnapshot, type KiroPriceSnapshot, type KiroRequestUsageInfo, type KiroSummaryUsageInfo } from "../../shared/kiro-usage.js";
import { readKiroTokenUsage } from "../../native-providers/kiro/usage.js";
import type { NativeTokenUsage } from "../../native-providers/contracts.js";

const parts = ["input", "output", "cacheRead", "cacheWrite"] as const;
const emptyCost = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
type KiroUsage = Usage & { axiomKiro: KiroRequestUsageInfo | KiroSummaryUsageInfo };

/** Capture rates, including tiers, synchronously at each physical stream invocation. */
export function kiroRequestUsage(model: Model<Api>) {
  const rates: KiroPriceSnapshot | undefined = validKiroPriceSnapshot(model.cost)
    ? { input: model.cost.input, output: model.cost.output, cacheRead: model.cost.cacheRead, cacheWrite: model.cost.cacheWrite,
      ...(model.cost.tiers ? { tiers: model.cost.tiers.map(tier => ({ inputTokensAbove: tier.inputTokensAbove,
        input: tier.input, output: tier.output, cacheRead: tier.cacheRead, cacheWrite: tier.cacheWrite })) } : {}) }
    : undefined;
  let pricing: KiroRequestUsageInfo["pricing"] = { kind: "unknown", ...(rates ? { rates } : {}) };
  const info = (state: KiroRequestUsageInfo["state"]): KiroRequestUsageInfo =>
    ({ version: 1, scope: "request", state, pricing: structuredClone(pricing) });
  const usage: KiroUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: emptyCost(), axiomKiro: info("unknown") };
  function acceptNative(snapshot: NativeTokenUsage | undefined): boolean {
    usage.axiomKiro = info("partial");
    if (!snapshot) return false;
    const candidate: Usage = { ...snapshot, cost: emptyCost() };
    pricing = { kind: "unknown", ...(rates ? { rates } : {}) };
    if (rates) {
      const inputTokens = snapshot.input + snapshot.cacheRead + snapshot.cacheWrite;
      let selected = rates, threshold = -1;
      for (const tier of rates.tiers ?? []) if (inputTokens > tier.inputTokensAbove && tier.inputTokensAbove > threshold) {
        selected = tier; threshold = tier.inputTokensAbove;
      }
      if (parts.some(key => selected[key] > 0)) {
        calculateCost({ ...model, cost: rates }, candidate);
        if (Object.values(candidate.cost).every(value => Number.isFinite(value) && value >= 0))
          pricing = { kind: "configured-estimate", rates, ...(threshold >= 0 ? { inputTokensAbove: threshold } : {}) };
        else candidate.cost = emptyCost(); // An overflowing estimate is unknown, never Infinity/free billing.
      }
    }
    // Commit atomically only after every service counter and total was validated.
    Object.assign(usage, candidate, { axiomKiro: info("complete") });
    return true;
  }
  return { usage, acceptNative, accept(value: unknown): boolean {
    // Invalidate BEFORE parsing, including invalid snapshots that throw.
    usage.axiomKiro = info("partial");
    return acceptNative(readKiroTokenUsage(value));
  } };
}

/** Native summary candidates: Pi also rejects length/tool calls; cancellation is never adopted. */
export function kiroSummarySucceeded(message: AssistantMessage): boolean {
  return message.stopReason !== "error" && message.stopReason !== "aborted" && message.stopReason !== "length" &&
    !message.content.some(block => block.type === "toolCall");
}

/** Restore metadata dropped by SDK combineUsage, without repricing a combined request. */
export function kiroSummaryUsage(usage: Usage | undefined, physical: readonly AssistantMessage[]): KiroUsage {
  const requests = physical.filter(kiroSummarySucceeded).map(message => {
    const info = kiroUsageInfo(message.usage);
    return info?.scope === "request" ? structuredClone(info)
      : { version: 1 as const, scope: "request" as const, state: "unknown" as const, pricing: { kind: "unknown" as const } };
  });
  const state = requests.length && requests.every(info => info.state === "complete") ? "complete"
    : requests.every(info => info.state === "unknown") ? "unknown" : "partial";
  const priced = state === "complete" && requests.every(info => info.pricing.kind === "configured-estimate");
  return { ...(usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: emptyCost() }),
    cost: { ...(usage?.cost ?? emptyCost()) },
    axiomKiro: { version: 1, scope: "summary", state, pricing: { kind: priced ? "configured-estimate" : "unknown" }, requests } };
}

export function kiroCompressionProjection(usage: KiroUsage) {
  const totals = kiroUsageInfo(usage), known = totals?.state === "complete" && totals.pricing.kind === "configured-estimate";
  return { input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite,
    total: usage.totalTokens, cost: known ? usage.cost.total : null, costParts: { ...usage.cost }, axiomKiro: usage.axiomKiro };
}
