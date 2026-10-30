/** Snapshot-local LRU. Serialized values bound retained data and isolate response mutations. */
export class UsageQueryCache<T extends object> {
  private entries = new Map<string, string>();
  private bytes = 0;
  constructor(private readonly maxEntries = 8, private readonly maxBytes = 1024 * 1024) {}
  get(key: string): T | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key); this.entries.set(key, value);
    return JSON.parse(value) as T;
  }
  set(key: string, value: T) {
    const encoded = JSON.stringify(value), bytes = Buffer.byteLength(encoded);
    const previous = this.entries.get(key);
    if (previous !== undefined) { this.bytes -= Buffer.byteLength(previous); this.entries.delete(key); }
    if (bytes > this.maxBytes || this.maxEntries < 1) return;
    this.entries.set(key, encoded); this.bytes += bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value!;
      this.bytes -= Buffer.byteLength(this.entries.get(oldest)!); this.entries.delete(oldest);
    }
  }
  clear() { this.entries.clear(); this.bytes = 0; }
}
