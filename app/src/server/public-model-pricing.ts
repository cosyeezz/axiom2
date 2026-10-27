import type { CostPart } from "../shared/costs.js";

export interface PublicModelPrice {
  /** Exact wire IDs only. No fuzzy name matching or stripping dates/speed suffixes. */
  models: readonly string[];
  prices: Partial<Record<CostPart, number>>;
  source: string;
  checked: string;
  /** Optional standard long-context tier, selected using input + cache tokens. */
  tiers?: readonly { above: number; prices: Partial<Record<CostPart, number>> }[];
}

/** USD / million tokens. A reference estimate, not reseller pricing or a subscription bill.
 * Update rates, exact IDs, source and verification date together. Missing cache prices
 * intentionally remain unknown rather than silently turning cache tokens into free usage.
 */
export const publicModelPrices: readonly PublicModelPrice[] = [
  {
    models: ["deepseek-flash", "deepseek-v4.1-flash", "deepseek-v4.1-flash-1017", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"],
    prices: { input: .30, output: 1.20, cacheRead: .006 },
    source: "https://api-docs.deepseek.com/quick_start/pricing （原厂峰时参考价，非渠道账单；谷时可能减半）", checked: "2026-10-27",
  },
  {
    models: ["deepseek-v4-pro", "deepseek-v4-pro-0813"],
    prices: { input: 1.32, output: 3.96, cacheRead: .044 },
    source: "https://api-docs.deepseek.com/quick_start/pricing （原厂峰时参考价，非渠道账单；谷时可能减半）", checked: "2026-10-27",
  },
  {
    models: ["glm-5.3"], prices: { input: 1.4, output: 4.4, cacheRead: .26 },
    source: "https://docs.z.ai/guides/overview/pricing （原厂参考价，非渠道或订阅账单）", checked: "2026-10-27",
  },
  {
    models: ["glm-5"], prices: { input: 1, output: 3.2, cacheRead: .2 },
    source: "https://docs.z.ai/guides/overview/pricing （原厂参考价，非渠道或订阅账单）", checked: "2026-10-27",
  },
  {
    models: ["gpt-5.3-codex"], prices: { input: 1.75, output: 14, cacheRead: .175 },
    source: "https://platform.openai.com/docs/pricing （标准 API 参考价，不含服务档位倍率）", checked: "2026-10-27",
  },
  {
    models: ["claude-sonnet-4-6", "claude-sonnet-4.6"], prices: { input: 3, output: 15, cacheRead: .3 },
    source: "https://platform.claude.com/docs/en/about-claude/pricing （原厂参考价；缓存写入期限未知时不估）", checked: "2026-10-27",
  },
  {
    models: ["claude-opus-4-6", "claude-opus-4.6"], prices: { input: 5, output: 25, cacheRead: .5 },
    source: "https://platform.claude.com/docs/en/about-claude/pricing （原厂参考价；缓存写入期限未知时不估）", checked: "2026-10-27",
  },
  {
    models: ["gemini-2.5-flash"], prices: { input: .3, output: 2.5, cacheRead: .03 },
    source: "https://ai.google.dev/gemini-api/docs/pricing （标准文本 API 参考价，不含缓存存储时长费）", checked: "2026-10-27",
  },
  {
    models: ["gemini-2.5-pro"], prices: { input: 1.25, output: 10, cacheRead: .125 },
    tiers: [{ above: 200_000, prices: { input: 2.5, output: 15, cacheRead: .25 } }],
    source: "https://ai.google.dev/gemini-api/docs/pricing （标准文本 API 参考价，不含缓存存储时长费）", checked: "2026-10-27",
  },
];

const namespaces = new Set(["openai", "anthropic", "google", "deepseek", "z-ai"]);
export function publicModelPrice(model: unknown, inputTokens = 0): { prices: PublicModelPrice["prices"]; source: string } | undefined {
  if (typeof model !== "string" || model.length > 160) return;
  let id = model.toLowerCase();
  const slash = id.indexOf("/");
  if (slash >= 0 && namespaces.has(id.slice(0, slash))) id = id.slice(slash + 1);
  const row = publicModelPrices.find(price => price.models.includes(id));
  if (!row) return;
  const tier = row.tiers?.filter(t => inputTokens > t.above).sort((a, b) => b.above - a.above)[0];
  return { prices: { ...row.prices, ...tier?.prices }, source: `${id} · ${row.checked} · ${row.source}` };
}
