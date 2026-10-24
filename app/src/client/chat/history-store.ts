import type { ChatMessage } from "../../shared/agent.js";
import type { HistoryIndex, HistoryRead } from "../../shared/history.js";

export interface HistoryRange { loading: boolean; ready: boolean; error: string }
const idle: HistoryRange = { loading: false, ready: false, error: "" };
type Range = { state: HistoryRange; messages: ChatMessage[]; users: number; controller?: AbortController; bytes: number };
/** Per-view bounded archive cache. Neither catalogue nor folded process rows hydrate message bodies. */
export class HistoryStore {
  private state: { index: HistoryIndex | null; loading: boolean; error: string } = { index: null, loading: true, error: "" };
  private listeners = new Set<() => void>();
  private messageListeners = new Map<string, Set<() => void>>();
  private rangeListeners = new Map<string, Set<() => void>>();
  private ranges = new Map<string, Range>();
  private messages = new Map<string, ChatMessage>();
  private controller?: AbortController;
  private generation = 0;
  private disposed = false;
  constructor(private catalogue: (signal: AbortSignal) => Promise<HistoryIndex>,
    private read: (segmentId: string, groupId: string | undefined, signal: AbortSignal) => Promise<HistoryRead>,
    readonly budget = 8 * 1024 * 1024) {}
  snapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  get = (id: string) => this.messages.get(id) ?? null;
  subscribeMessage = (id: string, fn: () => void) => {
    const listeners = this.messageListeners.get(id) ?? new Set(); this.messageListeners.set(id, listeners); listeners.add(fn);
    return () => { listeners.delete(fn); if (!listeners.size) this.messageListeners.delete(id); };
  };
  key = (segmentId: string, groupId?: string) => JSON.stringify([segmentId, groupId]);
  range = (key: string) => this.ranges.get(key)?.state ?? idle;
  subscribeRange = (key: string, fn: () => void) => {
    const listeners = this.rangeListeners.get(key) ?? new Set(); this.rangeListeners.set(key, listeners); listeners.add(fn);
    return () => { listeners.delete(fn); if (!listeners.size) this.rangeListeners.delete(key); };
  };
  private notifyRange(key: string) { this.rangeListeners.get(key)?.forEach(fn => fn()); }
  async refresh(retryRanges = true) {
    this.controller?.abort();
    const controller = this.controller = new AbortController();
    this.state = { ...this.state, loading: true, error: "" }; this.listeners.forEach(fn => fn());
    try {
      const index = await this.catalogue(controller.signal);
      if (this.disposed || this.controller !== controller) return;
      if (index.revision !== this.state.index?.revision) {
        this.generation++;
        const versions = (index: HistoryIndex | null) => new Map(index?.segments.flatMap(segment => [
          [this.key(segment.id), segment.revision] as const,
          ...segment.groups.map(group => [this.key(segment.id, group.id), group.revision] as const),
        ]) ?? []);
        const before = versions(this.state.index), after = versions(index), removed: string[] = [];
        for (const [key, range] of this.ranges) {
          range.controller?.abort();
          if (range.state.ready && before.get(key) && before.get(key) === after.get(key)) continue;
          this.ranges.delete(key); removed.push(key);
        }
        const previous = new Map(this.messages); this.messages.clear();
        for (const range of this.ranges.values()) for (const message of range.messages) this.messages.set(message.id, message);
        for (const [id, message] of previous) if (this.messages.get(id) !== message) this.messageListeners.get(id)?.forEach(fn => fn());
        removed.forEach(key => this.notifyRange(key));
      }
      this.state = { index, loading: false, error: "" };
      // Reconnection or an explicit retry resumes failed/paused mounted reads without evicting good bodies.
      for (const [key, range] of this.ranges) if (retryRanges && range.users && !range.state.ready && !range.state.loading) {
        range.state = idle;
        const [segmentId, groupId] = JSON.parse(key) as [string, string | null];
        void this.load(segmentId, groupId ?? undefined);
      }
    } catch (error) {
      if (this.disposed || this.controller !== controller || controller.signal.aborted) return;
      this.state = { ...this.state, loading: false, error: (error as Error).message };
    }
    this.listeners.forEach(fn => fn());
  }
  acquire(segmentId: string, groupId?: string) {
    const key = this.key(segmentId, groupId);
    let range = this.ranges.get(key);
    if (!range) {
      range = { state: idle, messages: [], users: 0, bytes: 0 }; this.ranges.set(key, range);
    } else { this.ranges.delete(key); this.ranges.set(key, range); }
    range.users++;
    if (!range.state.ready && !range.state.loading && !range.state.error) void this.load(segmentId, groupId);
    return () => { range!.users = Math.max(0, range!.users - 1); this.trim(); };
  }
  async load(segmentId: string, groupId?: string) {
    if (this.disposed) return;
    const key = this.key(segmentId, groupId);
    let range = this.ranges.get(key);
    if (!range) { range = { state: idle, messages: [], users: 0, bytes: 0 }; this.ranges.set(key, range); }
    if (range.state.loading || range.state.ready) return;
    const current = range, generation = this.generation;
    const controller = current.controller = new AbortController();
    current.state = { loading: true, ready: false, error: "" }; this.notifyRange(key);
    try {
      const result = await this.read(segmentId, groupId, controller.signal);
      if (this.disposed || controller.signal.aborted || generation !== this.generation || this.ranges.get(key) !== current || current.controller !== controller) return;
      if (result.revision !== this.state.index?.revision) {
        current.controller = undefined; current.state = { loading: false, ready: false, error: "历史区间已变化，请重新加载" }; this.notifyRange(key);
        await this.refresh(false); return;
      }
      current.messages = result.messages;
      current.bytes = JSON.stringify(result.messages).length * 2;
      for (const message of result.messages) { this.messages.set(message.id, message); this.messageListeners.get(message.id)?.forEach(fn => fn()); }
      current.state = { loading: false, ready: true, error: "" };
    } catch (error) {
      if (this.disposed || generation !== this.generation || controller.signal.aborted) return;
      current.state = { loading: false, ready: false, error: (error as Error).message };
      if ((error as { code?: string }).code === "NOT_FOUND") {
        this.notifyRange(key); await this.refresh(false);
      }
    }
    current.controller = undefined;
    this.notifyRange(key); this.trim();
  }
  private trim() {
    let bytes = [...this.ranges.values()].reduce((sum, range) => sum + range.bytes, 0);
    for (const [key, range] of this.ranges) {
      if (bytes <= this.budget && this.ranges.size <= 128) break;
      if (range.users || range.state.loading) continue;
      this.ranges.delete(key); bytes -= range.bytes;
      for (const message of range.messages) if (![...this.ranges.values()].some(other => other.messages.some(item => item.id === message.id))) this.messages.delete(message.id);
    }
  }
  pause() {
    this.controller?.abort();
    for (const [key, range] of this.ranges) if (range.controller) {
      range.controller.abort(); range.controller = undefined;
      range.state = idle; this.notifyRange(key);
    }
  }
  dispose() { this.disposed = true; this.generation++; this.pause(); this.ranges.forEach(range => range.controller?.abort()); this.ranges.clear(); this.messages.clear(); }
}
