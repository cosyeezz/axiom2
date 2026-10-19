import { DerivedCache } from "./derived-cache.js";
import type { ChatMessage } from "../../shared/agent.js";
import { threadGroups } from "../../shared/thread-layout.js";

/** Owned by one RAW viewing instance. No archive survives dispose(). */
export class OriginalStore {
  readonly derived = new DerivedCache();
  private messages = new Map<string, ChatMessage>();
  private listeners = new Map<string, Set<() => void>>();
  private observers = new Set<() => void>();
  private desired: string | null = null;
  private inFlight = false;
  private disposed = false;
  private retryVersion = 0;
  private controller?: AbortController;
  state = { hasData: false, revision: "", loading: false, error: "", groups: threadGroups([]) };
  constructor(private load: (signal: AbortSignal) => Promise<ChatMessage[]>, private errorText: (error: Error) => string) {}
  get = (id: string) => this.messages.get(id) ?? null;
  snapshot = () => this.state;
  subscribe = (fn: () => void) => { this.observers.add(fn); return () => { this.observers.delete(fn); }; };
  subscribeMessage(id: string, fn: () => void) {
    let group = this.listeners.get(id);
    if (!group) this.listeners.set(id, group = new Set());
    group.add(fn);
    return () => { group!.delete(fn); if (!group!.size) this.listeners.delete(id); };
  }
  private status(patch: Partial<typeof this.state>) {
    this.state = { ...this.state, ...patch };
    this.observers.forEach((fn) => fn());
  }
  request(revision: string) {
    if (this.disposed) return;
    this.desired = revision;
    if (!this.inFlight && (this.state.revision !== revision || !this.state.hasData)) void this.run();
  }
  retry() { if (this.disposed || this.desired === null) return; this.retryVersion++; if (!this.inFlight) void this.run(); }
  pause() { this.desired = null; }
  private async run() {
    if (this.disposed || this.desired === null || this.inFlight) return;
    this.inFlight = true;
    const revision = this.desired, attempt = this.retryVersion;
    this.status({ loading: true, error: "" });
    try {
      this.controller = new AbortController();
      const messages = await this.load(this.controller.signal);
      if (this.disposed || this.desired !== revision) return;
      const next = new Map<string, ChatMessage>();
      const changed = new Set(this.messages.keys());
      for (const message of messages) {
        const previous = this.messages.get(message.id);
        if (previous && JSON.stringify(previous) === JSON.stringify(message)) {
          next.set(message.id, previous); changed.delete(message.id);
        } else { next.set(message.id, message); changed.add(message.id); }
      }
      this.messages = next;
      const groups = threadGroups([...next.values()]);
      this.status({ hasData: true, revision, error: "",
        groups: JSON.stringify(groups) === JSON.stringify(this.state.groups) ? this.state.groups : groups });
      for (const id of changed) this.listeners.get(id)?.forEach((fn) => fn());
    } catch (error) {
      if (!this.disposed && this.desired === revision) this.status({ error: this.errorText(error as Error) });
    } finally {
      this.inFlight = false;
      if (!this.disposed) {
        if (this.desired !== null && (this.desired !== revision || this.retryVersion !== attempt)) void this.run();
        else this.status({ loading: false });
      }
    }
  }
  dispose() {
    this.disposed = true; this.desired = null;
    this.controller?.abort();
    this.derived.clear();
    this.messages.clear(); this.listeners.clear(); this.observers.clear();
    this.state = { hasData: false, revision: "", loading: false, error: "", groups: [] };
  }
}
