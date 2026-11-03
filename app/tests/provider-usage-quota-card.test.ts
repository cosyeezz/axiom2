import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelAccountUsage, type ModelAccountUsageState } from "../src/client/models/ModelAccountUsage.js";
import type { ModelAccount } from "../src/shared/model-accounts.js";
import type { ProviderUsage } from "../src/shared/provider-usage.js";

function render(usage: ProviderUsage) {
  const account: ModelAccount = { id: "fixture", providerId: usage.providerId, type: "oauth", label: "Fixture", region: "", active: true, legacy: false, createdAt: 1 };
  const state: ModelAccountUsageState = { usage, pricing: [], busy: false, sampleRevision: 0, connected: true, enabled: true, refresh() {} };
  return renderToStaticMarkup(createElement(ModelAccountUsage, { account, state, copy() {} }));
}

test("generic account card renders fractional quota, remaining progress and subscription/package expiry", () => {
  const html = render({ providerId: "qoder-cn", status: "ready", accountStatus: { state: "active", checkedAt: 1 },
    account: { plan: "Pro", subscriptionExpiresAt: 1900000000000 }, metrics: [
      { id: "user", label: "套餐额度", kind: "quota", used: 12.5, limit: 100, unit: "credits" },
      { id: "pack", label: "专属资源包", kind: "quota", used: 0, limit: 10, unit: "credits", expiresAt: 1900000000000 },
    ] });
  assert.match(html, /剩余 87.5 credits/); assert.match(html, /已用 12.5 \/ 100 credits/);
  assert.match(html, /value="87.5"/); assert.match(html, /订阅有效至/); assert.match(html, /专属资源包 到期/);
  assert.doesNotMatch(html, /额度暂不可用/);
});

test("edition-only cards explain unavailable quota; inactive cards hide numbers", () => {
  const html = render({ providerId: "codebuddy-cn", status: "ready", accountStatus: { state: "active", checkedAt: 1 },
    account: { plan: "个人版" }, metrics: [], refreshable: false, message: "官方 CLI 未提供额度查询接口，仅显示账号版本。" });
  assert.match(html, /暂不支持查询额度/); assert.match(html, /title="官方 CLI 未提供额度查询接口/);
  assert.doesNotMatch(html, /<progress/);
  const blocked = render({ providerId: "qoder-cn", status: "unavailable", accountStatus: { state: "unknown", checkedAt: 1 },
    metrics: [{ id: "user", label: "套餐额度", kind: "quota", used: 12.5, limit: 100 }] });
  assert.doesNotMatch(blocked, /12.5/); assert.match(blocked, /额度暂不可用/);
});
