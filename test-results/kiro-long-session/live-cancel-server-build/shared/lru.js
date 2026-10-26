/** Access-ordered, bounded cache. Eviction never writes or deletes persistent data. */
export class Lru extends Map {
    capacity;
    constructor(capacity) {
        super();
        this.capacity = capacity;
        if (capacity < 1)
            throw Error("Invalid capacity");
    }
    peek(key) { return super.get(key); }
    get(key) {
        if (!super.has(key))
            return undefined;
        const value = super.get(key);
        super.delete(key);
        super.set(key, value);
        return value;
    }
    set(key, value) {
        super.delete(key);
        super.set(key, value);
        while (this.size > this.capacity)
            super.delete(this.keys().next().value);
        return this;
    }
}
//# sourceMappingURL=lru.js.map