import type { Scope } from "../../shared/protocol.js";
import type { SessionListCounts } from "../../shared/session-list.js";

export interface SessionListCountsReader {
  counts(workspaceId: string, sessionIds: string[], signal: AbortSignal): Promise<SessionListCounts>;
}
export type VisibleCount = { messageCount?: number; stale: boolean };
export type CountsSnapshot = { values: ReadonlyMap<string, VisibleCount>; invalidated: boolean };
type Registration = { scope: Scope; key: string; token: object };
type Batch = { controller: AbortController; epoch: number; rows: Registration[] };
const keyOf = (scope: Scope) => JSON.stringify([scope.workspaceId, scope.sessionId]);

/** Independent display-only reader: at most two batches of 30 visible rows.
 * Invalidation is a generation, NOT the metadata revision. A busy read finishes
 * before one coalesced latest-generation follow-up; stale replies cannot apply.
 * Cached display numbers may remain marked stale while refreshing; an exact
 * reader's missing count always replaces a previous number with unknown. */
export class SessionListCountsModel {
  private active = true;
  private epoch = 0;
  private scheduled = false;
  private visible = new Map<string, Registration>();
  private dirty = new Map<string, Registration>();
  private batches = new Set<Batch>();
  private busy = new Set<string>();
  private listeners = new Set<() => void>();
  private state: CountsSnapshot = { values: new Map(), invalidated: false };
  constructor(private readonly reader: SessionListCountsReader) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    if (!this.active) return () => {};
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };
  private publish(values: ReadonlyMap<string, VisibleCount>, invalidated = this.state.invalidated) {
    if (!this.active) return;
    this.state = { values, invalidated }; this.listeners.forEach(listener => listener());
  }
  enter(scope: Scope): () => void {
    if (!this.active) return () => {};
    const key = keyOf(scope), registration = { scope, key, token: {} };
    this.visible.set(key, registration); this.dirty.set(key, registration); this.schedule();
    return () => {
      if (this.visible.get(key) !== registration) return;
      this.visible.delete(key); this.dirty.delete(key);
      for (const batch of this.batches) {
        if (!batch.rows.some(row => this.visible.get(row.key) === row)) batch.controller.abort();
      }
    };
  }
  invalidate() {
    if (!this.active) return;
    ++this.epoch;
    for (const [key, row] of this.visible) this.dirty.set(key, row);
    this.publish(new Map([...this.state.values].map(([key, value]) => [key, { ...value, stale: true }])), true);
    this.schedule();
  }
  private schedule() {
    if (!this.active || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; this.pump(); });
  }
  private pump() {
    while (this.active && this.batches.size < 2) {
      const rows: Registration[] = [];
      let workspaceId: string | undefined;
      for (const [key, row] of this.dirty) {
        if (this.visible.get(key) !== row) { this.dirty.delete(key); continue; }
        if (this.busy.has(key)) continue;
        if (workspaceId === undefined) workspaceId = row.scope.workspaceId;
        if (row.scope.workspaceId !== workspaceId) continue;
        rows.push(row); this.dirty.delete(key); this.busy.add(key);
        if (rows.length === 30) break;
      }
      if (!rows.length) return;
      const batch: Batch = { rows, controller: new AbortController(), epoch: this.epoch };
      this.batches.add(batch); void this.read(batch, workspaceId!);
    }
  }
  private async read(batch: Batch, workspaceId: string) {
    try {
      const result = await this.reader.counts(workspaceId, batch.rows.map(row => row.scope.sessionId), batch.controller.signal);
      if (!this.current(batch)) return;
      const expected = new Set(batch.rows.map(row => row.scope.sessionId));
      if (!result || result.workspaceId !== workspaceId || !Array.isArray(result.items) || result.items.length !== expected.size)
        throw new Error("会话计数响应无效");
      const values = new Map(this.state.values);
      for (const item of result.items) {
        if (!item || !expected.delete(item.sessionId) || item.messageCount !== undefined &&
          (!Number.isSafeInteger(item.messageCount) || item.messageCount < 0)) throw new Error("会话计数响应无效");
      }
      const byId = new Map(result.items.map(item => [item.sessionId, item]));
      for (const row of batch.rows) if (this.visible.get(row.key) === row)
        values.set(row.key, { messageCount: byId.get(row.scope.sessionId)!.messageCount, stale: false });
      this.publish(values);
    } catch {
      if (!this.current(batch)) return;
      // No automatic error retry: only a new visibility/invalidation can retry.
      const values = new Map(this.state.values);
      for (const row of batch.rows) if (this.visible.get(row.key) === row)
        values.set(row.key, { messageCount: values.get(row.key)?.messageCount, stale: true });
      this.publish(values);
    } finally {
      this.batches.delete(batch);
      for (const row of batch.rows) this.busy.delete(row.key);
      this.schedule();
    }
  }
  private current(batch: Batch) {
    return this.active && !batch.controller.signal.aborted && batch.epoch === this.epoch;
  }
  dispose() {
    if (!this.active) return;
    this.active = false; ++this.epoch;
    for (const batch of this.batches) batch.controller.abort();
    this.visible.clear(); this.dirty.clear(); this.listeners.clear();
  }
}
