import { AppError } from "../../shared/protocol.js";
import type { SessionListCursor, SessionListGroup, SessionListInitial, SessionListPage } from "../../shared/session-list.js";

export interface SessionListReader {
  initial(workspaceId: string, query: string, signal: AbortSignal): Promise<SessionListInitial>;
  page(workspaceId: string, group: SessionListGroup, query: string, cursor: SessionListCursor | null, signal: AbortSignal): Promise<SessionListPage>;
}
export interface SessionListFrame {
  readonly page: SessionListPage | null;
  readonly cursor: SessionListCursor | null;
  /** Navigation metadata only: previously visited rows are not retained. */
  readonly previous: readonly (SessionListCursor | null)[];
  readonly loading: boolean;
  readonly error: Error | null;
}
export interface SessionListState {
  readonly top: SessionListFrame;
  readonly workspace: SessionListFrame;
  readonly revision: number | null;
  readonly loading: boolean;
  readonly error: Error | null;
}
type InitialRead = { controller: AbortController; dirty: boolean; promise: Promise<void> };
type PageRead = { controller: AbortController; epoch: number };
const emptyFrame = (page: SessionListPage | null = null): SessionListFrame => ({ page, cursor: null, previous: [], loading: false, error: null });
const asError = (error: unknown) => error instanceof Error ? error : new Error(String(error));

/** One workspace/query/connection lifetime. The owner disposes this instance on
 * context changes; no selection or React state is inferred from a partial page. */
export class SessionListPages {
  private state: SessionListState = { top: emptyFrame(), workspace: emptyFrame(), revision: null, loading: false, error: null };
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  private epoch = 0;
  private initial?: InitialRead;
  private reads: Partial<Record<SessionListGroup, PageRead>> = {};

  constructor(private readonly reader: SessionListReader, readonly workspaceId: string, readonly query = "", private readonly continuous = false,
    private readonly initialDepth: Partial<Record<SessionListGroup, number>> = {}) {}

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(state: SessionListState) {
    this.state = state;
    this.listeners.forEach(listener => listener());
  }
  private frame(group: SessionListGroup, frame: SessionListFrame) { this.update({ ...this.state, [group]: frame }); }

  /** Call on every invalidation delivery, even when its metadata revision is
   * unchanged. Bursts coalesce into one following refresh. The promise covers
   * the active read, not an indefinitely dirty stream of subsequent reads. */
  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.initial) { this.initial.dirty = true; return this.initial.promise; }
    ++this.epoch;
    for (const read of Object.values(this.reads)) read.controller.abort();
    this.reads = {};
    const read: InitialRead = { controller: new AbortController(), dirty: false, promise: Promise.resolve() };
    // Install the real promise before notifying possibly reentrant subscribers.
    read.promise = Promise.resolve().then(() => this.loadInitial(read));
    this.initial = read;
    this.update({ ...this.state, loading: true, error: null,
      top: { ...this.state.top, loading: false, error: null }, workspace: { ...this.state.workspace, loading: false, error: null } });
    return read.promise;
  }
  private async loadInitial(read: InitialRead): Promise<void> {
    if (!this.currentInitial(read)) return;
    try {
      const result = await this.reader.initial(this.workspaceId, this.query, read.controller.signal);
      if (!this.currentInitial(read)) return;
      this.validate(result.top, "top"); this.validate(result.workspace, "workspace");
      if (result.revision !== result.top.revision || result.revision !== result.workspace.revision)
        throw new AppError("INVALID_SESSION_PAGE", "会话分页版本不一致，请重试");
      // A background refresh must not collapse a scrolled list to its first 30.
      // Rebuild the displayed depth at ONE new revision, then replace both groups
      // atomically. Never append a new-revision page to old-revision rows.
      const [top, workspace] = this.continuous ? await Promise.all([
        this.restoreDepth(result.top, "top", Math.max(this.state.top.page?.items.length ?? 0, this.initialDepth.top ?? 0), read),
        this.restoreDepth(result.workspace, "workspace", Math.max(this.state.workspace.page?.items.length ?? 0, this.initialDepth.workspace ?? 0), read),
      ]) : [result.top, result.workspace];
      if (!this.currentInitial(read)) return;
      this.update({ top: emptyFrame(top), workspace: emptyFrame(workspace), revision: result.revision, loading: false, error: null });
    } catch (error) {
      if (this.currentInitial(read)) {
        if (this.continuous && error instanceof AppError && error.code === "CURSOR_STALE") read.dirty = true;
        this.update({ ...this.state, loading: false, error: asError(error) });
      }
    } finally {
      if (this.currentInitial(read)) {
        this.initial = undefined;
        // Display a coherent completed snapshot while a dirty follow-up loads.
        // Do not await/retain a chain of old results during continuous updates.
        if (read.dirty) void this.refresh();
      }
    }
  }
  private currentInitial(read: InitialRead) { return !this.disposed && this.initial === read; }
  private appendPage(before: SessionListPage, after: SessionListPage): SessionListPage {
    const rows = new Map(before.items.map(row => [JSON.stringify([row.workspaceId, row.id]), row]));
    for (const row of after.items) rows.set(JSON.stringify([row.workspaceId, row.id]), row);
    if (after.next && rows.size === before.items.length)
      throw new AppError("INVALID_SESSION_PAGE", "会话续载没有新增记录，请重试");
    return { ...after, items: [...rows.values()] };
  }
  private advance(page: SessionListPage, cursor: SessionListCursor | null) {
    if (cursor && page.next && (page.next.familyRank < cursor.familyRank ||
      page.next.familyRank === cursor.familyRank && page.next.memberRank <= cursor.memberRank))
      throw new AppError("INVALID_SESSION_PAGE", "会话续载位置未前进，请重试");
  }
  private async restoreDepth(page: SessionListPage, group: SessionListGroup, count: number, read: InitialRead) {
    while (page.items.length < count && page.next && this.currentInitial(read)) {
      const cursor = page.next;
      const next = await this.reader.page(this.workspaceId, group, this.query, cursor, read.controller.signal);
      if (!this.currentInitial(read)) return page;
      this.validate(next, group); this.advance(next, cursor);
      if (next.revision !== page.revision) throw new AppError("CURSOR_STALE", "会话列表已变化，请重新加载");
      page = this.appendPage(page, next);
    }
    return page;
  }

  next(group: SessionListGroup): Promise<void> {
    const frame = this.state[group];
    if (!frame.page?.next) return Promise.resolve();
    return this.move(group, frame.page.next, [...frame.previous, frame.cursor]);
  }
  previous(group: SessionListGroup): Promise<void> {
    const frame = this.state[group];
    if (!frame.previous.length) return Promise.resolve();
    return this.move(group, frame.previous.at(-1)!, frame.previous.slice(0, -1));
  }
  private async move(group: SessionListGroup, cursor: SessionListCursor | null, previous: readonly (SessionListCursor | null)[]): Promise<void> {
    if (this.disposed || this.initial || this.state[group].loading || !this.state[group].page) return;
    const read: PageRead = { controller: new AbortController(), epoch: this.epoch };
    this.reads[group] = read;
    this.frame(group, { ...this.state[group], loading: true, error: null });
    if (!this.currentPage(group, read)) return;
    try {
      const result = await this.reader.page(this.workspaceId, group, this.query, cursor, read.controller.signal);
      if (!this.currentPage(group, read)) return;
      this.validate(result, group);
      if (result.revision !== this.state.revision) { await this.refresh(); return; }
      if (this.continuous) this.advance(result, cursor);
      const page = this.continuous ? this.appendPage(this.state[group].page!, result) : result;
      this.frame(group, { page, cursor, previous: this.continuous ? [] : previous, loading: false, error: null });
    } catch (error) {
      if (!this.currentPage(group, read)) return;
      if (error instanceof AppError && error.code === "CURSOR_STALE") await this.refresh();
      else this.frame(group, { ...this.state[group], loading: false, error: asError(error) });
    } finally {
      if (this.reads[group] === read) delete this.reads[group];
    }
  }
  private currentPage(group: SessionListGroup, read: PageRead) {
    return !this.disposed && this.epoch === read.epoch && this.reads[group] === read;
  }
  private validate(page: SessionListPage, group: SessionListGroup) {
    const next = page.next;
    if (!Number.isSafeInteger(page.revision) || page.revision < 0 || !Array.isArray(page.items) || page.items.length > 30 ||
        next && (next.version !== 1 || next.revision !== page.revision || next.workspaceId !== this.workspaceId || next.group !== group || next.query !== this.query ||
          !Number.isSafeInteger(next.familyRank) || next.familyRank < 1 || !Number.isSafeInteger(next.memberRank) || next.memberRank < 1))
      throw new AppError("INVALID_SESSION_PAGE", "会话分页响应无效，请重试");
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; ++this.epoch;
    this.initial?.controller.abort();
    for (const read of Object.values(this.reads)) read.controller.abort();
    this.initial = undefined; this.reads = {}; this.listeners.clear();
  }
}
