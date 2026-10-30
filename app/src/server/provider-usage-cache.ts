import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { costParts, type CostPart } from "../shared/costs.js";
import { usageRefreshMinimum, usageRefreshJitter, type ProviderUsage, type ProviderUsageMetric } from "../shared/provider-usage.js";
export type UsageCacheEntry = { key: string; value: ProviderUsage; checkedAt: number; nextRefreshAt: number };
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown, limit = 160): value is string => typeof value === "string" && value.length <= limit;
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const date = (value: unknown): value is number => number(value) && value > 0 && value <= 8.64e15;
const canonical = (path: string) => { try { return realpathSync(path); } catch { return resolve(path); } };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

/** Reconstruct the public DTO field-by-field; never persist credentials, unknown fields or raw responses. */
export function publicUsage(input: unknown, providerId: string): ProviderUsage | undefined {
  const value = object(input);
  if (!value || value.providerId !== providerId || !["ready", "unavailable", "unsupported"].includes(value.status as string) || !Array.isArray(value.metrics) || value.metrics.length > 128) return;
  const metrics: ProviderUsageMetric[] = [];
  for (const input of value.metrics) {
    const metric = object(input);
    if (!metric || !text(metric.id) || !text(metric.label, 512)) return;
    const common = { id: metric.id, label: metric.label };
    if (metric.kind === "window") {
      if (metric.usedPercent !== null && !number(metric.usedPercent)) return;
      metrics.push({ ...common, kind: "window", usedPercent: metric.usedPercent as number | null,
        ...(number(metric.windowSeconds) ? { windowSeconds: metric.windowSeconds } : {}), ...(date(metric.resetsAt) ? { resetsAt: metric.resetsAt } : {}),
        ...(typeof metric.allowed === "boolean" ? { allowed: metric.allowed } : {}), ...(typeof metric.limitReached === "boolean" ? { limitReached: metric.limitReached } : {}) });
    } else if (metric.kind === "count") {
      if (metric.count !== null && !number(metric.count)) return;
      metrics.push({ ...common, kind: "count", count: metric.count as number | null, ...(date(metric.expiresAt) ? { expiresAt: metric.expiresAt } : {}),
        ...(Array.isArray(metric.expiries) ? { expiries: metric.expiries.filter(date).sort((a, b) => a - b).slice(0, 64) } : {}) });
    } else if (metric.kind === "tokens") {
      if (!text(metric.model) || !metric.model || metric.used !== null && !number(metric.used) || metric.remaining !== null && !number(metric.remaining) || metric.part !== undefined && !costParts.includes(metric.part as CostPart)) return;
      metrics.push({ ...common, kind: "tokens", model: metric.model, used: metric.used as number | null, remaining: metric.remaining as number | null, ...(metric.part !== undefined ? { part: metric.part as CostPart } : {}) });
    } else if (metric.kind === "balance") {
      if (metric.balance !== null && !(text(metric.balance, 512) && /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(metric.balance))) return;
      metrics.push({ ...common, kind: "balance", balance: metric.balance as string | null, ...(typeof metric.unlimited === "boolean" ? { unlimited: metric.unlimited } : {}), ...(typeof metric.hasCredits === "boolean" ? { hasCredits: metric.hasCredits } : {}) });
    } else return;
  }
  const result: ProviderUsage = { providerId, status: value.status as ProviderUsage["status"], metrics,
    ...(date(value.updatedAt) ? { updatedAt: value.updatedAt } : {}), ...(typeof value.stale === "boolean" ? { stale: value.stale } : {}),
    ...(text(value.message, 2048) ? { message: value.message } : {}), ...(typeof value.refreshable === "boolean" ? { refreshable: value.refreshable } : {}) };
  const accountStatus = object(value.accountStatus);
  if (value.accountStatus !== undefined) {
    if (!accountStatus || !["active", "disabled", "unauthorized", "unknown"].includes(accountStatus.state as string) || !date(accountStatus.checkedAt)) return;
    result.accountStatus = { state: accountStatus.state as NonNullable<ProviderUsage["accountStatus"]>["state"], checkedAt: accountStatus.checkedAt };
    if (accountStatus.state !== "active") { result.status = "unavailable"; result.metrics = []; delete result.stale; }
  }
  const account = object(value.account);
  if (account) {
    const email = text(account.email, 254) && /^[^\s@<>\x00-\x1f\x7f]+@[^\s@<>\x00-\x1f\x7f]+\.[^\s@<>\x00-\x1f\x7f]+$/.test(account.email) ? account.email : undefined;
    const plan = text(account.plan, 64) && /^[a-zA-Z0-9_-]+$/.test(account.plan) ? account.plan : undefined;
    const accountId = text(account.accountId, 160) && /^[a-zA-Z0-9._:-]+$/.test(account.accountId) ? account.accountId : undefined;
    const subscriptionExpiresAt = date(account.subscriptionExpiresAt) ? account.subscriptionExpiresAt : undefined;
    if (email || plan || accountId || subscriptionExpiresAt) result.account = { ...(email ? { email } : {}), ...(plan ? { plan } : {}),
      ...(accountId ? { accountId } : {}), ...(subscriptionExpiresAt ? { subscriptionExpiresAt } : {}) };
  }
  const management = object(value.management);
  if (management && text(management.label, 160) && text(management.url, 2048)) {
    try {
      const url = new URL(management.url);
      if (url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash) result.management = { label: management.label, url: url.href };
    } catch { /* Invalid optional links are omitted. */ }
  }
  return result;
}

/** Best-effort private, disposable cache, separate from every authentication/configuration directory. */
export class ProviderUsageCache {
  private root: string;
  private namespace: string;
  constructor(root: string, dir: string, private minimum = usageRefreshMinimum, private jitter = usageRefreshJitter) {
    this.root = canonical(root);
    this.namespace = digest(JSON.stringify([this.root, canonical(dir)]));
  }
  private folder(create: boolean) {
    const base = join(this.root, "model-usage-cache"), folder = join(base, this.namespace);
    for (const path of [base, folder]) {
      if (create) { try { mkdirSync(path, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; } }
      const stat = lstatSync(path);
      if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== "win32" && (stat.mode & 0o077) !== 0 || realpathSync(path) !== path) throw Error("Unsafe cache directory");
    }
    return folder;
  }
  private safeFile(path: string) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || process.platform !== "win32" && (stat.mode & 0o077) !== 0) throw Error("Unsafe cache file");
    return stat;
  }
  read(providerId: string, key: string, now: number): UsageCacheEntry | undefined {
    let file: number | undefined;
    try {
      const path = join(this.folder(false), `${digest(providerId)}.json`);
      const before = this.safeFile(path);
      if (before.size > 256 * 1024) return;
      file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = fstatSync(file);
      if (stat.ino !== before.ino || stat.dev !== before.dev || stat.nlink !== 1 || !stat.isFile() || stat.size !== before.size) return;
      const bytes = Buffer.alloc(stat.size + 1);
      let length = 0, count = 0;
      while (length < bytes.length && (count = readSync(file, bytes, length, bytes.length - length, null))) length += count;
      const after = this.safeFile(path), end = fstatSync(file);
      if (length !== stat.size || end.size !== stat.size || end.mtimeMs !== stat.mtimeMs || after.ino !== stat.ino || after.dev !== stat.dev) return;
      const stored = object(JSON.parse(bytes.subarray(0, length).toString("utf8")));
      if (!stored || stored.version !== 1 || stored.key !== key || !/^[a-f0-9]{64}$/.test(key) || !date(stored.checkedAt) || !date(stored.nextRefreshAt)) return;
      if (stored.checkedAt > now || stored.nextRefreshAt - stored.checkedAt < this.minimum || stored.nextRefreshAt - stored.checkedAt > this.minimum + this.jitter) return;
      const value = publicUsage(stored.value, providerId);
      if (!value || value.updatedAt && value.updatedAt > stored.checkedAt || value.accountStatus && value.accountStatus.checkedAt > stored.checkedAt) return;
      return { key, value, checkedAt: stored.checkedAt, nextRefreshAt: stored.nextRefreshAt };
    } catch { return; }
    finally { if (file !== undefined) { try { closeSync(file); } catch { /* Disposable cache. */ } } }
  }
  write(providerId: string, entry: UsageCacheEntry) {
    let temporary: string | undefined;
    try {
      const value = publicUsage(entry.value, providerId);
      if (!value) return;
      const folder = this.folder(true), path = join(folder, `${digest(providerId)}.json`);
      try { this.safeFile(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") return; }
      temporary = join(folder, `.${randomUUID()}.tmp`);
      writeFileSync(temporary, JSON.stringify({ version: 1, key: entry.key, value, checkedAt: entry.checkedAt, nextRefreshAt: entry.nextRefreshAt }), { flag: "wx", mode: 0o600 });
      if (this.folder(false) !== folder) return;
      // Recheck before replacing: never unlink an alias of an auth/config file.
      try { this.safeFile(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") return; }
      renameSync(temporary, path); temporary = undefined;
    } catch { /* Cache I/O must never make a read-only upstream query fail. */ }
    finally { if (temporary) { try { unlinkSync(temporary); } catch { /* Best effort. */ } } }
  }
  delete(providerId: string) {
    try { const path = join(this.folder(false), `${digest(providerId)}.json`); this.safeFile(path); unlinkSync(path); } catch { /* No cache or unsafe alias: leave untouched. */ }
  }
}
