import { randomUUID } from "node:crypto";
import { webSearchLimits } from "../../shared/web-search.js";
import { sameLease, type LeaseRef } from "../execution-protocol.js";
import type { WebOwner } from "./service.js";
import { WebSearchService } from "./search-service.js";

export class WebSearchClient {
  private pending = new Map<string, { finish: (error?: Error, data?: unknown) => void; cancel: () => void; progress?: (text: string) => void }>();
  get size() { return this.pending.size; }
  call(send: (value: unknown) => void, callId: string, params: unknown, signal?: AbortSignal, progress?: (text: string) => void, timeoutMs = webSearchLimits.timeoutMs + 4000) {
    return new Promise<unknown>((resolve, reject) => {
      const key = randomUUID();
      const finish = (error?: Error, data?: unknown) => {
        if (!this.pending.delete(key)) return;
        clearTimeout(timer); signal?.removeEventListener("abort", cancel); error ? reject(error) : resolve(data);
      };
      const cancel = () => { try { send({ type: "web-search-cancel", key }); } catch { /* disconnected */ } finish(Error("Google search cancelled or timed out.")); };
      const timer = setTimeout(cancel, timeoutMs);
      this.pending.set(key, { finish, cancel, progress }); signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
      else try { send({ type: "web-search-call", key, callId, params }); } catch { finish(Error("Google search host is unavailable.")); }
    });
  }
  reply(value: { type: string; key: string; ok?: boolean; data?: unknown; text?: string }) {
    if (value.type === "web-search-progress") { this.pending.get(value.key)?.progress?.(String(value.text ?? "").slice(0, 1000)); return; }
    this.pending.get(value.key)?.finish(value.ok ? undefined : Error("Google search request was rejected by its host."), value.data);
  }
  clear() { for (const item of [...this.pending.values()]) item.cancel(); }
}
export class WebSearchHost {
  private pending = new Map<string, { owner: WebOwner; controller: AbortController }>();
  constructor(private admission: (owner: WebOwner) => LeaseRef | undefined,
    private reply: (owner: WebOwner, value: Record<string, unknown>) => void, readonly service: WebSearchService) {}
  handle(owner: WebOwner, event: any) {
    if (event.type !== "web-search-call" && event.type !== "web-search-cancel") return false;
    if (typeof event.key !== "string" || !event.key || event.key.length > 100) return true;
    const lease = this.admission(owner);
    if (!lease || !sameLease(lease, event.lease)) return true;
    const key = JSON.stringify([owner.workspaceId, owner.sessionId, owner.runId, event.key]);
    if (event.type === "web-search-cancel") { this.pending.get(key)?.controller.abort(); return true; }
    if (this.pending.has(key)) return true;
    if (this.pending.size >= 8) { this.reply(owner, { type: "web-search-reply", key: event.key, ok: false }); return true; }
    const entry = { owner, controller: new AbortController() }; this.pending.set(key, entry);
    const current = () => this.pending.get(key) === entry && !entry.controller.signal.aborted && sameLease(lease, this.admission(owner));
    void this.service.search(owner, event.params, entry.controller.signal, current,
      text => { if (current()) this.reply(owner, { type: "web-search-progress", key: event.key, text }); }).then(data => {
        if (current()) this.reply(owner, { type: "web-search-reply", key: event.key, ok: true, data });
      }).catch(() => { if (current()) this.reply(owner, { type: "web-search-reply", key: event.key, ok: false }); })
      .finally(() => { if (this.pending.get(key) === entry) this.pending.delete(key); });
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
