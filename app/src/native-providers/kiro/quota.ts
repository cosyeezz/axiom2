import { randomUUID } from "node:crypto";
import type { KiroCredential } from "./auth.js";
import { kiroServiceRegion, validateKiroCredential } from "./catalog.js";
import { resolveKiroProfile } from "./profile.js";

/**
 * Read-only Kiro subscription/credit query.
 * Evidence: kiro-cli 2.37.0 (macOS) Smithy client strings
 * `AmazonCodeWhispererService.GetUsageLimits`, input members
 * origin/resourceType/isEmailRequired/profileArn and output members
 * subscriptionInfo/usageBreakdownList/userInfo/nextDateReset/daysUntilReset.
 * Field semantics of bonuses/free trial follow kiro.rs v0.9.2 usage_limits.rs.
 * Never refreshes or persists credentials, and never forwards upstream text.
 */
type Json = Record<string, unknown>;
const maxBytes = 256 * 1024;
const maxBuckets = 32;

export type KiroQuotaBucket = {
  id: string; kind: "base" | "free-trial" | "bonus" | "overage";
  /** Upstream display noun, e.g. "Credits"; bounded safe text only. */
  unit?: string; name?: string;
  used: number | null; limit: number | null; resetsAt?: number; expiresAt?: number;
};
export type KiroQuota = {
  plan?: string; subscriptionType?: string; email?: string;
  overageEnabled?: boolean; resetsAt?: number; buckets: KiroQuotaBucket[];
};
export type KiroQuotaFailure = "unauthorized" | "forbidden" | "throttled" | "unavailable" | "network" | "invalid" | "profile";
export class KiroQuotaError extends Error {
  constructor(readonly kind: KiroQuotaFailure, readonly status?: number) { super(`Kiro quota ${kind}`); }
}

const record = (value: unknown): Json | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Json : undefined;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
function amount(precise: unknown, integer: unknown): number | null {
  const value = finite(precise) ? precise : finite(integer) ? integer : undefined;
  return value !== undefined && value >= 0 && value <= 1e12 ? value : null;
}
/** AWS JSON 1.0 timestamps are epoch seconds; tolerate milliseconds and ISO strings. */
function timestamp(value: unknown): number | undefined {
  const ms = finite(value) && value > 0 ? value > 1e12 ? value : value * 1000 : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(ms) && ms > 0 && ms <= 8.64e15 ? Math.round(ms) : undefined;
}
function label(value: unknown, limit = 64): string | undefined {
  if (typeof value !== "string") return;
  const text = value.trim();
  return text && text.length <= limit && /^[\p{L}\p{N} _.+()&/'-]+$/u.test(text) ? text : undefined;
}
const active = (value: unknown) => typeof value === "string" && value.toUpperCase() === "ACTIVE";
const email = (value: unknown) => typeof value === "string" && value.length <= 254 && /^[^\s@<>\x00-\x1f\x7f]+@[^\s@<>\x00-\x1f\x7f]+\.[^\s@<>\x00-\x1f\x7f]+$/.test(value) ? value : undefined;

/** Whitelisted projection of GetUsageLimitsOutput. Unknown or malformed members are dropped, not guessed. */
export function parseKiroQuota(raw: unknown): KiroQuota {
  const data = record(raw);
  if (!data) throw new KiroQuotaError("invalid");
  const subscription = record(data.subscriptionInfo), user = record(data.userInfo), overage = record(data.overageConfiguration);
  const list = data.usageBreakdownList;
  if (list !== undefined && !Array.isArray(list)) throw new KiroQuotaError("invalid");
  const topReset = timestamp(data.nextDateReset);
  const buckets: KiroQuotaBucket[] = [];
  const push = (bucket: KiroQuotaBucket) => { if (buckets.length < maxBuckets) buckets.push(bucket); };
  for (const [index, entry] of (list ?? []).entries()) {
    const item = record(entry);
    if (!item) continue;
    const key = label(item.resourceType, 40)?.replace(/[^A-Za-z0-9_-]/g, "_") ?? String(index);
    const unit = label(item.displayNamePlural) ?? label(item.unit), name = label(item.displayName);
    const resetsAt = timestamp(item.nextDateReset) ?? topReset;
    push({ id: `${key}:base`, kind: "base", unit, name, used: amount(item.currentUsageWithPrecision, item.currentUsage),
      limit: amount(item.usageLimitWithPrecision, item.usageLimit), ...(resetsAt ? { resetsAt } : {}) });
    const trial = record(item.freeTrialInfo);
    if (trial && active(trial.freeTrialStatus)) {
      const expiresAt = timestamp(trial.freeTrialExpiry);
      push({ id: `${key}:free-trial`, kind: "free-trial", unit, used: amount(trial.currentUsageWithPrecision, trial.currentUsage),
        limit: amount(trial.usageLimitWithPrecision, trial.usageLimit), ...(expiresAt ? { expiresAt } : {}) });
    }
    const bonuses = Array.isArray(item.bonuses) ? item.bonuses.slice(0, 16) : [];
    for (const [bonusIndex, value] of bonuses.entries()) {
      const bonus = record(value);
      if (!bonus || !active(bonus.status)) continue;
      const expiresAt = timestamp(bonus.expiresAt);
      push({ id: `${key}:bonus:${bonusIndex}`, kind: "bonus", unit, name: label(bonus.displayName),
        used: amount(bonus.currentUsageWithPrecision, bonus.currentUsage), limit: amount(bonus.usageLimitWithPrecision, bonus.usageLimit),
        ...(expiresAt ? { expiresAt } : {}) });
    }
    const overages = amount(item.currentOveragesWithPrecision, item.currentOverages);
    if (overages !== null && overages > 0)
      push({ id: `${key}:overage`, kind: "overage", unit, used: overages, limit: amount(item.overageCapWithPrecision, item.overageCap) });
  }
  const status = typeof overage?.overageStatus === "string" ? overage.overageStatus.toUpperCase() : undefined;
  const plan = label(subscription?.subscriptionTitle), type = label(subscription?.type), mail = email(user?.email);
  return { ...(plan ? { plan } : {}), ...(type ? { subscriptionType: type } : {}), ...(mail ? { email: mail } : {}),
    ...(status === "ENABLED" || status === "DISABLED" ? { overageEnabled: status === "ENABLED" } : {}),
    ...(topReset ? { resetsAt: topReset } : {}), buckets };
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new KiroQuotaError("invalid");
  if (Number(response.headers.get("content-length")) > maxBytes) { void response.body.cancel().catch(() => {}); throw new KiroQuotaError("invalid"); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new KiroQuotaError("invalid");
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
  }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new KiroQuotaError("invalid"); }
}

/** One AWS JSON 1.0 POST; enterprise accounts first resolve their own profile (never borrowed or persisted). */
export async function fetchKiroQuota(credential: unknown, signal: AbortSignal, transport: typeof fetch = globalThis.fetch): Promise<KiroQuota> {
  signal.throwIfAborted();
  let account: KiroCredential;
  try { account = validateKiroCredential(credential); } catch { throw new KiroQuotaError("invalid"); }
  if (account.expires <= Date.now()) throw new KiroQuotaError("unauthorized");
  if (account.authMethod === "identity-center" && !account.profileArn) {
    try { account = await resolveKiroProfile(account, signal, transport); }
    catch { signal.throwIfAborted(); throw new KiroQuotaError("profile"); }
  }
  const region = kiroServiceRegion(account);
  let response: Response;
  try {
    response = await transport(`https://q.${region}.amazonaws.com/`, {
      method: "POST", redirect: "error", signal,
      headers: { Authorization: `Bearer ${account.access}`, "Content-Type": "application/x-amz-json-1.0", Accept: "application/json",
        "x-amz-target": "AmazonCodeWhispererService.GetUsageLimits",
        "amz-sdk-invocation-id": randomUUID(), "amz-sdk-request": "attempt=1; max=1" },
      body: JSON.stringify({ origin: "KIRO_CLI", resourceType: "AGENTIC_REQUEST", isEmailRequired: true,
        ...(account.profileArn ? { profileArn: account.profileArn } : {}) }),
    });
  } catch {
    signal.throwIfAborted();
    throw new KiroQuotaError("network");
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    const status = response.status;
    throw new KiroQuotaError(status === 401 ? "unauthorized" : status === 403 ? "forbidden" : status === 429 ? "throttled" : "unavailable", status);
  }
  return parseKiroQuota(await readJson(response, signal));
}
