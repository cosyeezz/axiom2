export type Payload = { payload: string; bytes: number };
const encoded = new WeakMap<object, Payload>();
/** Immutable event instances share one serialization across receivers. */
export function encode(value: unknown): Payload {
  if (value && typeof value === "object") {
    const cached = encoded.get(value);
    if (cached) return cached;
  }
  const payload = JSON.stringify(value), result = { payload, bytes: Buffer.byteLength(payload) };
  if (value && typeof value === "object") encoded.set(value, result);
  return result;
}
type Entry = { frame?: Payload; factory?: () => unknown; key?: string; done?: () => void };

/** Payload budget B plus one legal large frame H; this is not a fixed process RSS limit. */
export class OutgoingQueue {
  private queue: Entry[] = [];
  queuedBytes = 0;
  inFlightBytes = 0;
  private ordinaryBytes = 0;
  private largeFrames = 0;
  private lazyCount = 0;
  private closed = false;
  private writing = false;
  private readBusy = false;
  private readers: { resolve: (release: () => void) => void; reject: (error: Error) => void; signal: AbortSignal; abort: () => void }[] = [];
  constructor(private write: (payload: string, done: (error?: Error) => void) => void,
    private overflow: () => void, readonly budget = 4 * 1024 * 1024) {}
  private account(frame: Payload, direction: 1 | -1) {
    if (frame.bytes > this.budget) this.largeFrames += direction;
    else this.ordinaryBytes += direction * frame.bytes;
  }
  private fits(frame: Payload) {
    return frame.bytes > this.budget ? !this.largeFrames : this.ordinaryBytes + frame.bytes <= this.budget;
  }
  private fail() { this.close(); this.overflow(); }
  send(value: unknown, key?: string, done?: () => void, admittedRead = false) {
    if (this.closed) { done?.(); return; }
    // Only intermediate deltas in the trailing segment can merge across no reliable barrier.
    if (key) for (let i = this.queue.length - 1; i >= 0; i--) {
      const item = this.queue[i];
      if (!item.key) break;
      if (item.key === key) {
        this.queuedBytes -= item.frame!.bytes; this.account(item.frame!, -1);
        this.queue.splice(i, 1); break;
      }
    }
    const frame = encode(value);
    if (!this.fits(frame)) { done?.(); this.fail(); return; }
    const entry = { frame, key, done };
    // A reserved read already owns the materialization slot. Its response completes
    // before a later lazy current-state snapshot; the snapshot captures after release.
    const barrier = admittedRead ? this.queue.findIndex((item) => item.factory) : -1;
    if (barrier < 0) this.queue.push(entry); else this.queue.splice(barrier, 0, entry);
    this.account(frame, 1); this.queuedBytes += frame.bytes; this.drain();
  }
  /** Bounded descriptors only; factory runs synchronously at the actual delivery boundary. */
  lazy(factory: () => unknown) {
    if (this.closed) return;
    if (this.lazyCount >= 16) { this.fail(); return; }
    this.queue.push({ factory }); this.lazyCount++; this.drain();
  }
  private drain() {
    if (this.closed || this.writing || this.readBusy && this.queue[0]?.factory) return;
    const next = this.queue.shift();
    if (!next) { this.admit(); return; }
    if (next.factory) {
      this.lazyCount--;
      try {
        const value = next.factory();
        if (value === undefined) { this.drain(); return; }
        next.frame = encode(value);
        if (!this.fits(next.frame)) { this.fail(); return; }
        this.account(next.frame, 1); this.queuedBytes += next.frame.bytes;
      } catch { this.fail(); return; }
      next.factory = undefined;
    }
    const frame = next.frame!;
    this.queuedBytes -= frame.bytes; this.inFlightBytes = frame.bytes; this.writing = true;
    try {
      this.write(frame.payload, (error) => {
        if (this.closed) return;
        this.account(frame, -1); this.inFlightBytes = 0; this.writing = false;
        if (error) { this.fail(); return; }
        next.done?.(); this.drain();
      });
    } catch { this.fail(); }
  }
  /** Queue descriptors before reading/serializing history. No body is retained while waiting. */
  reserveRead(signal: AbortSignal): Promise<() => void> {
    if (this.closed || signal.aborted) return Promise.reject(new Error("读取已取消"));
    if (this.readers.length >= 16) return Promise.reject(new Error("历史读取队列已满，请稍后重试"));
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, signal, abort: () => {
        const index = this.readers.indexOf(entry);
        if (index >= 0) { this.readers.splice(index, 1); reject(new Error("读取已取消")); }
      } };
      signal.addEventListener("abort", entry.abort, { once: true });
      this.readers.push(entry); this.admit();
    });
  }
  private admit() {
    if (this.closed || this.readBusy || this.writing || this.queue.length) return;
    const next = this.readers.shift();
    if (!next) return;
    next.signal.removeEventListener("abort", next.abort);
    this.readBusy = true;
    let active = true;
    next.resolve(() => { if (!active) return; active = false; this.readBusy = false; this.drain(); });
  }
  close() {
    this.closed = true; this.queue = []; this.queuedBytes = 0; this.inFlightBytes = 0;
    this.ordinaryBytes = 0; this.largeFrames = 0; this.lazyCount = 0; this.readBusy = false;
    for (const reader of this.readers) {
      reader.signal.removeEventListener("abort", reader.abort); reader.reject(new Error("连接已关闭"));
    }
    this.readers = [];
  }
}
