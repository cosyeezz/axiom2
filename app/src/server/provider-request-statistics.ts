import { performance } from "node:perf_hooks";
import type { ProviderRequestEvent, ProviderRequestStatistics } from "../shared/provider-requests.js";

type Row = { current: number; peak: number; callLevel: boolean; recent: { at: number; count: number }[]; head: number; rpm: number };
/** Passive counters only. No timers, admission, credentials, payloads or persistence. */
export class ProviderRequestTracker {
  private readonly startedAt = Date.now();
  private readonly providers = new Map<string, Row>();
  private readonly owners = new Map<string, Map<string, string>>();
  constructor(private readonly clock = () => performance.now()) {}
  observe(owner: string, event: ProviderRequestEvent) {
    if (event.type !== "provider_request_stat" || typeof event.id !== "string" || !event.id || event.id.length > 160) return;
    if (event.phase === "end") {
      const requests = this.owners.get(owner), provider = requests?.get(event.id);
      if (provider === undefined) return;
      requests!.delete(event.id);
      if (!requests!.size) this.owners.delete(owner);
      this.providers.get(provider)!.current--;
    } else if (event.phase === "start" && typeof event.provider === "string" && event.provider && event.provider.length <= 256 &&
        (event.precision === "http" || event.precision === "call")) {
      const requests = this.owners.get(owner) ?? new Map<string, string>();
      if (requests.has(event.id)) return;
      this.owners.set(owner, requests); requests.set(event.id, event.provider);
      const row = this.providers.get(event.provider) ?? { current: 0, peak: 0, callLevel: false, recent: [], head: 0, rpm: 0 };
      this.providers.set(event.provider, row);
      const now = Math.floor(this.clock()); this.prune(row, now);
      row.current++; row.peak = Math.max(row.peak, row.current); row.rpm++;
      row.callLevel ||= event.precision === "call";
      const last = row.recent.at(-1);
      if (last?.at === now) last.count++;
      else row.recent.push({ at: now, count: 1 });
    }
  }
  /** A dead worker cannot leave phantom requests; late ends are harmless. */
  releaseOwner(owner: string) {
    const requests = this.owners.get(owner);
    if (!requests) return;
    for (const provider of requests.values()) this.providers.get(provider)!.current--;
    this.owners.delete(owner);
  }
  snapshot(): ProviderRequestStatistics {
    const now = Math.floor(this.clock());
    return { startedAt: this.startedAt, updatedAt: Date.now(), providers: [...this.providers].map(([providerId, row]) => {
      this.prune(row, now);
      return { providerId, current: row.current, peak: row.peak, rpm: row.rpm, callLevel: row.callLevel };
    }) };
  }
  private prune(row: Row, now: number) {
    // Exact rolling (now - 60s, now], not a calendar-minute rate or startup extrapolation.
    while (row.head < row.recent.length && row.recent[row.head].at <= now - 60_000) row.rpm -= row.recent[row.head++].count;
    if (row.head && row.head * 2 >= row.recent.length) { row.recent = row.recent.slice(row.head); row.head = 0; }
  }
}
