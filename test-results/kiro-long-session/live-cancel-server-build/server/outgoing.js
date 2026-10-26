const encoded = new WeakMap();
/** Immutable event instances share one serialization across receivers. */
export function encode(value) {
    if (value && typeof value === "object") {
        const cached = encoded.get(value);
        if (cached)
            return cached;
    }
    const payload = JSON.stringify(value), result = { payload, bytes: Buffer.byteLength(payload) };
    if (value && typeof value === "object")
        encoded.set(value, result);
    return result;
}
/** Payload budget B plus one legal large frame H; this is not a fixed process RSS limit. */
export class OutgoingQueue {
    write;
    overflow;
    budget;
    queue = [];
    queuedBytes = 0;
    inFlightBytes = 0;
    ordinaryBytes = 0;
    largeFrames = 0;
    lazyCount = 0;
    closed = false;
    writing = false;
    readBusy = false;
    preferLazy = false;
    readers = [];
    constructor(write, overflow, budget = 4 * 1024 * 1024) {
        this.write = write;
        this.overflow = overflow;
        this.budget = budget;
    }
    account(frame, direction) {
        if (frame.bytes > this.budget)
            this.largeFrames += direction;
        else
            this.ordinaryBytes += direction * frame.bytes;
    }
    fits(frame) {
        return frame.bytes > this.budget ? !this.largeFrames : this.ordinaryBytes + frame.bytes <= this.budget;
    }
    fail() { this.close(); this.overflow(); }
    send(value, key, done, _admittedRead = false, measured) {
        if (this.closed) {
            done?.();
            return;
        }
        // Only intermediate deltas in the trailing segment can merge across no reliable barrier.
        if (key)
            for (let i = this.queue.length - 1; i >= 0; i--) {
                const item = this.queue[i];
                if (!item.key)
                    break;
                if (item.key === key) {
                    this.queuedBytes -= item.frame.bytes;
                    this.account(item.frame, -1);
                    this.queue.splice(i, 1);
                    break;
                }
            }
        const frame = encode(value);
        if (!this.fits(frame)) {
            done?.();
            this.fail();
            return;
        }
        // Materialized frames remain FIFO. A blocked lazy current-state refresh may
        // be deferred, including behind a read response; it captures fresh state later.
        this.queue.push({ frame, key, done, measured, enqueuedAt: measured ? performance.now() : undefined });
        this.account(frame, 1);
        this.queuedBytes += frame.bytes;
        this.drain();
    }
    /** Bounded descriptors only; factory runs synchronously at the actual delivery boundary. */
    lazy(factory) {
        if (this.closed)
            return;
        if (this.lazyCount >= 16) {
            this.fail();
            return;
        }
        this.queue.push({ factory });
        this.lazyCount++;
        this.drain();
    }
    drain() {
        if (this.closed || this.writing)
            return;
        // Give queued reads a turn between writes, even during continuous small deltas.
        this.admit();
        const index = this.queue[0]?.factory && (this.readBusy || this.largeFrames > 0)
            ? this.queue.findIndex(item => !!item.frame) : 0;
        if (index < 0)
            return;
        const next = this.queue.splice(index, 1)[0];
        if (!next)
            return;
        if (next.factory) {
            this.preferLazy = false;
            this.lazyCount--;
            try {
                const value = next.factory();
                if (value === undefined) {
                    this.drain();
                    return;
                }
                next.frame = encode(value);
                if (!this.fits(next.frame)) {
                    this.fail();
                    return;
                }
                this.account(next.frame, 1);
                this.queuedBytes += next.frame.bytes;
            }
            catch {
                this.fail();
                return;
            }
            next.factory = undefined;
        }
        const frame = next.frame, startedAt = next.measured ? performance.now() : 0;
        this.queuedBytes -= frame.bytes;
        this.inFlightBytes = frame.bytes;
        this.writing = true;
        try {
            next.measured?.({ stage: "start", queuedMs: startedAt - next.enqueuedAt, bytes: frame.bytes });
        }
        catch { /* Diagnostics cannot interrupt delivery. */ }
        try {
            this.write(frame.payload, (error) => {
                if (this.closed)
                    return;
                this.account(frame, -1);
                this.inFlightBytes = 0;
                this.writing = false;
                if (error) {
                    this.fail();
                    return;
                }
                try {
                    next.measured?.({ stage: "sent", queuedMs: startedAt - next.enqueuedAt, writeMs: performance.now() - startedAt, bytes: frame.bytes });
                }
                catch { /* Diagnostics cannot interrupt delivery. */ }
                next.done?.();
                this.drain();
            });
        }
        catch {
            this.fail();
        }
    }
    /** Queue descriptors before reading/serializing history. No body is retained while waiting. */
    reserveRead(signal) {
        if (this.closed || signal.aborted)
            return Promise.reject(new Error("读取已取消"));
        if (this.readers.length >= 16)
            return Promise.reject(new Error("历史读取队列已满，请稍后重试"));
        return new Promise((resolve, reject) => {
            const entry = { resolve, reject, signal, abort: () => {
                    const index = this.readers.indexOf(entry);
                    if (index >= 0) {
                        this.readers.splice(index, 1);
                        reject(new Error("读取已取消"));
                    }
                } };
            signal.addEventListener("abort", entry.abort, { once: true });
            this.readers.push(entry);
            this.admit();
        });
    }
    admit() {
        if (this.closed || this.readBusy || this.writing || this.largeFrames || this.preferLazy && this.lazyCount > 0)
            return;
        const next = this.readers.shift();
        if (!next)
            return;
        next.signal.removeEventListener("abort", next.abort);
        this.readBusy = true;
        // Alternate materialization turns when both reads and lazy refreshes wait.
        this.preferLazy = true;
        let active = true;
        next.resolve(() => { if (!active)
            return; active = false; this.readBusy = false; this.drain(); });
    }
    close() {
        this.closed = true;
        this.queue = [];
        this.queuedBytes = 0;
        this.inFlightBytes = 0;
        this.ordinaryBytes = 0;
        this.largeFrames = 0;
        this.lazyCount = 0;
        this.readBusy = false;
        for (const reader of this.readers) {
            reader.signal.removeEventListener("abort", reader.abort);
            reader.reject(new Error("连接已关闭"));
        }
        this.readers = [];
    }
}
//# sourceMappingURL=outgoing.js.map