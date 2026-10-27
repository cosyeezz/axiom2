import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";
import type { Credential, OAuthCredential } from "@earendil-works/pi-ai";
import { usageRefreshMinimum, usageRefreshJitter, type ProviderUsage } from "../shared/provider-usage.js";
import { ProviderUsageCache, type UsageCacheEntry } from "./provider-usage-cache.js";
import { modelProxyRevision } from "./integrations/model-proxy-env.js";
import { openAIUsageRestriction, queryOpenAIUsage } from "./providers/openai-usage.js";

type UsageAdapter = {
  query: (providerId: string, credential: OAuthCredential, signal: AbortSignal) => Promise<ProviderUsage>;
  local?: (providerId: string, credential: OAuthCredential) => ProviderUsage | undefined;
};
const openAIAdapter: UsageAdapter = { query: queryOpenAIUsage, local: openAIUsageRestriction };
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
    return unavailable(providerId, "OAuth 令牌已过期；使用模型刷新认证或重新登录后再试。" );
  return adapter.local?.(providerId, credential) ?? adapter.query(providerId, credential, signal);
}

export class ProviderUsageService {
  private cache = new Map<string, UsageCacheEntry>();
  private pending = new Map<string, Promise<ProviderUsage>>();
  private disk: ProviderUsageCache;
  constructor(private root: string, private dir: string,
    private query: (providerId: string, signal: AbortSignal) => Promise<ProviderUsage>) { this.disk = new ProviderUsageCache(root, dir); }
  private clear(providerId: string) { this.cache.delete(providerId); this.disk.delete(providerId); }
  private restriction(providerId: string, state: ReturnType<ProviderUsageService["snapshot"]>): ProviderUsage | undefined {
    if (state.credential?.type !== "oauth" || !Number.isFinite(state.credential.expires) || state.credential.expires <= Date.now())
      return unavailable(providerId, state.credential?.type === "oauth"
        ? "OAuth 令牌已过期；使用模型刷新认证或重新登录后再试。" : "请先完成 OAuth 登录。");
    return adapters.get(providerId)?.local?.(providerId, state.credential);
  }
  private snapshot(providerId: string) {
    const credential = readStoredCredential(providerId, join(this.dir, "auth.json"));
    let config = "missing";
    try { config = readFileSync(join(this.dir, "models.json"), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    // Cache identity includes credential rotation/logout, saved routing and live built-in proxy state.
    const key = createHash("sha256").update(JSON.stringify([providerId, credential, config, modelProxyRevision(this.root)])).digest("hex");
    return { credential, key };
  }
  async read(providerId: string, refresh = false, cancellation?: AbortSignal): Promise<ProviderUsage> {
    cancellation?.throwIfAborted();
    if (!supportsProviderUsage(providerId)) return { providerId, status: "unsupported", metrics: [] };
    let state: ReturnType<ProviderUsageService["snapshot"]>;
    try { state = this.snapshot(providerId); }
    catch { return unavailable(providerId, "无法读取本地认证或供应商配置。" ); }
    const local = this.restriction(providerId, state);
    if (local) { this.clear(providerId); return local; }
    const memory = this.cache.get(providerId), now = Date.now();
    const old = memory?.key === state.key && memory.checkedAt <= now ? memory : this.disk.read(providerId, state.key, now);
    if (old) this.cache.set(providerId, old); else this.cache.delete(providerId);
    const scheduled = (entry: UsageCacheEntry): ProviderUsage => ({ ...entry.value, nextRefreshAt: entry.nextRefreshAt });
    if (old && (refresh ? now - old.checkedAt < 5_000 : now < old.nextRefreshAt || old.value.refreshable === false || old.value.status === "unsupported")) return scheduled(old);
    const pendingKey = `${providerId}:${state.key}`;
    const existing = this.pending.get(pendingKey);
    if (existing) return existing;
    // Single-flight lifetime is independent of any one viewer; each upstream attempt is bounded.
    const signal = AbortSignal.timeout(10_000);
    const promise = (async () => {
      let value: ProviderUsage;
      try { value = await this.query(providerId, signal); }
      catch { value = unavailable(providerId, signal.aborted
        ? "额度查询超时，请检查供应商代理后重试。"
        : "额度查询失败，请检查供应商代理或稍后重试。" ); }
      try {
        const latest = this.snapshot(providerId), restricted = this.restriction(providerId, latest);
        // Natural expiry need not change the identity hash; recheck it after every network attempt too.
        if (restricted) { this.clear(providerId); return restricted; }
        if (latest.key !== state.key) return unavailable(providerId, "认证或代理配置已改变，请刷新额度。" );
      } catch { return unavailable(providerId, "认证或供应商配置已改变，请刷新额度。" ); }
      if (value.status === "unavailable" && value.refreshable !== false && old?.key === state.key && old.value.updatedAt)
        value = { ...old.value, stale: true, message: value.message };
      const checkedAt = Date.now(), nextRefreshAt = checkedAt + usageRefreshMinimum + Math.floor(Math.random() * (usageRefreshJitter + 1));
      const entry = { key: state.key, value, checkedAt, nextRefreshAt };
      this.cache.set(providerId, entry);
      this.disk.write(providerId, entry);
      return scheduled(entry);
    })().finally(() => this.pending.delete(pendingKey));
    this.pending.set(pendingKey, promise);
    return promise;
  }
}
