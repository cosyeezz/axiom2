/** Access-ordered, bounded cache. Eviction never writes or deletes persistent data. */
export class Lru<K, V> extends Map<K, V> {
  constructor(readonly capacity: number) { super(); if (capacity < 1) throw Error("Invalid capacity"); }
  override get(key: K): V | undefined {
    if (!super.has(key)) return undefined;
    const value = super.get(key)!;
    super.delete(key); super.set(key, value);
    return value;
  }
  override set(key: K, value: V): this {
    super.delete(key); super.set(key, value);
    while (this.size > this.capacity) super.delete(this.keys().next().value!);
    return this;
  }
}
