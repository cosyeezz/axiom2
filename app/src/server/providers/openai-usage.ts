import type { OAuthCredential } from "@earendil-works/pi-ai";
import type { ProviderUsage, ProviderUsageMetric } from "../../shared/provider-usage.js";

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
function accountId(credential: OAuthCredential): string | undefined {
  if (typeof credential.accountId === "string" && credential.accountId.trim()) return credential.accountId;
  try {
    const claims = JSON.parse(Buffer.from(credential.access.split(".")[1], "base64url").toString("utf8"));
    const value = record(claims["https://api.openai.com/auth"]).chatgpt_account_id;
    return typeof value === "string" && value.trim() ? value : undefined;
  } catch { return; }
}
function windowMetric(id: string, fallback: string, raw: unknown, now: number, prefix = ""): ProviderUsageMetric | undefined {
  const w = record(raw);
  if (!Object.keys(w).length) return;
  const seconds = finite(w.limit_window_seconds) && w.limit_window_seconds > 0 ? w.limit_window_seconds : undefined;
  const duration = seconds && (seconds % 86400 === 0 ? `${seconds / 86400}天` : seconds % 3600 === 0 ? `${seconds / 3600}小时` : `${Math.ceil(seconds / 60)}分钟`);
  const usedPercent = finite(w.used_percent) && w.used_percent >= 0 && w.used_percent <= 100 ? w.used_percent : null;
  const resetsAt = timestamp(w.reset_at) ?? (finite(w.reset_after_seconds) && w.reset_after_seconds >= 0 ? now + w.reset_after_seconds * 1000 : undefined);
  return { id, kind: "window", label: `${prefix}${duration || fallback}已用`, usedPercent, windowSeconds: seconds, resetsAt };
}
/** Only accept known card containers; no raw IDs or upstream labels cross the boundary. */
export function parseOpenAIResetCredits(raw: unknown, now = Date.now()): { count: number | null; expiresAt?: number } {
  const data = record(raw);
  const explicit = count(data.available_count) ?? count(data.availableCount);
  const cards = Array.isArray(raw) ? raw : [data.credits, data.rate_limit_reset_credits, data.items, data.data].find(Array.isArray);
  if (!cards) return { count: explicit };
  const available = cards.filter(card => card && typeof card === "object" && !Array.isArray(card)).map(record).filter(card => {
    const type = card.reset_type ?? card.resetType, status = card.status;
    const expiresAt = timestamp(card.expires_at ?? card.expiresAt);
    return (!type || typeof type === "string" && type.toLowerCase() === "codex_rate_limits") &&
      (!status || typeof status === "string" && status.toLowerCase() === "available") && (!expiresAt || expiresAt > now);
  });
  const expiries = available.flatMap(card => { const at = timestamp(card.expires_at ?? card.expiresAt); return at ? [at] : []; });
  return { count: explicit ?? available.length, ...(expiries.length ? { expiresAt: Math.min(...expiries) } : {}) };
}

class UsageHttpError extends Error {
  constructor(readonly status: number) { super(`Usage HTTP ${status}`); }
}
class UsageResponseError extends Error {}
function failureMessage(results: PromiseSettledResult<unknown>[]): string {
  const failures = results.filter(result => result.status === "rejected");
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
  if (!response.ok) { await response.body?.cancel(); throw new UsageHttpError(response.status); }
  if (!response.body) throw new UsageResponseError("Empty response");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_000_000) throw new UsageResponseError("Response too large");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** The documented direct grant targets api.openai.com; its usage contract is the official settings page. */
export function openAIUsageRestriction(providerId: string, credential: OAuthCredential): ProviderUsage | undefined {
  if (!Array.isArray(credential.scopes) || !credential.scopes.includes("chatgpt.tokens.use.direct")) return;
  return { providerId, status: "unavailable", metrics: [], refreshable: false,
    message: "当前 OpenAI direct 授权未提供已核实的额度查询接口；请在官方用量页查看。",
    management: { label: "打开官方用量页", url: "https://chatgpt.com/settings/usage" } };
}

export async function queryOpenAIUsage(providerId: string, credential: OAuthCredential, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<ProviderUsage> {
  signal.throwIfAborted();
  const restriction = openAIUsageRestriction(providerId, credential);
  if (restriction) return restriction;
  const account = accountId(credential);
  // Official Codex treats this routing header as optional. Let the upstream decide
  // whether an otherwise unclassified token can query usage; do not require local account metadata.
  const headers: Record<string, string> = { Authorization: `Bearer ${credential.access}`,
    "openai-beta": "codex-1", originator: "Codex Desktop", "oai-language": "zh-CN", Accept: "application/json" };
  if (account) headers["chatgpt-account-id"] = account;
  const [usage, details] = await Promise.allSettled([
    readJson(`${base}/usage`, headers, signal, fetcher),
    readJson(`${base}/rate-limit-reset-credits`, headers, signal, fetcher),
  ]);
  signal.throwIfAborted();
  const now = Date.now(), metrics: ProviderUsageMetric[] = [];
  const payload = usage.status === "fulfilled" ? record(usage.value) : {};
  const rate = record(payload.rate_limit);
  for (const [key, fallback] of [["primary_window", "主窗口"], ["secondary_window", "次窗口"]]) {
    const metric = windowMetric(key, fallback, rate[key], now);
    if (metric) metrics.push(metric);
  }
  // Extra windows are independent (e.g. Spark); never reinterpret them as the primary quota.
  if (Array.isArray(payload.additional_rate_limits)) payload.additional_rate_limits.slice(0, 8).forEach((raw, index) => {
    const extra = record(raw), windows = record(extra.rate_limit);
    const label = extra.metered_feature === "codex_spark" || extra.limit_name === "GPT-5.3-Codex-Spark" ? "Spark " : `额外${index + 1} `;
    for (const [key, fallback] of [["primary_window", "主窗口"], ["secondary_window", "次窗口"]]) {
      const metric = windowMetric(`extra_${index}_${key}`, fallback, windows[key], now, label);
      if (metric) metrics.push(metric);
    }
  });
  const credits = record(payload.credits);
  const balance = typeof credits.balance === "string" && /^\d+(?:\.\d+)?$/.test(credits.balance.trim()) ? credits.balance.trim()
    : credits.has_credits === false ? "0" : null;
  metrics.push({ id: "credits", label: "剩余点数", kind: "balance", balance, unlimited: credits.unlimited === true });
  const reset = details.status === "fulfilled" ? parseOpenAIResetCredits(details.value, now) : { count: null };
  const fallback = count(record(payload.rate_limit_reset_credits).available_count);
  metrics.push({ id: "reset_credits", label: "重置次数", kind: "count", count: reset.count ?? fallback, expiresAt: reset.expiresAt });
  const known = metrics.some(metric => metric.kind === "window" ? metric.usedPercent !== null : metric.kind === "balance" ? metric.balance !== null || metric.unlimited : metric.kind === "count" && metric.count !== null);
  const partial = usage.status === "rejected" || details.status === "rejected";
  return { providerId, status: known ? "ready" : "unavailable", metrics, updatedAt: known ? now : undefined,
    ...(!known ? { message: failureMessage([usage, details]) }
      : partial ? { message: `部分信息不可用：${failureMessage([usage, details])} — 表示未知，并非零。` } : {}) };
}
