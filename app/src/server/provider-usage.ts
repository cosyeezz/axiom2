import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { modelCredentialRevision, readModelCredential } from "./model-account-storage.js";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";
import type { Credential, OAuthCredential } from "@earendil-works/pi-ai";
import { usageRefreshMinimum, usageRefreshJitter, type ProviderUsage } from "../shared/provider-usage.js";
import { ProviderUsageCache, publicUsage, type UsageCacheEntry } from "./provider-usage-cache.js";
import { hasQuotaRecord } from "../shared/session-account-usage.js";
import { modelProxyRevision } from "./integrations/model-proxy-env.js";
import { queryOpenAIUsage } from "./providers/openai-usage.js";

type UsageAdapter = {
  query: (providerId: string, credential: OAuthCredential, signal: AbortSignal) => Promise<ProviderUsage>;
};
const openAIAdapter: UsageAdapter = { query: queryOpenAIUsage };
// Add providers here, not to the page or the generic renderer. Unsupported providers make no request.
const adapters: ReadonlyMap<string, UsageAdapter> = new Map([["openai", openAIAdapter], ["openai-codex", openAIAdapter]]);
export const supportsProviderUsage = (providerId: string) => adapters.has(providerId);
const unavailable = (providerId: string, message: string): ProviderUsage => ({ providerId, status: "unavailable", metrics: [], message });

/** Read stored OAuth only: never rotate tokens or call getAuth while an execution snapshot is bound. */
export async function queryProviderUsage(providerId: string, credential: Credential | undefined, signal: AbortSignal): Promise<ProviderUsage> {
  signal.throwIfAborted();
  const adapter = adapters.get(providerId);
  if (!adapter) return { providerId, status: "unsupported", metrics: [] };
  if (credential?.type !== "oauth") return unavailable(providerId, "请先完成 OAuth 登录。" );
  if (!Number.isFinite(credential.expires) || credential.expires <= Date.now())
    return { ...unavailable(providerId, "OAuth 令牌已过期，已停止后续查询；重新登录后再试。"), accountStatus: { state: "unauthorized", checkedAt: Date.now() } };
  return adapter.query(providerId, credential, signal);
}

export class ProviderUsageService {
  private cache = new Map<string, UsageCacheEntry>();
  private pending = new Map<string, Promise<ProviderUsage>>();
  private disk: ProviderUsageCache;
  constructor(private root: string, private dir: string,
    private query: (providerId: string, signal: AbortSignal) => Promise<ProviderUsage>,
    private modelsPath = join(dir, "models.json"), private directAccount = false,
    private timing: { cacheDir?: string; minimum?: number; jitter?: number } = {}) {
    this.disk = new ProviderUsageCache(root, timing.cacheDir ?? dir, timing.minimum, timing.jitter);
  }
  private clear(providerId: string) { this.cache.delete(providerId); this.disk.delete(providerId); }
  /** Another viewer/service may have checked this same identity more recently. Memory cannot hide its rejection. */
  private cached(providerId: string, key: string, now: number): UsageCacheEntry | undefined {
    const memory = this.cache.get(providerId), saved = this.disk.read(providerId, key, now);
    const local = memory?.key === key && memory.checkedAt <= now ? memory : undefined;
    if (!local) return saved;
    if (!saved || local.checkedAt > saved.checkedAt) return local;
    if (local.checkedAt === saved.checkedAt && local.value.accountStatus?.state !== "active") return local;
    return saved;
  }
  private restriction(providerId: string, state: ReturnType<ProviderUsageService["snapshot"]>): ProviderUsage | undefined {
    if (state.credential?.type !== "oauth" || !Number.isFinite(state.credential.expires) || state.credential.expires <= Date.now())
      return { ...unavailable(providerId, state.credential?.type === "oauth"
        ? "OAuth 令牌已过期，已停止后续查询；重新登录后再试。" : "请先完成 OAuth 登录。"), accountStatus: { state: "unauthorized", checkedAt: Date.now() } };
    return undefined;
  }
  private snapshot(providerId: string) {
    const credential = (this.directAccount ? readStoredCredential : readModelCredential)(providerId, join(this.dir, "auth.json"));
    let config = "missing";
    try { config = readFileSync(this.modelsPath, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    // Cache identity includes credential rotation/logout, saved routing and live built-in proxy state.
    const key = createHash("sha256").update(JSON.stringify(["account-status-gate-v3", providerId, credential, config, modelProxyRevision(this.root)])).digest("hex");
    return { credential, key, config };
  }
  /** Eligibility probe: never queries, refreshes auth, mutates caches or creates cache directories. */
  peekCached(providerId: string, expectedCredentialKey?: string, expectedConfiguration?: string): ProviderUsage | undefined {
    if (!supportsProviderUsage(providerId)) return;
    try {
      const state = this.snapshot(providerId), now = Date.now();
      if (expectedCredentialKey !== undefined && modelCredentialRevision(state.credential) !== expectedCredentialKey ||
          expectedConfiguration !== undefined && state.config !== expectedConfiguration) return;
      if (state.credential?.type !== "oauth" || !Number.isFinite(state.credential.expires) || state.credential.expires <= now) return;
      const old = this.cached(providerId, state.key, now);
      const value = old && publicUsage(old.value, providerId);
      if (old && value?.accountStatus?.state === "active" && hasQuotaRecord(value, now)) {
        // A different process can replace auth/config while disk cache is read.
        // Revalidate the actual snapshot, not only the caller's earlier credential.
        const latest = this.snapshot(providerId);
        if (latest.key !== state.key || latest.credential?.type !== "oauth" || latest.credential.expires <= Date.now()) return;
        return { ...value, nextRefreshAt: old.nextRefreshAt, stale: value.stale || now >= old.nextRefreshAt };
      }
    } catch { /* Unknown/unsafe credentials or identity mismatches hide the shortcut, leaving all files untouched. */ }
  }
  /** `preferCache` returns any same-identity cache regardless of age; only an explicit refresh or a missing cache queries upstream. */
  async read(providerId: string, refresh = false, cancellation?: AbortSignal, preferCache = false): Promise<ProviderUsage> {
    cancellation?.throwIfAborted();
    if (!supportsProviderUsage(providerId)) return { providerId, status: "unsupported", metrics: [] };
    let state: ReturnType<ProviderUsageService["snapshot"]>;
    try { state = this.snapshot(providerId); }
    catch { return unavailable(providerId, "无法读取本地认证或供应商配置。" ); }
    const local = this.restriction(providerId, state);
    if (local) { this.clear(providerId); return local; }
    const now = Date.now(), old = this.cached(providerId, state.key, now);
    if (old) this.cache.set(providerId, old); else this.cache.delete(providerId);
    const scheduled = (entry: UsageCacheEntry): ProviderUsage => ({ ...entry.value, nextRefreshAt: entry.nextRefreshAt });
    if (old && (refresh ? now - old.checkedAt < 5_000 : preferCache || now < old.nextRefreshAt || old.value.refreshable === false || old.value.status === "unsupported")) return scheduled(old);
    const pendingKey = `${providerId}:${state.key}`;
    const existing = this.pending.get(pendingKey);
    if (existing) return existing;
    // Single-flight lifetime is independent of any one viewer; each upstream attempt is bounded.
    const signal = AbortSignal.timeout(10_000);
    const promise = (async () => {
      let value: ProviderUsage;
      try { value = await this.query(providerId, signal); }
      catch { value = { ...unavailable(providerId, signal.aborted
        ? "账号状态或额度查询超时，已停止后续操作；请检查供应商代理后重试。"
        : "账号状态无法确认，已停止后续操作；请检查供应商代理或稍后重试。"), accountStatus: { state: "unknown", checkedAt: Date.now() } }; }
      try {
        const latest = this.snapshot(providerId), restricted = this.restriction(providerId, latest);
        // Natural expiry need not change the identity hash; recheck it after every network attempt too.
        if (restricted) { this.clear(providerId); return restricted; }
        if (latest.key !== state.key) return unavailable(providerId, "认证或代理配置已改变，请刷新额度。" );
      } catch { return unavailable(providerId, "认证或供应商配置已改变，请刷新额度。" ); }
      if (value.status === "unavailable" && value.accountStatus?.state === "active" && value.refreshable !== false && old?.key === state.key && old.value.updatedAt)
        value = { ...old.value, accountStatus: value.accountStatus, ...(value.account ? { account: value.account } : {}), stale: true, message: value.message };
      const checkedAt = Date.now(), nextRefreshAt = checkedAt + (this.timing.minimum ?? usageRefreshMinimum) + Math.floor(Math.random() * ((this.timing.jitter ?? usageRefreshJitter) + 1));
      const entry = { key: state.key, value, checkedAt, nextRefreshAt };
      this.cache.set(providerId, entry);
      this.disk.write(providerId, entry);
      return scheduled(entry);
    })().finally(() => this.pending.delete(pendingKey));
    this.pending.set(pendingKey, promise);
    return promise;
  }
}
