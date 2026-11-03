import { randomUUID } from "node:crypto";
import { webReadLimits } from "../../shared/web-read.js";
import { sameLease, type LeaseRef } from "../execution-protocol.js";
import { WebReadService, type WebOwner } from "./service.js";

/** Separate from task RPC. The sender is captured per call, never rebound to a replacement run. */
export class WebReadClient {
  private pending = new Map<string, { finish: (error?: Error, data?: unknown) => void; cancel: () => void }>();
  get size() { return this.pending.size; }
  call(send: (value: unknown) => void, callId: string, params: unknown, signal?: AbortSignal, timeoutMs = webReadLimits.timeoutMs + 2000) {
    return new Promise<unknown>((resolve, reject) => {
      const key = randomUUID();
      const finish = (error?: Error, data?: unknown) => {
        if (!this.pending.delete(key)) return;
        clearTimeout(timer); signal?.removeEventListener("abort", cancel);
        error ? reject(error) : resolve(data);
      };
      const cancel = () => { try { send({ type: "web-cancel", key }); } catch { /* Disconnected sender. */ } finish(Error("Web read cancelled or timed out; no automatic retry was made.")); };
      const timer = setTimeout(cancel, timeoutMs);
      this.pending.set(key, { finish, cancel });
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
      else try { send({ type: "web-call", key, callId, params }); } catch { finish(Error("Web reader host is unavailable.")); }
    });
  }
  reply(value: { key: string; ok: boolean; data?: unknown }) {
    this.pending.get(value.key)?.finish(value.ok ? undefined : Error("Web reader request was rejected by its host."), value.data);
  }
  clear() { for (const item of [...this.pending.values()]) item.cancel(); }
}

export class WebReadHost {
  private pending = new Map<string, { owner: WebOwner; lease: LeaseRef; controller: AbortController }>();
  constructor(private readonly admission: (owner: WebOwner) => LeaseRef | undefined,
    private readonly reply: (owner: WebOwner, value: Record<string, unknown>) => void,
    readonly service = new WebReadService()) {}
  private key(owner: WebOwner, key: string) { return JSON.stringify([owner.workspaceId, owner.sessionId, owner.runId, key]); }
  handle(owner: WebOwner, event: any) {
    if (event.type !== "web-call" && event.type !== "web-cancel") return false;
    if (typeof event.key !== "string" || event.key.length > 100 || !event.key) return true;
    const key = this.key(owner, event.key);
    const lease = this.admission(owner);
    if (!lease || !sameLease(lease, event.lease)) return true;
    if (event.type === "web-cancel") { this.pending.get(key)?.controller.abort(); return true; }
    if (this.pending.has(key)) return true;
    if (this.pending.size >= 16) { this.reply(owner, { type: "web-reply", key: event.key, ok: false }); return true; }
    const entry = { owner, lease, controller: new AbortController() };
    this.pending.set(key, entry);
    const current = () => this.pending.get(key) === entry && !entry.controller.signal.aborted && sameLease(this.admission(owner), lease);
    void this.service.read(owner, event.params, entry.controller.signal, current).then(data => {
      if (current()) this.reply(owner, { type: "web-reply", key: event.key, ok: true, data });
    }).catch(() => {
      if (current()) this.reply(owner, { type: "web-reply", key: event.key, ok: false });
    }).finally(() => { if (this.pending.get(key) === entry) this.pending.delete(key); });
    return true;
  }
  end(owner: WebOwner) {
    for (const [key, entry] of this.pending) if (entry.owner.workspaceId === owner.workspaceId && entry.owner.sessionId === owner.sessionId && entry.owner.runId === owner.runId) {
      entry.controller.abort(); this.pending.delete(key);
    }
    this.service.releaseRun(owner);
  }
  close() { for (const entry of this.pending.values()) entry.controller.abort(); this.pending.clear(); this.service.close(); }
}
