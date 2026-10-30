import type { OAuthCredential } from "@earendil-works/pi-ai";
import type { ProviderAccountState, ProviderUsage, ProviderUsageMetric } from "../../shared/provider-usage.js";
import { openAIAccountId, openAIAccountInfo, openAIEmail, openAIPlan } from "./openai-account-info.js";

const base = "https://chatgpt.com/backend-api/wham";
type Json = Record<string, unknown>;
const record = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const count = (value: unknown): number | null => {
  const n = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return finite(n) && Number.isSafeInteger(n) && n >= 0 ? n : null;
};
function timestamp(value: unknown): number | undefined {
  const ms = finite(value) && value > 0 ? value * 1000 : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(ms) && ms > 0 && ms <= 8.64e15 ? ms : undefined;
}
const subscriptionDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? timestamp(value) : undefined;
function windowMetric(id: string, fallback: string, raw: unknown, now: number, prefix = "", availability: Json = {}): ProviderUsageMetric | undefined {
  const w = record(raw);
  if (!Object.keys(w).length) return;
  const seconds = finite(w.limit_window_seconds) && w.limit_window_seconds > 0 ? w.limit_window_seconds : undefined;
  const duration = seconds && (seconds % 86400 === 0 ? `${seconds / 86400}天` : seconds % 3600 === 0 ? `${seconds / 3600}小时` : `${Math.ceil(seconds / 60)}分钟`);
  const usedPercent = finite(w.used_percent) && w.used_percent >= 0 && w.used_percent <= 100 ? w.used_percent : null;
  const resetsAt = timestamp(w.reset_at) ?? (finite(w.reset_after_seconds) && w.reset_after_seconds >= 0 ? now + w.reset_after_seconds * 1000 : undefined);
  return { id, kind: "window", label: `${prefix}${duration || fallback}已用`, usedPercent, windowSeconds: seconds, resetsAt,
    ...(typeof availability.allowed === "boolean" ? { allowed: availability.allowed } : {}),
    ...(typeof availability.limit_reached === "boolean" ? { limitReached: availability.limit_reached } : {}) };
}
/** Only accept known card containers; no raw IDs or upstream labels cross the boundary. */
export function parseOpenAIResetCredits(raw: unknown, now = Date.now()): { count: number | null; expiresAt?: number; expiries?: number[] } {
  const data = record(raw);
  const explicit = count(data.available_count) ?? count(data.availableCount);
  const cards = Array.isArray(raw) ? raw : [data.credits, data.rate_limit_reset_credits, data.items, data.data].find(Array.isArray);
  if (!cards) return { count: explicit };
  const recognized = cards.filter(card => card && typeof card === "object" && !Array.isArray(card)).map(record).filter(card =>
    [card.id, card.reset_type, card.resetType, card.status, card.expires_at, card.expiresAt].some(value => typeof value === "string" && value.length > 0));
  if (cards.length && !recognized.length) return { count: explicit };
  const available = recognized.filter(card => {
    const type = card.reset_type ?? card.resetType, status = card.status, expiry = card.expires_at ?? card.expiresAt;
    const expiresAt = timestamp(expiry);
    return (!type || typeof type === "string" && type.toLowerCase() === "codex_rate_limits") &&
      (!status || typeof status === "string" && status.toLowerCase() === "available") &&
      (expiry === undefined || expiry === null || !!expiresAt && expiresAt > now);
  });
  const expiries = available.flatMap(card => { const at = timestamp(card.expires_at ?? card.expiresAt); return at ? [at] : []; }).sort((a, b) => a - b).slice(0, 64);
  return { count: explicit ?? available.length, ...(expiries.length ? { expiresAt: expiries[0], expiries } : {}) };
}

class UsageHttpError extends Error {
  constructor(readonly status: number, readonly challenge = false) { super(`Usage HTTP ${status}`); }
}
class UsageResponseError extends Error {}
class UsageAccountError extends Error {
  constructor(readonly state: "disabled" | "unauthorized") { super("Account status rejected"); }
}
/** Borrow sub2api's structured-code rule, never its free-form error text or mutation policy. */
function accessState(raw: unknown): "disabled" | "unauthorized" | undefined {
  const data = record(raw), codes = [record(data.error).code, record(record(data.response).error).code, record(data.detail).code, data.code];
  const values = codes.filter((code): code is string => typeof code === "string" && code.length <= 80).map(code => code.trim().toLowerCase());
  if (values.some(code => /^(?:(?:workspace|account|organization|org)_(?:deactivated|disabled|suspended)|(?:deactivated|disabled|suspended)_(?:workspace|account|organization|org))$/.test(code))) return "disabled";
  if (values.some(code => ["token_invalidated", "token_revoked", "token_expired", "invalid_token"].includes(code))) return "unauthorized";
}
const stateMessage = (state: ProviderAccountState) => state === "disabled" ? "OpenAI 已明确标记此账号或工作区停用，已停止后续查询。"
  : state === "unauthorized" ? "OpenAI 已明确拒绝当前凭据（失效、撤销或过期），已停止后续查询；请重新登录。"
  : "无法确认目标账号状态，已停止后续额度、订阅与估算查询；请重试。";
function failureMessage(results: PromiseSettledResult<unknown>[]): string {
  const failures = results.filter(result => result.status === "rejected");
  const state = failures.flatMap(result => result.reason instanceof UsageAccountError ? [result.reason.state] : [])[0];
  if (state) return stateMessage(state);
  const challenge = failures.find(result => result.reason instanceof UsageHttpError && result.reason.challenge);
  if (challenge?.status === "rejected") return `OpenAI 状态检查遇到访问质询或拦截（HTTP ${challenge.reason.status}），不能据此认定账号停用。`;
  const statuses = failures.flatMap(result => result.reason instanceof UsageHttpError ? [result.reason.status] : []);
  if (statuses.includes(401)) return "OpenAI 未接受当前额度查询授权（HTTP 401）；模型授权不一定具备额度接口权限。";
  if (statuses.includes(403)) return "OpenAI 额度接口拒绝访问（HTTP 403），请检查授权权限或代理访问限制。";
  if (statuses.includes(429)) return "OpenAI 额度查询被限流（HTTP 429），请稍后重试。";
  if (statuses.length) return `OpenAI 额度服务暂不可用（HTTP ${statuses[0]}），请稍后重试。`;
  if (failures.some(result => result.reason instanceof UsageResponseError || result.reason instanceof SyntaxError))
    return "OpenAI 额度接口返回的数据无效或超出大小限制。";
  return failures.length ? "无法连接 OpenAI 额度接口，请检查供应商代理或网络。" : "上游响应未提供可识别的额度数据。";
}

async function readJson(url: string, headers: Record<string, string>, signal: AbortSignal, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(url, { method: "GET", headers, signal, redirect: "error" });
  const httpError = new UsageHttpError(response.status, response.headers.get("cf-mitigated")?.trim().toLowerCase() === "challenge");
  if (!response.body) { if (!response.ok) throw httpError; throw new UsageResponseError("Empty response"); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > (response.ok ? 1_000_000 : 65_536)) { if (!response.ok) throw httpError; throw new UsageResponseError("Response too large"); }
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  let data: unknown;
  try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { if (!response.ok) throw httpError; throw new UsageResponseError("Invalid JSON"); }
  const state = accessState(data);
  if (state) throw new UsageAccountError(state);
  if (!response.ok) throw httpError;
  return data;
}

/** Match identity BEFORE evaluating state. Disabled targets never fall back to healthy workspaces. */
export function inspectOpenAIAccountCheck(raw: unknown, expectedId?: string): { state: ProviderAccountState; account?: ProviderUsage["account"] } {
  const failure = accessState(raw);
  if (failure) return { state: failure };
  const data = record(raw), accounts = record(data.accounts), entries = Object.entries(accounts);
  if (entries.length > 100 || data.error || data.detail) return { state: "unknown" };
  const candidates = new Map<string, { state: ProviderAccountState; account: NonNullable<ProviderUsage["account"]> }[]>();
  for (const [key, value] of entries) {
    const item = record(value), account = record(item.account), entitlement = record(item.entitlement);
    const providedId = Object.hasOwn(account, "account_id"), parsedId = openAIAccountId(account.account_id);
    // A malformed supplied identity is not an omitted optional identity. Never repair it with an alias.
    if (providedId && !parsedId) {
      if (!expectedId || key === expectedId || key === "default") return { state: "unknown" };
      continue;
    }
    const id = parsedId ?? (key !== "default" ? openAIAccountId(key) : undefined);
    if (!id || expectedId && id !== expectedId) continue;
    const disabled = (data: Json) => ["deactivated", "is_deactivated", "disabled", "is_disabled"].some(key => data[key] === true) ||
      ["deactivated_at", "disabled_at", "deleted_at"].some(key => typeof data[key] === "string" && !!(data[key] as string).trim()) ||
      ["status", "state"].some(key => typeof data[key] === "string" && /^(deactivated|disabled|deleted|inactive|suspended)$/i.test((data[key] as string).trim()));
    const plan = openAIPlan(account.plan_type) ?? openAIPlan(entitlement.subscription_plan);
    const states = [item.status, item.state, account.status, account.state].filter(value => value !== undefined && value !== null && value !== "");
    const recognized = states.every(value => typeof value === "string" && /^(active|enabled|normal)$/i.test(value.trim()));
    // A well-formed, uniquely matched account+plan (sub2api's usable candidate) or explicit active marker is required.
    // HTTP 200 / an empty object alone is not evidence. Expired entitlement is NOT a disabled account.
    const state: ProviderAccountState = disabled(item) || disabled(account) ? "disabled" : recognized && (plan || states.length) ? "active" : "unknown";
    const subscriptionExpiresAt = subscriptionDate(entitlement.expires_at);
    const info = { accountId: id, ...(plan ? { plan } : {}), ...(subscriptionExpiresAt ? { subscriptionExpiresAt } : {}) };
    const aliases = candidates.get(id) ?? []; aliases.push({ state, account: info }); candidates.set(id, aliases);
  }
  if (candidates.size !== 1) return { state: "unknown" };
  const aliases = [...candidates.values()][0];
  if (aliases.some(alias => JSON.stringify(alias) !== JSON.stringify(aliases[0]))) return { state: "unknown" };
  return aliases[0];
}

/** Only use entitlement dates belonging to the same identity AND plan as the quota response. */
export function parseOpenAIAccountCheck(raw: unknown, expectedId?: string, expectedPlan?: string): ProviderUsage["account"] | undefined {
  const checked = inspectOpenAIAccountCheck(raw, expectedId), plan = checked.account?.plan;
  return checked.state === "active" && (!expectedPlan || !plan || expectedPlan.toLowerCase() === plan.toLowerCase()) ? checked.account : undefined;
}

export async function queryOpenAIUsage(providerId: string, credential: OAuthCredential, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<ProviderUsage> {
  signal.throwIfAborted();
  const savedInfo = openAIAccountInfo(credential), account = savedInfo.accountId;
  // Official Codex treats this routing header as optional. Let the upstream decide
  // whether an otherwise unclassified token can query usage; do not require local account metadata.
  const headers: Record<string, string> = { Authorization: `Bearer ${credential.access}`,
    "openai-beta": "codex-1", originator: "Codex Desktop", "oai-language": "zh-CN", Accept: "application/json" };
  if (account) headers["chatgpt-account-id"] = account;
  // Scopes are not a capability oracle. First make one real, bounded status request; only a matched usable account proceeds.
  const management = { label: "打开官方用量页", url: "https://chatgpt.com/settings/usage" };
  const stopped = (state: ProviderAccountState, message: string, info?: ProviderUsage["account"]): ProviderUsage => ({
    providerId, status: "unavailable", metrics: [], accountStatus: { state, checkedAt: Date.now() },
    ...(info ? { account: info, updatedAt: Date.now() } : {}), management, message });
  const [profile] = await Promise.allSettled([readJson("https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27", headers, signal, fetcher)]);
  signal.throwIfAborted();
  if (profile.status === "rejected") {
    const state = profile.reason instanceof UsageAccountError ? profile.reason.state : "unknown";
    return stopped(state, state === "unknown" ? `${failureMessage([profile]).replaceAll("额度", "账号状态")} ${stateMessage(state)}` : stateMessage(state));
  }
  const preflight = inspectOpenAIAccountCheck(profile.value, account);
  if (preflight.state !== "active") return stopped(preflight.state, stateMessage(preflight.state));
  const matchedId = preflight.account!.accountId!;
  headers["chatgpt-account-id"] = matchedId;
  const accountStatus = { state: "active" as const, checkedAt: Date.now() };
  const [usage] = await Promise.allSettled([readJson(`${base}/usage`, headers, signal, fetcher)]);
  signal.throwIfAborted();
  if (usage.status === "rejected") return stopped(usage.reason instanceof UsageAccountError ? usage.reason.state : "active",
    failureMessage([usage]), preflight.account);
  const returnedId = openAIAccountId(record(usage.value).account_id);
  if (Object.hasOwn(record(usage.value), "account_id") && !returnedId || returnedId && matchedId !== returnedId) return stopped("unknown", "额度响应的账号与状态检查目标不一致，已忽略该额度数据并停止后续查询。", preflight.account);
  const [details] = await Promise.allSettled([readJson(`${base}/rate-limit-reset-credits`, headers, signal, fetcher)]);
  signal.throwIfAborted();
  if (details.status === "rejected" && details.reason instanceof UsageAccountError) return stopped(details.reason.state, stateMessage(details.reason.state), preflight.account);
  const now = Date.now(), metrics: ProviderUsageMetric[] = [];
  const raw = usage.status === "fulfilled" ? record(usage.value) : {};
  const payload = raw;
  const email = openAIEmail(payload.email), usagePlan = openAIPlan(payload.plan_type);
  const checked = parseOpenAIAccountCheck(profile.value, matchedId, usagePlan);
  let info: NonNullable<ProviderUsage["account"]> = { ...checked, ...(email ? { email } : {}), ...(usagePlan ? { plan: usagePlan } : {}),
    accountId: matchedId };
  const subscriptionId = matchedId;
  const accountMessages: string[] = [];
  if (!checked) accountMessages.push("账号接口未返回可唯一匹配的套餐与订阅信息，未采用其他工作区资料。");
  if (subscriptionId && !info.subscriptionExpiresAt) {
    const [subscription] = await Promise.allSettled([readJson(`https://chatgpt.com/backend-api/subscriptions?account_id=${encodeURIComponent(subscriptionId)}`,
      { ...headers, "chatgpt-account-id": subscriptionId }, signal, fetcher)]);
    signal.throwIfAborted();
    if (subscription.status === "fulfilled") {
      const data = record(subscription.value), plan = openAIPlan(data.plan_type), id = openAIAccountId(data.account_id);
      const sameAccount = !Object.hasOwn(data, "account_id") || id === subscriptionId, samePlan = !info.plan || !plan || info.plan.toLowerCase() === plan.toLowerCase();
      const subscriptionExpiresAt = subscriptionDate(data.active_until);
      if (sameAccount && samePlan && subscriptionExpiresAt) info = { ...info, accountId: subscriptionId,
        ...(plan ? { plan } : {}), subscriptionExpiresAt };
      else accountMessages.push("订阅接口未返回同账号、同套餐的有效到期时间。");
    } else {
      if (subscription.reason instanceof UsageAccountError) return stopped(subscription.reason.state, stateMessage(subscription.reason.state), info);
      accountMessages.push(failureMessage([subscription]).replaceAll("额度", "订阅"));
    }
  }
  const rate = record(payload.rate_limit);
  for (const [key, fallback] of [["primary_window", "主窗口"], ["secondary_window", "次窗口"]]) {
    const metric = windowMetric(key, fallback, rate[key], now, "", rate);
    if (metric) metrics.push(metric);
  }
  // Extra windows are independent (e.g. Spark); never reinterpret them as the primary quota.
  if (Array.isArray(payload.additional_rate_limits)) payload.additional_rate_limits.slice(0, 8).forEach((raw, index) => {
    const extra = record(raw), windows = record(extra.rate_limit);
    const label = extra.metered_feature === "codex_spark" || extra.limit_name === "GPT-5.3-Codex-Spark" ? "Spark " : `额外${index + 1} `;
    for (const [key, fallback] of [["primary_window", "主窗口"], ["secondary_window", "次窗口"]]) {
      const metric = windowMetric(`extra_${index}_${key}`, fallback, windows[key], now, label, windows);
      if (metric) metrics.push(metric);
    }
  });
  const credits = record(payload.credits);
  const balance = typeof credits.balance === "string" && credits.balance.length <= 512 && /^\d+(?:\.\d+)?$/.test(credits.balance.trim()) ? credits.balance.trim()
    : credits.has_credits === false ? "0" : null;
  metrics.push({ id: "credits", label: "剩余点数", kind: "balance", balance, unlimited: credits.unlimited === true,
    ...(typeof credits.has_credits === "boolean" ? { hasCredits: credits.has_credits } : {}) });
  const reset = details.status === "fulfilled" ? parseOpenAIResetCredits(details.value, now) : { count: null };
  const fallback = count(record(payload.rate_limit_reset_credits).available_count);
  metrics.push({ id: "reset_credits", label: "重置次数", kind: "count", count: reset.count ?? fallback, expiresAt: reset.expiresAt, expiries: reset.expiries });
  const known = metrics.some(metric => metric.kind === "window" ? metric.usedPercent !== null : metric.kind === "balance" ? metric.balance !== null || metric.unlimited : metric.kind === "count" && metric.count !== null);
  const partial = details.status === "rejected";
  const messages = [...(!known ? [failureMessage([usage, details])] : partial ? [`部分额度信息不可用：${failureMessage([usage, details])} — 表示未知，并非零。`] : []), ...accountMessages];
  return { providerId, status: known ? "ready" : "unavailable", metrics, accountStatus, ...(Object.keys(info).length ? { account: info } : {}),
    updatedAt: known || Object.keys(info).length ? now : undefined,
    management: { label: "打开官方用量页", url: "https://chatgpt.com/settings/usage" },
    ...(messages.length ? { message: messages.join(" ") } : {}) };
}
