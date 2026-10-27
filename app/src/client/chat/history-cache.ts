import type { CachedHistory } from "./history-store.js";

// Matches the transport session cache so returning within 20 sessions skips history reads.
export const HISTORY_CACHE_ENTRIES = 20, HISTORY_CACHE_BYTES = 64 * 1024 * 1024;
/** Detached data only: a returning pane always gets a fresh store and subscriptions. */
export class HistoryCache {
  private entries = new Map<string, CachedHistory>();
  bytes = 0;
  constructor(readonly maxBytes = HISTORY_CACHE_BYTES, readonly maxEntries = HISTORY_CACHE_ENTRIES) {}
  get(key: string) {
    const entry = this.entries.get(key);
    if (entry) { this.entries.delete(key); this.entries.set(key, entry); }
    return entry;
  }
  set(key: string, entry: CachedHistory | undefined) {
    const previous = this.entries.get(key);
    if (previous) { this.bytes -= previous.bytes; this.entries.delete(key); }
    if (!entry || entry.bytes > this.maxBytes) return;
    this.entries.set(key, entry); this.bytes += entry.bytes;
    while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(oldest)!.bytes; this.entries.delete(oldest);
    }
  }
}
export const historyCache = new HistoryCache();
