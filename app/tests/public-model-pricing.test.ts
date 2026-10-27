import assert from "node:assert/strict";
import { test } from "node:test";
import { publicModelPrice, publicModelPrices } from "../src/server/public-model-pricing.js";
import { usageCost } from "../src/server/usage-cost.js";
import { costAmount, sumCosts } from "../src/shared/costs.js";
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import { kiroRequestUsage, kiroSummaryUsage } from "../src/server/providers/kiro-usage.js";

const unpriced = { input: 1_000_000, output: 100_000, cacheRead: 2_000_000, cacheWrite: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);

test("public references are bounded, exact-ID, source-dated USD rates", () => {
  const ids = new Set<string>();
  for (const row of publicModelPrices) {
    assert.match(row.checked, /^\d{4}-\d{2}-\d{2}$/); assert.match(row.source, /^https:\/\//);
    for (const id of row.models) { assert.ok(!ids.has(id), id); ids.add(id); }
    for (const rate of Object.values(row.prices)) assert.ok(Number.isFinite(rate) && rate >= 0);
  }
  assert.equal(publicModelPrice("GLM-5.3")?.prices.input, 1.4);
  assert.equal(publicModelPrice("z-ai/glm-5.3")?.prices.input, 1.4);
  for (const id of ["gm5.3", "glm-5.3-fast", "glm-5.30", "glm-5.3-free", "arbitrary/glm-5.3", "axiom-copy-123", "deepseek-chat"]) assert.equal(publicModelPrice(id), undefined);
});

test("unpriced GLM and DeepSeek have explicit reference estimates including cache costs", () => {
  const glm = usageCost(unpriced, "glm-5.3");
  near(glm.knownCost, 1.4 + .44 + .52); assert.equal(glm.unknownCost, 0); assert.equal(glm.unknownParts, 0);
  assert.equal(glm.estimatedRecords, 1); assert.equal(glm.estimatedCost, glm.knownCost);
  assert.match(costAmount(glm), /含估算/); assert.match(glm.estimateSources![0], /docs.z.ai/);
  const deepseek = usageCost(unpriced, "deepseek-v4.1-flash-1017");
  near(deepseek.knownCost, .3 + .12 + .012); assert.match(deepseek.estimateSources![0], /峰时/);
  near(sumCosts([glm, deepseek]).estimatedCost!, glm.knownCost + deepseek.knownCost);
  assert.equal(sumCosts([glm, deepseek]).estimatedRecords, 2);
});

test("recorded amounts always win, while unmatched, incomplete and failed-empty usage remain unknown", () => {
  const priced = usageCost({ ...unpriced, cost: { total: .123 } }, "glm-5.3");
  assert.equal(priced.knownCost, .123); assert.equal(priced.estimatedRecords, undefined);
  assert.equal(usageCost(unpriced, "private-model").unknownCost, 1);
  assert.equal(usageCost(unpriced).unknownCost, 1, "never infer a tool model");
  assert.equal(usageCost({ input: 100, output: 10 }, "glm-5.3").unknownCost, 1);
  assert.equal(usageCost({ ...unpriced, input: NaN }, "glm-5.3").unknownCost, 1);
  assert.equal(usageCost({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } }, "glm-5.3").unknownCost, 1);
  assert.equal(usageCost({ ...unpriced, axiomUsageUnknown: true }, "glm-5.3").unknownTokens, 1);
  assert.equal(usageCost({ ...unpriced, cacheWrite: 1 }, "glm-5.3").unknownCost, 1, "missing cache-write rates are not free");
  assert.equal(usageCost({ ...unpriced, cacheWrite: 1 }, "claude-sonnet-4-6").unknownCost, 1, "unknown cache TTL is not guessed");
  const total = sumCosts([priced, usageCost(unpriced, "glm-5.3"), usageCost(null)]);
  assert.equal(total.unknownCost, 1); near(total.estimatedCost!, 2.36);
  assert.equal(costAmount(total), "$2.4830（含估算） + 未知");
});

test("Kiro request and summary prices remain their request-time snapshot when model attribution is added", () => {
  const model: Model<Api> = { api: "kiro-chat", provider: "kiro", id: "claude-sonnet-4.6", name: "PRICE_COLLISION_FIXTURE",
    baseUrl: "https://q.us-east-1.amazonaws.com", reasoning: false, input: ["text"], contextWindow: 8192, maxTokens: 1024,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  assert.ok(publicModelPrice(model.id), "the exact ID must collide with a real public reference, not bypass the fallback");
  for (const configured of [false, true]) {
    const measurement = kiroRequestUsage({ ...model, cost: configured
      ? { input: 2, output: 8, cacheRead: .5, cacheWrite: 3 } : model.cost });
    assert.equal(measurement.accept({ uncachedInputTokens: 10, outputTokens: 3, cacheReadInputTokens: 2,
      cacheWriteInputTokens: 0, totalTokens: 15 }), true);
    const physical: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
      content: [{ type: "text", text: "SYNTHETIC_SUMMARY" }], stopReason: "stop", timestamp: 1, usage: measurement.usage };
    for (const usage of [measurement.usage, kiroSummaryUsage(measurement.usage, [physical])]) {
      const saved = structuredClone(usage), original = usageCost(usage), attributed = usageCost(usage, model.id);
      assert.equal(usage.axiomKiro.state, "complete");
      assert.equal(usage.axiomKiro.pricing.kind, configured ? "configured-estimate" : "unknown");
      assert.deepEqual(attributed, original, `${usage.axiomKiro.scope}: model attribution cannot reprice Kiro history`);
      assert.equal(attributed.unknownTokens, 0);
      assert.equal(attributed.unknownCost, configured ? 0 : 1);
      assert.equal(attributed.estimatedRecords, undefined, "no later public-price estimate is introduced");
      near(attributed.knownCost, configured ? .000045 : 0);
      assert.deepEqual(usage, saved, "historical request and summary provenance is not mutated");
    }
  }
});

test("Gemini context tier includes cached input and respects the boundary", () => {
  const boundary = { input: 100_000, output: 1000, cacheRead: 100_000, cacheWrite: 0 };
  near(usageCost(boundary, "gemini-2.5-pro").knownCost, .125 + .01 + .0125);
  near(usageCost({ ...boundary, cacheRead: 100_001 }, "gemini-2.5-pro").knownCost, .25 + .015 + .02500025);
});
