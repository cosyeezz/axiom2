import type { OAuthCredential } from "@earendil-works/pi-ai";
import { fetchKiroQuota, KiroQuotaError, type KiroQuota, type KiroQuotaBucket } from "../../native-providers/kiro/quota.js";
import type { ProviderUsage, ProviderUsageMetric } from "../../shared/provider-usage.js";

const labels: Record<KiroQuotaBucket["kind"], string> = { base: "套餐额度", "free-trial": "试用额度", bonus: "奖励额度", overage: "超额用量" };
function metric(bucket: KiroQuotaBucket): ProviderUsageMetric {
  return { id: bucket.id, kind: "quota", label: bucket.kind === "bonus" && bucket.name ? bucket.name : labels[bucket.kind],
    used: bucket.used, limit: bucket.limit, ...(bucket.unit ? { unit: bucket.unit } : {}),
    ...(bucket.resetsAt ? { resetsAt: bucket.resetsAt } : {}), ...(bucket.expiresAt ? { expiresAt: bucket.expiresAt } : {}) };
}
export function kiroQuotaUsage(providerId: string, quota: KiroQuota, now = Date.now()): ProviderUsage {
  const account = { ...(quota.email ? { email: quota.email } : {}), ...(quota.plan ? { plan: quota.plan } : {}) };
  return { providerId, status: "ready", metrics: quota.buckets.map(metric), accountStatus: { state: "active", checkedAt: now }, updatedAt: now,
    ...(Object.keys(account).length ? { account } : {}),
    ...(quota.buckets.length ? {} : { message: "Kiro 未返回额度明细。" }) };
}
const messages: Record<KiroQuotaError["kind"], string> = {
  unauthorized: "Kiro 未接受当前授权（HTTP 401），已停止后续查询；请重新登录。",
  forbidden: "Kiro 额度接口拒绝访问（HTTP 403），请检查订阅、组织权限或所选 profile。",
  throttled: "Kiro 额度查询被限流（HTTP 429），请稍后重试。",
  unavailable: "Kiro 额度服务暂不可用，请稍后重试。",
  network: "无法连接 Kiro 额度接口，请检查供应商代理或网络。",
  invalid: "Kiro 额度接口返回的数据无效或超出大小限制。",
  profile: "Kiro 企业账号的 profile 无法确定，未查询额度。",
};
/** Read-only: uses the stored access token as-is; expiry is handled before this call by the usage service. */
export async function queryKiroUsage(providerId: string, credential: OAuthCredential, signal: AbortSignal, transport: typeof fetch = globalThis.fetch): Promise<ProviderUsage> {
  try { return kiroQuotaUsage(providerId, await fetchKiroQuota(credential, signal, transport)); }
  catch (error) {
    signal.throwIfAborted();
    const kind = error instanceof KiroQuotaError ? error.kind : "invalid";
    const status = (error as KiroQuotaError).status;
    return { providerId, status: "unavailable", metrics: [], accountStatus: { state: kind === "unauthorized" ? "unauthorized" : "unknown", checkedAt: Date.now() },
      message: kind === "unavailable" && status ? `Kiro 额度服务暂不可用（HTTP ${status}），请稍后重试。` : messages[kind] };
  }
}
