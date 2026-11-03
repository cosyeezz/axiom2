import { randomUUID } from "node:crypto";
import type { OAuthCredential } from "@earendil-works/pi-ai";
import type { ProviderUsage, ProviderUsageMetric } from "../../shared/provider-usage.js";
import { QoderError, qoderClientHeaders, qoderReadJson, qoderSignal, qoderSites, type QoderRegion } from "./qoder-protocol.js";

/**
 * Read-only Qoder plan/credit query. Axiom code; evidence is qodercli 1.1.81
 * (fetchQuotaUsage/fetchUserPlan + normalizeQuotaUsage/normalizeUserPlan):
 * Bearer GET {open}/api/v2/quota/usage and {open}/api/v2/user/plan; Hc/S9i also adds
 * CLI client headers + a fresh uppercase UUID X-Request-ID. Never inherits host trace headers.
 * body via decrypt_server_response fallback to plain JSON. The CLI's org-only /sash/api/v2/me/usage
 * refreshes tokens on 401, so it is not used here. Never refreshes, never forwards upstream text.
 */
type Json = Record<string, unknown>;
const record = (value: unknown): Json | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Json : undefined;
const pick = (data: Json | undefined, keys: string[]) => data ? keys.map(key => data[key]).find(value => value !== undefined && value !== null) : undefined;
const nonempty = (value: unknown): value is string => typeof value === "string" && !!value.trim();
function amount(value: unknown): number | undefined {
  const n = typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1e12 ? n : undefined;
}
/** The CLI passes these straight to new Date() (milliseconds); seconds are tolerated. */
function instant(value: unknown): number | undefined {
  const n = typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return;
  const ms = n < 1e11 ? n * 1000 : n;
  return ms < 325036512e5 ? Math.round(ms) : undefined;
}
const safeText = (value: unknown, limit = 64) => typeof value === "string" && value.trim().length <= limit
  && /^[\p{L}\p{N}][\p{L}\p{N} _.+()&/'-]*$/u.test(value.trim()) ? value.trim() : undefined;

export class QoderQuotaError extends Error {
  constructor(readonly kind: "unauthorized" | "forbidden" | "throttled" | "unavailable" | "network" | "invalid", readonly status?: number) { super(`Qoder quota ${kind}`); }
}
export type QoderQuota = { plan?: string; subscriptionExpiresAt?: number; metrics: ProviderUsageMetric[] };

function bucket(id: string, label: string, data: Json | undefined, limitKeys = ["total"]): ProviderUsageMetric | undefined {
  if (!data) return;
  const used = amount(pick(data, ["used"])) ?? null, remaining = amount(pick(data, ["remaining"]));
  const total = amount(pick(data, limitKeys)) ?? (used !== null && remaining !== undefined ? used + remaining : undefined) ?? null;
  const unit = safeText(pick(data, ["unit"]), 32) ?? "credits";
  return { id, kind: "quota", label, used, limit: total, unit };
}
/** Whitelist projection of /api/v2/quota/usage; requires the identity fields the CLI requires. */
export function parseQoderQuota(input: unknown): ProviderUsageMetric[] {
  const data = record(input);
  if (!data || !nonempty(pick(data, ["user_id", "userId"])) || !nonempty(pick(data, ["user_type", "userType"]))) throw new QoderQuotaError("invalid");
  const metrics: ProviderUsageMetric[] = [];
  const add = (metric: ProviderUsageMetric | undefined) => { if (metric) metrics.push(metric); };
  add(bucket("user", "套餐额度", record(pick(data, ["user_quota", "userQuota"]))));
  add(bucket("add-on", "附加额度", record(pick(data, ["add_on_quota", "addOnQuota"]))));
  // CLI status view: org package total is used + remaining; cap/total is the policy ceiling.
  const org = record(pick(data, ["org_resource_package", "orgResourcePackage", "shared_quota", "sharedQuota"]));
  if (org) {
    const used = amount(org.used), remaining = amount(org.remaining);
    add(bucket("org", "组织资源包", used !== undefined && remaining !== undefined ? { ...org, total: used + remaining } : org, ["total", "cap"]));
  }
  const dedicated = pick(data, ["dedicated_resource_packages", "dedicatedResourcePackages"]);
  if (Array.isArray(dedicated)) for (const [index, item] of dedicated.slice(0, 32).entries()) {
    const pack = record(item), status = typeof pack?.status === "string" ? pack.status : "";
    if (!pack || !nonempty(pack.id) || status.endsWith("_EXPIRED") || ![pack.total, pack.used, pack.remaining].some(value => amount(value) !== undefined)) continue;
    const metric = bucket(`dedicated:${index}`, safeText(pack.name) ?? "专属资源包", pack);
    const expiresAt = instant(pick(pack, ["expires_at", "expiresAt"]));
    if (metric?.kind === "quota") add(expiresAt ? { ...metric, expiresAt } : metric);
  }
  return metrics;
}
export function parseQoderPlan(input: unknown): Pick<QoderQuota, "plan" | "subscriptionExpiresAt"> {
  const data = record(input);
  if (!data || !nonempty(pick(data, ["user_type", "userType"]))) return {};
  const plan = safeText(pick(data, ["plan_tier_name", "planTierName", "plan_name", "planName"]));
  if (!plan) return {};
  const end = instant(pick(data, ["end_date", "endDate"]));
  return { ...(plan ? { plan } : {}), ...(end ? { subscriptionExpiresAt: end } : {}) };
}

const regionOf = (providerId: string): QoderRegion | undefined => providerId === "qoder" ? "intl" : providerId === "qoder-cn" ? "cn" : undefined;
async function get(transport: typeof fetch, url: string, token: string, signal: AbortSignal): Promise<Json> {
  const bounded = qoderSignal(signal, 10_000);
  let response: Response;
  try { response = await transport(url, { method: "GET", redirect: "error", signal: bounded, headers: {
    Accept: "application/json", Authorization: `Bearer ${token}`, ...qoderClientHeaders(), "X-Request-ID": randomUUID().toUpperCase(),
  } }); }
  catch { signal.throwIfAborted(); throw new QoderQuotaError("network"); }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    const s = response.status;
    throw new QoderQuotaError(s === 401 ? "unauthorized" : s === 403 ? "forbidden" : s === 429 ? "throttled" : s >= 500 ? "unavailable" : "invalid", s);
  }
  try { return await qoderReadJson(response, true, bounded); }
  catch (error) { signal.throwIfAborted(); throw error instanceof QoderError || error instanceof SyntaxError ? new QoderQuotaError("invalid") : new QoderQuotaError("network"); }
}
export async function fetchQoderQuota(providerId: string, credential: OAuthCredential, signal: AbortSignal, transport: typeof fetch = globalThis.fetch): Promise<QoderQuota> {
  signal.throwIfAborted();
  const region = regionOf(providerId), token = credential.access;
  if (!region || credential.region !== region || typeof token !== "string" || !token.trim() || /[\r\n\0]/.test(token)) throw new QoderQuotaError("invalid");
  const open = qoderSites[region].open;
  const [quota, plan] = await Promise.allSettled([get(transport, `${open}/api/v2/quota/usage`, token, signal), get(transport, `${open}/api/v2/user/plan`, token, signal)]);
  signal.throwIfAborted();
  const unauthorized = [quota, plan].some(result => result.status === "rejected" && (result.reason as QoderQuotaError).kind === "unauthorized");
  if (unauthorized) throw new QoderQuotaError("unauthorized", 401);
  if (quota.status === "rejected") throw quota.reason;
  // Plan is display-only: its failure never hides quota.
  return { metrics: parseQoderQuota(quota.value), ...(plan.status === "fulfilled" ? parseQoderPlan(plan.value) : {}) };
}

const messages: Record<QoderQuotaError["kind"], string> = {
  unauthorized: "Qoder 未接受当前授权（HTTP 401），已停止后续查询；请重新登录。",
  forbidden: "Qoder 额度接口拒绝访问（HTTP 403），请检查账号地区或组织权限。",
  throttled: "Qoder 额度查询被限流（HTTP 429），请稍后重试。",
  unavailable: "Qoder 额度服务暂不可用，请稍后重试。",
  network: "无法连接 Qoder 额度接口，请检查供应商代理或网络。",
  invalid: "Qoder 额度接口返回的数据无效，或账号地区与凭据不一致。",
};
export async function queryQoderUsage(providerId: string, credential: OAuthCredential, signal: AbortSignal, transport: typeof fetch = globalThis.fetch): Promise<ProviderUsage> {
  try {
    const quota = await fetchQoderQuota(providerId, credential, signal, transport), now = Date.now();
    const account = { ...(quota.plan ? { plan: quota.plan } : {}), ...(quota.subscriptionExpiresAt ? { subscriptionExpiresAt: quota.subscriptionExpiresAt } : {}) };
    return { providerId, status: "ready", metrics: quota.metrics, accountStatus: { state: "active", checkedAt: now }, updatedAt: now,
      ...(Object.keys(account).length ? { account } : {}), ...(quota.metrics.length ? {} : { message: "Qoder 未返回额度明细。" }) };
  } catch (error) {
    signal.throwIfAborted();
    const kind = error instanceof QoderQuotaError ? error.kind : "invalid", status = error instanceof QoderQuotaError ? error.status : undefined;
    return { providerId, status: "unavailable", metrics: [], accountStatus: { state: kind === "unauthorized" ? "unauthorized" : "unknown", checkedAt: Date.now() },
      message: kind === "unavailable" && status ? `Qoder 额度服务暂不可用（HTTP ${status}），请稍后重试。` : messages[kind] };
  }
}
