import { AppError } from "../../shared/protocol.js";
import { TASK_WINDOW_MEMBERSHIP_ITEMS, type TaskResultMembershipRef, type WindowTaskMembership } from "../../shared/task-window.js";
import type { TaskWindowData, TaskWindowField, TaskWindowQuery, WindowTaskDescriptor, WindowTaskInputDescriptor, WindowTaskInputPage, WindowTaskLocation, WindowTaskPage, WindowTaskResultPage, WindowTaskTarget } from "../../shared/task-window.js";
import type { WindowFieldInfo } from "../../shared/thread-window.js";
import type { WindowFieldData } from "../../shared/window-frame-budget.js";

export type TaskWindowReader = (query: TaskWindowQuery, signal: AbortSignal) => Promise<TaskWindowData>;
export interface TaskErrorChunk { revision: string; ref: string; version: string; text: string; next: number | null; total: number }
export interface TaskFieldChunk extends TaskErrorChunk { field: TaskWindowField }
export interface TaskInspection { revision: string; task: WindowTaskDescriptor | null; input: WindowTaskInputDescriptor | null; inputError: TaskErrorChunk | null }
export interface TaskWindowStatus { page: WindowTaskPage | null; loading: boolean; error: string }
/** Whole-scope activity, never inferred from the loaded tail or stale metadata.
 * An observed active task proves existence; zero requires no unknown statuses. */
export function taskWindowActive(state: TaskWindowStatus): boolean | null {
  if (!state.page || state.page.anchorKey !== null || state.loading || state.error) return null;
  const counts = state.page.counts;
  if (counts.queued + counts.starting + counts.running + counts.stopping > 0) return true;
  return counts.unknown === 0 ? false : null;
}
export interface AnchorFrame {
  page: WindowTaskPage | null;
  rows: readonly { task: WindowTaskDescriptor; revision: string }[];
  previous: number | null;
  loading: boolean;
  error: string;
  /** Metadata freshness only, never transcript/read-receipt readiness. */
  current: boolean;
}
const empty: AnchorFrame = Object.freeze({ page: null, rows: [], previous: null, loading: false, error: "", current: false });
type Entry = { users: number; depth: number; frame: AnchorFrame };
const cancelled = () => new AppError("CANCELLED", "任务读取已取消");

/** One reader per displayed parent scope, shared by ALL cards. Opening a cut per
 * card would evict other cards' two-generation server refs. Partial pages are
 * merged by stable key; only complete selected-collection coverage removes rows.
 * Two physical RPCs at most. No automatic STALE retry loop or legacy full read. */
export class TaskWindowStore {
  private active = true;
  private epoch = 0;
  private controller = new AbortController();
  private root: WindowTaskPage | null = null;
  private readers = 0;
  private state: TaskWindowStatus = { page: null, loading: false, error: "" };
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private pending = 0;
  private queue: { start: () => void; reject: (error: Error) => void }[] = [];
  private busy = new Map<string, Promise<void>>();
  private refreshing: Promise<void> | undefined;
  private dirty = false;
  private invalidated = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly reader: TaskWindowReader, carry?: ReadonlyMap<string, AnchorFrame>) {
    for (const [anchor, frame] of carry ?? []) this.entries.set(anchor, { users: 0, depth: Math.max(1, Math.ceil(frame.rows.length / 64)),
      frame: { ...frame, loading: false, current: false, error: "" } });
  }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  snapshot = (anchor: string): AnchorFrame => this.entries.get(anchor)?.frame ?? empty;
  status = (): TaskWindowStatus => this.state;
  private setStatus(state: TaskWindowStatus) { this.state = state; this.listeners.forEach(fn => fn()); }
  /** Task operations can be visible without a delegate card. They share this cut. */
  acquireReader() {
    this.readers++; let held = true;
    if (this.active && (!this.root || this.invalidated)) void this.refresh();
    return () => { if (held) { held = false; this.readers--; } };
  }
  cached() { return new Map([...this.entries].map(([anchor, entry]) => [anchor, entry.frame])); }
  private publish(anchor: string, change: Partial<AnchorFrame>) {
    const entry = this.entries.get(anchor);
    if (!entry || !this.active) return;
    entry.frame = { ...entry.frame, ...change };
    this.listeners.forEach(fn => fn());
  }
  acquire(anchor: string) {
    const entry = this.entries.get(anchor) ?? { users: 0, depth: 1, frame: empty };
    entry.users++; this.entries.delete(anchor); this.entries.set(anchor, entry);
    if (this.active) {
      if (!this.root || this.invalidated) void this.refresh();
      else if (!entry.frame.current) void this.load(anchor, this.epoch);
    }
    return () => {
      entry.users--;
      for (const [key, old] of this.entries) if (this.entries.size > 64 && !old.users) this.entries.delete(key);
    };
  }
  private valid(epoch: number) { return this.active && epoch === this.epoch && !this.controller.signal.aborted; }
  private drain() { while (this.pending < 2 && this.queue.length) this.queue.shift()!.start(); }
  private request<T extends TaskWindowData>(query: TaskWindowQuery, epoch: number, signal?: AbortSignal): Promise<T> {
    const owned = signal ? AbortSignal.any([this.controller.signal, signal]) : this.controller.signal;
    const valid = () => this.valid(epoch) && !owned.aborted;
    return new Promise((resolve, reject) => {
      const abort = () => rejectRead(cancelled());
      const rejectRead = (error: unknown) => { owned.removeEventListener("abort", abort); reject(error); };
      owned.addEventListener("abort", abort, { once: true });
      this.queue.push({ reject: rejectRead, start: () => {
        if (!valid()) { rejectRead(cancelled()); return; }
        this.pending++;
        Promise.resolve().then(() => {
          if (!valid()) throw cancelled();
          return this.reader(query, owned);
        }).then(data => {
          if (!valid()) throw cancelled();
          owned.removeEventListener("abort", abort); resolve(data as T);
        }, rejectRead).catch(rejectRead).finally(() => { this.pending--; this.drain(); });
      } });
      this.drain();
    });
  }
  /** Refresh hints coalesce; a continuous stream cannot cancel every in-flight
   * page. A failed/stale read requires a new external hint or explicit retry. */
  invalidate() {
    if (!this.active) return;
    // Keep hints received with no demand: a later consumer must reopen the cut,
    // not resurrect a cached frame that happened to be current when detached.
    this.invalidated = true;
    if (this.refreshing) { this.dirty = true; return; }
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.refresh(); }, 200);
  }
  refresh(): Promise<void> {
    if (!this.active || !this.readers && ![...this.entries.values()].some(entry => entry.users)) return Promise.resolve();
    if (this.refreshing) return this.refreshing;
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    const epoch = ++this.epoch;
    this.invalidated = false;
    this.root = null;
    this.setStatus({ page: null, loading: true, error: "" });
    for (const [anchor, entry] of this.entries) this.publish(anchor, { loading: entry.users > 0, current: false, error: "" });
    this.refreshing = (async () => {
      try {
        const root = await this.request<WindowTaskPage>({ op: "open" }, epoch);
        if (root.kind !== "tasks" || root.anchorKey !== null) throw new Error("任务窗口响应不匹配");
        this.root = root;
        this.setStatus({ page: root, loading: false, error: "" });
        await Promise.all([...this.entries].filter(([, entry]) => entry.users).map(([anchor]) => this.load(anchor, epoch)));
      } catch (error) {
        if (this.valid(epoch)) {
          this.setStatus({ page: null, loading: false, error: (error as Error).message });
          for (const [anchor, entry] of this.entries) if (entry.users)
            this.publish(anchor, { loading: false, current: false, error: (error as Error).message });
        }
      }
    })().finally(() => {
      this.refreshing = undefined;
      if (this.dirty) { this.dirty = false; this.invalidate(); }
    });
    return this.refreshing;
  }
  private accept(anchor: string, page: WindowTaskPage, pages: WindowTaskPage[], previous: number | null, replaceCut: boolean) {
    const entry = this.entries.get(anchor)!;
    const rows = new Map<string, { task: WindowTaskDescriptor; revision: string }>();
    // A partial new cut cannot pronounce missing cached rows deleted. Carry them
    // visibly stale until their page arrives or the full anchor is covered.
    if (entry.frame.page?.identityNamespace === page.identityNamespace && !(replaceCut && previous === null))
      for (const row of entry.frame.rows) rows.set(row.task.taskKey, row);
    for (const part of pages) for (const task of part.items) rows.set(task.taskKey, { task, revision: page.revision });
    if (previous === null) for (const [key, row] of rows) if (row.revision !== page.revision) rows.delete(key);
    this.publish(anchor, { page, rows: [...rows.values()].sort((a, b) => a.task.order - b.task.order), previous, loading: false, error: "", current: true });
  }
  private load(anchor: string, epoch: number): Promise<void> {
    const busyKey = `${epoch}:${anchor}`, existing = this.busy.get(busyKey);
    if (existing) return existing;
    const root = this.root, entry = this.entries.get(anchor);
    if (!root || !entry || !this.valid(epoch)) return Promise.resolve();
    this.publish(anchor, { loading: true, error: "" });
    const promise = (async () => {
      try {
        const first = await this.request<WindowTaskPage>({ op: "tasks", revision: root.revision, anchor }, epoch);
        this.checkPage(first, root.revision);
        const pages = [first]; let previous = first.previous;
        for (let depth = 1; depth < entry.depth && previous !== null; depth++) {
          const page = await this.request<WindowTaskPage>({ op: "tasks", revision: root.revision, anchorKey: first.anchorKey!, before: previous, expectedVersion: first.version }, epoch);
          this.checkPage(page, root.revision, first); pages.push(page); previous = page.previous;
        }
        this.accept(anchor, first, pages, previous, true);
      } catch (error) {
        if (this.valid(epoch)) this.publish(anchor, { loading: false, current: false, error: (error as Error).message });
      }
    })().finally(() => { this.busy.delete(busyKey); });
    this.busy.set(busyKey, promise); return promise;
  }
  private checkPage(page: WindowTaskPage, revision: string, first?: WindowTaskPage) {
    if (page.kind !== "tasks" || page.revision !== revision || page.anchorKey === null ||
      first && (page.anchorKey !== first.anchorKey || page.version !== first.version || page.total !== first.total)) throw new Error("任务分页响应不匹配");
  }
  async more(anchor: string) {
    const entry = this.entries.get(anchor), frame = entry?.frame, root = this.root, epoch = this.epoch;
    if (!frame?.current || frame.loading || !frame.page || frame.previous === null || !root || frame.page.revision !== root.revision) return;
    this.publish(anchor, { loading: true, error: "" });
    try {
      const page = await this.request<WindowTaskPage>({ op: "tasks", revision: root.revision, anchorKey: frame.page.anchorKey!, before: frame.previous, expectedVersion: frame.page.version }, epoch);
      this.checkPage(page, root.revision, frame.page);
      entry!.depth++; this.accept(anchor, frame.page, [page], page.previous, false);
    } catch (error) {
      if (this.valid(epoch)) this.publish(anchor, { loading: false, error: (error as Error).message });
    }
  }
  /** All pairs in one current cut, not only loaded rows or outstanding events.
   * Sequential batches leave a shared slot available to other consumers. */
  async hasResults(references: readonly TaskResultMembershipRef[], minimumVersion: number, signal?: AbortSignal): Promise<boolean> {
    const root = this.root, epoch = this.epoch;
    if (!root || !this.valid(epoch) || signal?.aborted || this.state.loading || this.state.error) throw cancelled();
    if (!Number.isSafeInteger(minimumVersion) || minimumVersion < 0 || root.state.resultVersion < minimumVersion) return false;
    for (let offset = 0; offset < references.length; offset += TASK_WINDOW_MEMBERSHIP_ITEMS) {
      const data = await this.request<WindowTaskMembership>({ op: "hasResults", revision: root.revision,
        references: references.slice(offset, offset + TASK_WINDOW_MEMBERSHIP_ITEMS) }, epoch, signal);
      if (data.kind !== "membership" || data.revision !== root.revision || typeof data.matched !== "boolean") throw new Error("任务结果成员响应不匹配");
      if (!data.matched) return false;
    }
    return true;
  }
  /** Resolve legacy task UUID/tN and input UUID against the CURRENT cut. Never
   * use a page position as an action ID or substitute a different task's receipt. */
  async inspect(reference: string, inputReference?: string, withError = false, signal?: AbortSignal): Promise<TaskInspection> {
    const root = this.root, epoch = this.epoch;
    if (!root || !this.valid(epoch)) throw cancelled();
    const located = await this.request<WindowTaskLocation>({ op: "lookup", revision: root.revision, kind: "task", reference }, epoch, signal);
    if (located.kind !== "location" || located.revision !== root.revision) throw new Error("任务定位响应不匹配");
    const at = located.location;
    if (!at) return { revision: root.revision, task: null, input: null, inputError: null };
    if (at.kind !== "task") throw new Error("任务定位响应不匹配");
    const page = await this.request<WindowTaskPage>({ op: "tasks", revision: root.revision, before: at.taskOrder + 1, expectedVersion: root.version }, epoch, signal);
    const task = page.items.find(item => item.ref === at.ref && item.order === at.taskOrder);
    if (page.kind !== "tasks" || page.revision !== root.revision || page.anchorKey !== null || !task) throw new Error("任务描述响应不匹配");
    let input: WindowTaskInputDescriptor | null = null, inputError: TaskErrorChunk | null = null;
    if (inputReference) {
      const found = await this.request<WindowTaskLocation>({ op: "lookup", revision: root.revision, kind: "input", reference: inputReference }, epoch, signal);
      if (found.kind !== "location" || found.revision !== root.revision) throw new Error("任务回执定位响应不匹配");
      const position = found.location;
      if (position?.kind === "input" && position.taskRef === task.ref && position.itemOrder !== null) {
        const inputs = await this.request<WindowTaskInputPage>({ op: "inputs", revision: root.revision, taskRef: task.ref,
          before: position.itemOrder + 1, expectedVersion: task.inputs.version }, epoch, signal);
        if (inputs.kind !== "inputs" || inputs.revision !== root.revision || inputs.taskRef !== task.ref) throw new Error("任务回执响应不匹配");
        input = inputs.items.find(item => item.ref === position.ref && item.order === position.itemOrder) ?? null;
        if (!input) throw new Error("任务回执响应不匹配");
        if (withError && input.hasError) {
          const info = await this.request<WindowFieldInfo>({ op: "fieldInfo", revision: root.revision, entityRef: input.ref, field: "error" }, epoch, signal);
          if (info.kind !== "fieldInfo" || info.revision !== root.revision || info.entityRef !== input.ref || info.field !== "error") throw new Error("错误详情响应不匹配");
          inputError = await this.errorChunk({ revision: root.revision, ref: input.ref, version: info.version, text: "", next: 0, total: info.lengthCU }, signal);
        }
      }
    }
    return { revision: root.revision, task, input, inputError };
  }
  async errorChunk(previous: TaskErrorChunk, signal?: AbortSignal): Promise<TaskErrorChunk> {
    return this.moreField({ ...previous, field: "error" }, signal);
  }
  async field(key: string, field: TaskWindowField, signal?: AbortSignal, previous?: TaskFieldChunk): Promise<TaskFieldChunk> {
    const root = this.root, epoch = this.epoch;
    if (!root || !this.valid(epoch)) throw cancelled();
    const located = await this.request<WindowTaskLocation>({ op: "locate", revision: root.revision, key }, epoch, signal);
    if (located.kind !== "location" || located.revision !== root.revision || !located.location) throw new Error("当前窗口中未找到该内容，请刷新后重试");
    const ref = located.location.ref;
    const info = await this.request<WindowFieldInfo>({ op: "fieldInfo", revision: root.revision, entityRef: ref, field }, epoch, signal);
    if (info.kind !== "fieldInfo" || info.revision !== root.revision || info.entityRef !== ref || info.field !== field) throw new Error("任务正文响应不匹配");
    // A full-field version may rebind an explicitly loaded prefix to a new cut.
    // Descriptor versions or unchanged previews cannot provide this evidence.
    if (previous?.field === field && previous.version === info.version && previous.total === info.lengthCU)
      return { ...previous, ref, revision: root.revision };
    return this.moreField({ revision: root.revision, ref, field, version: info.version, text: "", next: 0, total: info.lengthCU }, signal);
  }
  async results(task: WindowTaskDescriptor, revision: string, before?: number, signal?: AbortSignal): Promise<WindowTaskResultPage> {
    if (!this.root || this.root.revision !== revision) throw cancelled();
    const page = await this.request<WindowTaskResultPage>({ op: "results", revision, taskRef: task.ref, before, expectedVersion: task.results.version }, this.epoch, signal);
    if (page.kind !== "results" || page.revision !== revision || page.taskRef !== task.ref || page.version !== task.results.version || page.total !== task.results.total ||
      page.previous !== null && (page.previous < 0 || page.previous >= (before ?? page.total))) throw new Error("任务交付分页响应不匹配");
    return page;
  }
  async moreField(previous: TaskFieldChunk, signal?: AbortSignal): Promise<TaskFieldChunk> {
    const root = this.root, epoch = this.epoch;
    if (!root || root.revision !== previous.revision || !this.valid(epoch)) throw cancelled();
    if (previous.next === null) return previous;
    const data = await this.request<WindowFieldData>({ op: "field", revision: root.revision, entityRef: previous.ref,
      field: previous.field, expectedVersion: previous.version, offsetCU: previous.next }, epoch, signal);
    const end = data.chunk.offsetCU + data.chunk.text.length;
    if (data.revision !== root.revision || data.entityRef !== previous.ref || data.field !== previous.field || data.chunk.offsetCU !== previous.next ||
      data.chunk.totalLengthCU !== previous.total || end > previous.total ||
      (data.chunk.nextOffsetCU === null ? end !== previous.total : data.chunk.nextOffsetCU !== end || end <= previous.next))
      throw new Error("任务正文分页响应不匹配");
    return { ...previous, text: previous.text + data.chunk.text, next: data.chunk.nextOffsetCU };
  }
  async target(taskKey: string): Promise<string> { return (await this.destination(taskKey)).taskId; }
  async destination(taskKey: string, signal?: AbortSignal): Promise<WindowTaskTarget> {
    const root = this.root, epoch = this.epoch;
    if (!root || !this.valid(epoch)) throw cancelled();
    const located = await this.request<WindowTaskLocation>({ op: "locate", revision: root.revision, key: taskKey }, epoch, signal);
    if (located.kind !== "location" || located.revision !== root.revision || located.location?.kind !== "task") throw new Error("当前窗口中未找到该任务，请刷新后重试");
    const target = await this.request<WindowTaskTarget>({ op: "target", revision: root.revision, taskRef: located.location.ref }, epoch, signal);
    if (target.kind !== "target" || target.revision !== root.revision || target.taskRef !== located.location.ref) throw new Error("任务导航响应不匹配");
    return target;
  }
  dispose() {
    if (!this.active) return;
    // Publish the synchronous disconnect fence before disabling notifications.
    for (const anchor of this.entries.keys()) this.publish(anchor, { loading: false, current: false });
    this.active = false; this.epoch++; this.root = null; this.controller.abort();
    this.setStatus({ page: null, loading: false, error: "" });
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined; this.dirty = false;
    for (const job of this.queue.splice(0)) job.reject(cancelled());
    this.listeners.clear();
  }
}
