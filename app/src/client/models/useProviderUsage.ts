import { useEffect, useRef, useState } from "react";
import { command, useConnectionState } from "../transport.js";
import { usageRefreshJitter, usageRefreshMinimum, type ProviderUsage as Usage, type UsageModelPricing } from "../../shared/provider-usage.js";

export type ProviderUsageQuery = {
  providerId: string; revision: string; pricingProviderId?: string; accountId?: string; enabled?: boolean; cached?: Usage;
  /** Account cards read the cache by default, gate on account status and never poll. */
  accountLayout?: boolean;
};

/** Request lifecycle shared by the provider summary and account cards; rendering lives with each caller. */
export function useProviderUsage({ providerId, revision, pricingProviderId = providerId, accountId, enabled = true, cached, accountLayout = false }: ProviderUsageQuery) {
  const { connected, generation } = useConnectionState();
  const [queried, setUsage] = useState<Usage>();
  const [pricing, setPricing] = useState<UsageModelPricing[]>([]);
  const [busy, setBusy] = useState(false), [sampleRevision, setSampleRevision] = useState(0);
  const refreshAction = useRef<() => void>(() => {});
  useEffect(() => {
    if (!connected || !enabled || cached) { setBusy(false); return; }
    let disposed = false, running = false, poll = true, nextAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const minimum = accountId ? 60_000 : usageRefreshMinimum, jitter = accountId ? 10_000 : usageRefreshJitter;
    const fallbackDeadline = () => Date.now() + minimum + Math.floor(Math.random() * (jitter + 1));
    const schedule = () => {
      clearTimeout(timer); timer = undefined;
      if (!disposed && poll) timer = setTimeout(() => {
        timer = undefined;
        // Hidden views do not fetch. Becoming visible will catch up once, never replay missed cycles.
        if (document.visibilityState === "visible") void read(false);
      }, Math.max(1, nextAt - Date.now()));
    };
    const read = async (force: boolean) => {
      if (disposed || running) return;
      running = true; clearTimeout(timer); setBusy(true);
      try {
        const response = await command<Usage>(accountId ? "accounts.usage" : "usage.provider", { providerId, ...(accountId ? { accountId } : {}), refresh: force, ...(accountLayout && !force ? { cache: true } : {}) }, {}, crypto.randomUUID(), controller.signal);
        const result: Usage = accountLayout && !response.accountStatus && response.status !== "unsupported" && response.refreshable !== false
          ? { ...response, status: "unavailable", metrics: [], account: undefined, updatedAt: undefined, stale: undefined,
            accountStatus: { state: "unknown", checkedAt: Date.now() }, message: "账号状态无法确认，已停止后续查询；请重试。" }
          : response;
        if (!disposed && result.providerId === providerId) {
          setUsage(result); if (force) setSampleRevision(value => value + 1);
          // Account cards read the cache by default and never poll; only a manual refresh reaches upstream again.
          poll = !accountLayout && result.refreshable !== false && result.status !== "unsupported" && result.accountStatus?.state !== "disabled" && result.accountStatus?.state !== "unauthorized";
          if ((result.accountStatus?.state === "active" || !accountLayout && !result.accountStatus) && result.metrics.some(metric => metric.kind === "tokens")) {
            const prices = await command<UsageModelPricing[]>("usage.pricing", { providerId: pricingProviderId }, {}, crypto.randomUUID(), controller.signal).catch(() => []);
            if (!disposed) setPricing(prices);
          } else setPricing([]);
          nextAt = Number.isFinite(result.nextRefreshAt) && result.nextRefreshAt! > Date.now()
            ? Math.min(result.nextRefreshAt!, Date.now() + minimum + jitter) : fallbackDeadline();
        }
      } catch {
        if (accountLayout) poll = false;
        nextAt = fallbackDeadline();
        if (!disposed) setUsage(previous => accountLayout
          ? { providerId, status: "unavailable", metrics: [], accountStatus: { state: "unknown", checkedAt: Date.now() }, message: "账号状态无法确认，已停止后续查询；请重试。" }
          : previous?.updatedAt ? { ...previous, stale: true, message: "刷新失败，当前为上次查询结果。" }
          : { providerId, status: "unavailable", metrics: [], message: "额度暂不可用，请稍后重试。" });
      } finally {
        running = false;
        if (!disposed) { if (nextAt <= Date.now()) nextAt = fallbackDeadline(); setBusy(false); schedule(); }
      }
    };
    const visible = () => { if (document.visibilityState === "visible" && poll) { if (nextAt <= Date.now()) void read(false); else schedule(); } };
    refreshAction.current = () => { void read(true); };
    if (document.visibilityState === "visible") void read(false);
    document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; refreshAction.current = () => {}; controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [providerId, accountId, pricingProviderId, revision, connected, generation, enabled, !!cached, accountLayout]);
  return { usage: cached ?? queried, pricing, busy, sampleRevision, connected, refresh: () => refreshAction.current() };
}
