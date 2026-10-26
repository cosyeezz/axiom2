import { createContext } from "react";
import { Lru } from "../../shared/lru.js";
/** Pure parser products only: never React nodes, DOM, authorization or callbacks. */
export class DerivedCache {
  private values = new Map<string, { value: unknown; bytes: number }>();
  bytes = 0;
  constructor(readonly maxBytes = 2 * 1024 * 1024, readonly maxEntries = 128) {}
  get<T>(key: string, create: () => T): T {
    const saved = this.values.get(key);
    if (saved) { this.values.delete(key); this.values.set(key, saved); return saved.value as T; }
    const value = create();
    const bytes = 2 * (key.length + JSON.stringify(value).length);
    if (bytes <= this.maxBytes) {
      while (this.values.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
        const oldest = this.values.keys().next().value!;
        this.bytes -= this.values.get(oldest)!.bytes; this.values.delete(oldest);
      }
      this.values.set(key, { value, bytes }); this.bytes += bytes;
    }
    return value;
  }
  clear() { this.values.clear(); this.bytes = 0; }
}
const sessions = new Lru<string, DerivedCache>(5);
export function sessionDerivedCache(key: string) {
  let cache = sessions.get(key);
  if (!cache) sessions.set(key, cache = new DerivedCache());
  return cache;
}
export const DerivedContext = createContext<DerivedCache | null>(null);
