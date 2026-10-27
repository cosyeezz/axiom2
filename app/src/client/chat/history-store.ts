import type { ChatMessage } from "../../shared/agent.js";
import type { HistoryIndex, HistoryRead } from "../../shared/history.js";
import { historyReadQueue } from "./history-read-queue.js";

export interface HistoryRange { loading: boolean; ready: boolean; error: string }
const idle: HistoryRange = { loading: false, ready: false, error: "" };
type Range = { state: HistoryRange; messages: ChatMessage[]; users: number; controller?: AbortController; bytes: number;
  started?: boolean; cancelTimer?: ReturnType<typeof setTimeout>; retryAfter?: number; retryTimer?: ReturnType<typeof setTimeout> };
export interface CachedHistory {
  index: HistoryIndex;
  ranges: [string, { messages: ChatMessage[]; bytes: number }][];
  bytes: number;
}
/** Per-view bounded archive cache. Neither catalogue nor folded process rows hydrate message bodies. */
export class HistoryStore {
  private state: { index: HistoryIndex | null; loading: boolean; error: string } = { index: null, loading: true, error: "" };
  private listeners = new Set<() => void>();
  private messageListeners = new Map<string, Set<() => void>>();
  private rangeListeners = new Map<string, Set<() => void>>();
  private ranges = new Map<string, Range>();
  private messages = new Map<string, ChatMessage>();
  // Bounded hand-off snapshots, not successful archive ranges: reads still
  // validate the archive and replace these with authoritative body data.
  private remembered = new Map<string, { message: ChatMessage; bytes: number }>();
  private rememberedBytes = 0;
  private controller?: AbortController;
  private generation = 0;
  private disposed = false;
  private paused = false;
  constructor(private catalogue: (signal: AbortSignal) => Promise<HistoryIndex>,
    private read: (segmentId: string, groupId: string | undefined, signal: AbortSignal) => Promise<HistoryRead>,
    readonly budget = 8 * 1024 * 1024, cached?: CachedHistory) {
    if (cached) {
      this.state = { index: cached.index, loading: false, error: "" };
      for (const [key, range] of cached.ranges) {
        this.ranges.set(key, { ...range, state: { loading: false, ready: true, error: "" }, users: 0 });
        for (const message of range.messages) this.messages.set(message.id, message);
      }
      this.trim();
    }
  }
  /** Transfer only successful, revision-checked data, never consumers or pending work. */
  cached(): CachedHistory | undefined {
    if (!this.state.index) return;
    const ranges: CachedHistory["ranges"] = [...this.ranges].filter(([, range]) => range.state.ready)
      .map(([key, range]) => [key, { messages: range.messages, bytes: range.bytes }]);
    return { index: this.state.index, ranges,
      bytes: ranges.reduce((sum, [, range]) => sum + range.bytes, JSON.stringify(this.state.index).length * 2) };
  }
  snapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  get = (id: string) => this.messages.get(id) ?? this.remembered.get(id)?.message ?? null;
  remember = (message: ChatMessage) => {
    if (this.disposed || this.messages.has(message.id) || this.remembered.get(message.id)?.message === message) return;
    const bytes = message.streaming ? 0 : JSON.stringify(message).length * 2, budget = Math.min(this.budget, 2 * 1024 * 1024);
    const previous = this.remembered.get(message.id);
    this.rememberedBytes -= previous?.bytes ?? 0;
    this.remembered.delete(message.id);
    const keep = !message.streaming && bytes <= budget;
    if (keep) { this.remembered.set(message.id, { message, bytes }); this.rememberedBytes += bytes; }
    // A newer uncachable snapshot must invalidate an older remembered body.
    if (keep || previous) this.messageListeners.get(message.id)?.forEach(fn => fn());
    while (this.rememberedBytes > budget || this.remembered.size > 128) {
      const [id, value] = this.remembered.entries().next().value!;
      this.remembered.delete(id); this.rememberedBytes -= value.bytes;
      this.messageListeners.get(id)?.forEach(fn => fn());
    }
  };
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
    if (this.disposed) return;
    this.paused = false;
    this.controller?.abort();
    const controller = this.controller = new AbortController();
    this.state = { ...this.state, loading: true, error: "" }; this.listeners.forEach(fn => fn());
    try {
      const index = await this.catalogue(controller.signal);
      if (this.disposed || controller.signal.aborted || this.controller !== controller) return;
      if (index.revision !== this.state.index?.revision) {
        this.generation++;
        const messageVersions = (value: HistoryIndex | null) => new Map(value?.segments.flatMap(segment => [
          [segment.id, segment.revision ?? value.revision] as const,
          ...segment.groups.flatMap(group => group.ids.map(id => [id, group.revision ?? segment.revision ?? value.revision] as const)),
        ]) ?? []);
        const oldMessages = messageVersions(this.state.index), newMessages = messageVersions(index);
        for (const [id, value] of this.remembered) if (oldMessages.has(id) && oldMessages.get(id) !== newMessages.get(id)) {
          this.remembered.delete(id); this.rememberedBytes -= value.bytes;
          this.messageListeners.get(id)?.forEach(fn => fn());
        }
        const versions = (index: HistoryIndex | null) => new Map(index?.segments.flatMap(segment => [
          [this.key(segment.id), segment.revision] as const,
          ...segment.groups.map(group => [this.key(segment.id, group.id), group.revision] as const),
        ]) ?? []);
        const before = versions(this.state.index), after = versions(index), removed: string[] = [];
        for (const [key, range] of this.ranges) {
          clearTimeout(range.cancelTimer); clearTimeout(range.retryTimer);
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
    clearTimeout(range.cancelTimer);
    if (!range.state.ready && !range.state.loading && !range.state.error) void this.load(segmentId, groupId);
    else this.scheduleRetry(key, range);
    return () => {
      range!.users = Math.max(0, range!.users - 1);
      if (!range!.users) {
        clearTimeout(range!.retryTimer); range!.retryTimer = undefined;
        // Brief recycling should keep an in-flight read. Queued work has no
        // body to save and must immediately yield to the new viewport.
        if (range!.controller) {
          if (range!.started) range!.cancelTimer = setTimeout(() => {
            if (!range!.users) { this.cancel(key, range!); this.trim(); }
          }, 120);
          else this.cancel(key, range!);
        }
      }
      this.trim();
    };
  }
  private scheduleRetry(key: string, range: Range) {
    if (!range.retryAfter || range.retryTimer || !range.users || this.paused || this.disposed || this.ranges.get(key) !== range) return;
    range.retryTimer = setTimeout(() => {
      range.retryTimer = undefined;
      if (!range.users || this.paused || this.disposed || this.ranges.get(key) !== range) return;
      const [segmentId, groupId] = JSON.parse(key) as [string, string | null];
      void this.load(segmentId, groupId ?? undefined);
    }, Math.max(0, range.retryAfter - Date.now()));
  }
  private cancel(key: string, range: Range) {
    clearTimeout(range.cancelTimer);
    range.controller?.abort(); range.controller = undefined; range.started = false;
    if (range.state.loading) { range.state = idle; this.notifyRange(key); }
  }
  async load(segmentId: string, groupId?: string) {
    if (this.disposed || this.paused) return;
    const key = this.key(segmentId, groupId);
    let range = this.ranges.get(key);
    if (!range) { range = { state: idle, messages: [], users: 0, bytes: 0 }; this.ranges.set(key, range); }
    if (range.state.loading || range.state.ready) return;
    const current = range, generation = this.generation;
    const controller = current.controller = new AbortController();
    current.started = false; current.retryAfter = undefined;
    clearTimeout(current.retryTimer); current.retryTimer = undefined;
    current.state = { loading: true, ready: false, error: "" }; this.notifyRange(key);
    try {
      const result = await historyReadQueue.run(controller.signal, () => {
        current.started = true; return this.read(segmentId, groupId, controller.signal);
      });
      if (this.disposed || controller.signal.aborted || generation !== this.generation || this.ranges.get(key) !== current || current.controller !== controller) return;
      if (result.revision !== this.state.index?.revision) {
        current.controller = undefined; current.state = { loading: false, ready: false, error: "历史区间已变化，请重新加载" }; this.notifyRange(key);
        await this.refresh(false); return;
      }
      current.messages = result.messages;
      current.bytes = JSON.stringify(result.messages).length * 2;
      for (const message of result.messages) {
        this.messages.set(message.id, message);
        const remembered = this.remembered.get(message.id);
        if (remembered) { this.remembered.delete(message.id); this.rememberedBytes -= remembered.bytes; }
        this.messageListeners.get(message.id)?.forEach(fn => fn());
      }
      current.state = { loading: false, ready: true, error: "" };
    } catch (error) {
      if (this.disposed || generation !== this.generation || controller.signal.aborted) return;
      current.state = { loading: false, ready: false, error: (error as Error).message };
      // A transport admission limit is temporary, not a permanently failed body.
      if (current.state.error.includes("历史读取队列已满")) current.retryAfter = Date.now() + 300;
      if ((error as { code?: string }).code === "NOT_FOUND") {
        this.notifyRange(key); await this.refresh(false);
      }
    }
    clearTimeout(current.cancelTimer); current.started = false; current.controller = undefined;
    this.scheduleRetry(key, current);
    this.notifyRange(key); this.trim();
  }
  private trim() {
    const removed = new Set<string>(), removedMessages = new Set<string>();
    let bytes = [...this.ranges.values()].reduce((sum, range) => sum + range.bytes, 0);
    for (const [key, range] of this.ranges) {
      if (bytes <= this.budget && this.ranges.size <= 128) break;
      if (range.users || range.state.loading) continue;
      this.ranges.delete(key); bytes -= range.bytes; removed.add(key);
      for (const message of range.messages) if (![...this.ranges.values()].some(other => other.messages.some(item => item.id === message.id))) {
        this.messages.delete(message.id);
        const remembered = this.remembered.get(message.id);
        if (remembered) { this.remembered.delete(message.id); this.rememberedBytes -= remembered.bytes; }
        removedMessages.add(message.id);
      }
    }
    removed.forEach(key => this.notifyRange(key));
    removedMessages.forEach(id => this.messageListeners.get(id)?.forEach(fn => fn()));
  }
  pause() {
    this.paused = true;
    this.controller?.abort();
    for (const [key, range] of this.ranges) {
      clearTimeout(range.retryTimer); range.retryTimer = undefined;
      if (range.controller) this.cancel(key, range);
    }
  }
  dispose() { this.disposed = true; this.generation++; this.pause(); this.ranges.forEach(range => range.controller?.abort()); this.ranges.clear(); this.messages.clear(); this.remembered.clear(); this.rememberedBytes = 0; }
}
