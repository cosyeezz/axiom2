/** Bound command admission across views; cancelled off-screen work never occupies a slot. */
export class HistoryReadQueue {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(readonly concurrency = 2) {}
  run<T>(signal: AbortSignal, read: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let started = false, settled = false;
      const finish = (commit: () => void) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        if (started) this.active--;
        else this.waiting = this.waiting.filter(item => item !== start);
        commit(); queueMicrotask(() => this.drain());
      };
      const abort = () => finish(() => reject(new Error("读取已取消")));
      const start = () => {
        started = true; this.active++;
        try { read().then(value => finish(() => resolve(value)), error => finish(() => reject(error))); }
        catch (error) { finish(() => reject(error)); }
      };
      if (signal.aborted) { abort(); return; }
      signal.addEventListener("abort", abort, { once: true });
      this.waiting.push(start); this.drain();
    });
  }
  private drain() {
    while (this.active < this.concurrency && this.waiting.length) this.waiting.shift()!();
  }
}
export const historyReadQueue = new HistoryReadQueue();
