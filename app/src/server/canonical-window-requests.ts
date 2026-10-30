import { randomUUID } from "node:crypto";
import type { Reply } from "../shared/protocol.js";
import { windowFieldErrorReceipt, type WindowFrameErrorCode } from "../shared/window-frame-budget.js";
import { WINDOW_PAGE_MAX_JSON_BYTES } from "../shared/thread-window.js";

type Request = { type: "window-read"; queryId: string; requestId: string; query: unknown };
type Pending = { requestId: string; resolve: (frame: Reply) => void; delivered: boolean; timer: NodeJS.Timeout; cleanup: () => void };
const failure = (requestId: unknown, code: WindowFrameErrorCode) => windowFieldErrorReceipt(requestId, code).frame;

/** One broker per fixed run/lease. The caller owns run/lease gates on BOTH send
 * and reply. Abort/timeouts stop delivery but retain the physical in-flight slot
 * until reply or owner close; cancelling repeatedly cannot flood worker IPC.
 */
export class CanonicalWindowRequests {
  private pending = new Map<string, Pending>();
  private closed = false;
  constructor(private readonly send: (request: Request) => void, private readonly current: () => boolean,
    private readonly timeoutMs = 10_000) {}
  private valid() { try { return !this.closed && this.current(); } catch { return false; } }
  read(requestId: string, query: unknown, signal?: AbortSignal): Promise<Reply> {
    if (typeof requestId !== "string" || requestId.length < 1 || requestId.length > 200 || requestId.trim() !== requestId || requestId.includes("\0"))
      return Promise.resolve(failure(requestId, "INVALID_REQUEST_ID"));
    if (!this.valid() || signal?.aborted) return Promise.resolve(failure(requestId, "STALE"));
    if (this.pending.size >= 2) return Promise.resolve(failure(requestId, "UNAVAILABLE"));
    try { if (Buffer.byteLength(JSON.stringify(query)) > 16 * 1024) return Promise.resolve(failure(requestId, "INVALID_REFERENCE")); }
    catch { return Promise.resolve(failure(requestId, "INVALID_REFERENCE")); }
    const queryId = randomUUID();
    return new Promise(resolve => {
      const deliver = (frame: Reply) => { if (!item.delivered) { item.delivered = true; resolve(frame); } };
      const abort = () => deliver(failure(requestId, "STALE"));
      const item: Pending = { requestId, resolve: deliver, delivered: false,
        timer: setTimeout(() => { item.cleanup(); deliver(failure(requestId, "UNAVAILABLE")); }, this.timeoutMs),
        cleanup: () => signal?.removeEventListener("abort", abort) };
      this.pending.set(queryId, item);
      signal?.addEventListener("abort", abort, { once: true });
      try { this.send({ type: "window-read", queryId, requestId, query }); }
      catch { this.pending.delete(queryId); clearTimeout(item.timer); item.cleanup(); deliver(failure(requestId, "UNAVAILABLE")); }
    });
  }
  accept(queryId: unknown, frame: unknown): boolean {
    if (typeof queryId !== "string") return false;
    const item = this.pending.get(queryId);
    if (!item) return false;
    this.pending.delete(queryId); clearTimeout(item.timer); item.cleanup();
    if (!this.valid()) { item.resolve(failure(item.requestId, "STALE")); return true; }
    try {
      const reply = frame as Reply;
      if (!reply || reply.type !== "receipt" || reply.requestId !== item.requestId || typeof reply.ok !== "boolean" ||
        Buffer.byteLength(JSON.stringify(reply)) > WINDOW_PAGE_MAX_JSON_BYTES) throw Error();
      // Failed producer messages are normalized again, not forwarded as raw diagnostics.
      item.resolve(reply.ok ? reply : failure(item.requestId, reply.error?.code as WindowFrameErrorCode));
    } catch { item.resolve(failure(item.requestId, "UNAVAILABLE")); }
    return true;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const item of this.pending.values()) {
      clearTimeout(item.timer); item.cleanup(); item.resolve(failure(item.requestId, "STALE"));
    }
    this.pending.clear();
  }
}
